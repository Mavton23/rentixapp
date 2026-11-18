import PDFDocument from 'pdfkit';
import { formatMoney, intlLocale, type Locale } from '@rentix/shared';
import { translator } from '../../common/i18n';
import { RENTIX_LOGO_PNG } from './rentix-logo';

export interface SubscriptionInvoicePdfData {
  issuer: { name: string; nuit: string | null; address: string | null; email: string | null };
  customer: { name: string; nuit: string | null; address: string | null };
  number: string;
  status: 'OPEN' | 'PAID' | 'VOID';
  issueDate: string;
  dueDate: string;
  paidAt: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  description: string;
  planAmount: number;
  credit: number;
  amount: number;
  currency: string;
  bankDetails: string[];
}

const METHOD: Record<string, string> = {
  BANK_TRANSFER: 'Transferência bancária',
  MPESA: 'M-Pesa',
  EMOLA: 'e-Mola',
  MKESH: 'mKesh',
  CASH: 'Numerário',
  OTHER: 'Outro',
};

const moneyFor = (locale: Locale) => (minor: number, currency: string) =>
  formatMoney(minor, currency, locale === 'en' ? intlLocale('en') : undefined).replace(/[\u202f\u00a0]/g, ' ');
const date = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

const INK = '#0f1e2e';
const SOFT = '#4a5868';
const LINE = '#cbd3dd';

/** Fatura do Rentix a uma organização; quando paga, serve de fatura-recibo. */
export function renderSubscriptionInvoicePdf(d: SubscriptionInvoicePdfData, locale: Locale = 'pt'): Promise<Buffer> {
  const t = translator(locale);
  const money = moneyFor(locale);
  return new Promise((resolve, reject) => {
    const paid = d.status === 'PAID';
    const title = paid ? t('Fatura-recibo') : t('Fatura');
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `${title} ${d.number}`, Author: d.issuer.name, Creator: 'Rentix' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    // Logótipo do Rentix por cima do emitente; o título fica alinhado com ele à direita.
    const top = doc.y;
    doc.image(RENTIX_LOGO_PNG, left, top, { height: 30 });
    doc.y = top + 42;
    doc.font('Helvetica-Bold').fontSize(14).fillColor(INK).text(d.issuer.name, left, doc.y, { width: width * 0.6 });
    doc.font('Helvetica').fontSize(9).fillColor(SOFT);
    [d.issuer.address, d.issuer.nuit ? `NUIT ${d.issuer.nuit}` : null, d.issuer.email]
      .filter(Boolean)
      .forEach((l) => doc.text(l!, { width: width * 0.6 }));
    const leftBottom = doc.y;
    doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text(title, left, top, { width, align: 'right' });
    doc.font('Helvetica').fontSize(11).text(d.number, { width, align: 'right' });
    doc.fontSize(9).fillColor(SOFT).text(t('Emitida a {data}', { data: date(d.issueDate) }), { width, align: 'right' });

    const y = Math.max(leftBottom, doc.y) + 14;
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(1).strokeColor(INK).stroke();
    doc.y = y + 20;

    if (d.status === 'VOID') {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#c0263e').text(t('FATURA ANULADA'), left, doc.y, { width, align: 'center' });
      doc.moveDown(1);
    }

    doc.font('Helvetica').fontSize(9).fillColor(SOFT).text(t('Cliente'), left, doc.y);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(d.customer.name);
    doc.font('Helvetica').fontSize(9).fillColor(SOFT);
    if (d.customer.nuit) doc.text(`NUIT ${d.customer.nuit}`);
    if (d.customer.address) doc.text(d.customer.address);
    doc.moveDown(1.5);

    // Linhas
    let ty = doc.y;
    const col = width * 0.72;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(SOFT).text(t('Descrição'), left, ty).text(t('Valor'), left + col, ty, { width: width - col, align: 'right' });
    ty += 16;
    doc.moveTo(left, ty).lineTo(left + width, ty).lineWidth(0.5).strokeColor(LINE).stroke();
    ty += 8;
    const line = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(INK);
      const h = doc.heightOfString(label, { width: col - 12 });
      doc.text(label, left, ty, { width: col - 12 });
      doc.text(value, left + col, ty, { width: width - col, align: 'right' });
      ty += Math.max(h, 12) + 8;
    };
    line(d.description, money(d.planAmount, d.currency));
    if (d.credit > 0) line(t('Crédito pelo tempo não usado do plano anterior'), `-${money(d.credit, d.currency)}`);
    doc.moveTo(left, ty).lineTo(left + width, ty).lineWidth(0.5).strokeColor(LINE).stroke();
    ty += 8;
    line(paid ? t('Total pago') : t('Total a pagar'), money(d.amount, d.currency), true);

    doc.y = ty + 16;
    doc.font('Helvetica').fontSize(10).fillColor(INK);
    if (paid) {
      doc.text(
        t('Pago a {data} por {meio}', { data: date(d.paidAt!), meio: t(METHOD[d.paymentMethod ?? ''] ?? 'outro meio') }) +
          (d.paymentReference ? t(', referência {ref}', { ref: d.paymentReference }) : '') +
          '.',
        left,
        doc.y,
        { width },
      );
    } else if (d.status === 'OPEN') {
      doc.text(t('A pagar até {data}, por M-Pesa na área Plano e faturação do Rentix ou por transferência bancária.', { data: date(d.dueDate) }), left, doc.y, { width });
      if (d.bankDetails.length) {
        doc.moveDown(0.8);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(SOFT).text(t('Transferência bancária'));
        doc.font('Helvetica').fontSize(10).fillColor(INK);
        d.bankDetails.forEach((l) => doc.text(l));
        doc.text(t('Descritivo: {numero}', { numero: d.number }));
      }
    }

    doc.fontSize(8).fillColor('#7b8794').text(t('Documento processado pelo Rentix'), left, doc.page.height - 70, { width });
    doc.end();
  });
}
