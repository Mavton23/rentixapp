import PDFDocument from 'pdfkit';
import { formatMoney, intlLocale, type Locale } from '@rentix/shared';
import { translator } from '../../common/i18n';

/** Dados necessários para o recibo (vêm de PaymentsService.receiptData). */
export interface ReceiptData {
  receiptNumber: string | null;
  amount: number;
  currency: string;
  method: string;
  status: string;
  paidAt: string;
  reference: string | null;
  organization: { name: string; nuit: string | null; address: string | null; city: string | null; phone: string | null; email: string | null };
  tenant: { fullName: string; nuit: string | null; idDocumentType: string; idDocumentNumber: string };
  invoice: {
    number: string;
    description: string;
    amount: number;
    paidAmount: number;
    lease: { unit: { label: string; property: { name: string; street: string; city: string } } };
  };
}

const METHOD: Record<string, string> = {
  CASH: 'Numerário',
  BANK_TRANSFER: 'Transferência bancária',
  MPESA: 'M-Pesa',
  EMOLA: 'e-Mola',
  MKESH: 'mKesh',
  CARD: 'Cartão',
  CHEQUE: 'Cheque',
  OTHER: 'Outro',
};
const DOC: Record<string, string> = {
  BI: 'BI',
  PASSPORT: 'Passaporte',
  DIRE: 'DIRE',
  DRIVING_LICENSE: 'Carta de condução',
  OTHER: 'Documento',
};

/** As fontes base do PDF não têm os espaços finos que o Intl usa nos milhares. */
const moneyFor = (locale: Locale) => (minor: number, currency: string) =>
  formatMoney(minor, currency, locale === 'en' ? intlLocale('en') : undefined).replace(/[\u202f\u00a0]/g, ' ');
const date = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

const INK = '#0f1e2e';
const SOFT = '#4a5868';
const LINE = '#cbd3dd';

/** Gera o recibo em PDF (A4) e devolve-o como Buffer. */
export function renderReceiptPdf(r: ReceiptData, locale: Locale = 'pt'): Promise<Buffer> {
  const t = translator(locale);
  const money = moneyFor(locale);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 56,
      info: { Title: `${t('Recibo')} ${r.receiptNumber ?? ''}`, Author: r.organization.name, Creator: 'Rentix' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    // Cabeçalho: emitente à esquerda, número do recibo à direita.
    const top = doc.y;
    doc.font('Helvetica-Bold').fontSize(14).fillColor(INK).text(r.organization.name, left, top, { width: width * 0.6 });
    doc.font('Helvetica').fontSize(9).fillColor(SOFT);
    const orgLines = [
      [r.organization.address, r.organization.city].filter(Boolean).join(', '),
      r.organization.nuit ? `NUIT ${r.organization.nuit}` : '',
      [r.organization.phone, r.organization.email].filter(Boolean).join('   '),
    ].filter(Boolean);
    orgLines.forEach((l) => doc.text(l, { width: width * 0.6 }));
    const leftBottom = doc.y;

    doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text(t('Recibo'), left, top, { width, align: 'right' });
    doc.font('Helvetica').fontSize(11).text(r.receiptNumber ?? '', { width, align: 'right' });
    doc.fontSize(9).fillColor(SOFT).text(date(r.paidAt), { width, align: 'right' });

    const y = Math.max(leftBottom, doc.y) + 14;
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(1).strokeColor(INK).stroke();
    doc.y = y + 22;

    if (r.status === 'REVERSED') {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#c0263e')
        .text(t('PAGAMENTO ESTORNADO - RECIBO SEM VALIDADE'), left, doc.y, { width, align: 'center' });
      doc.moveDown(1);
    }

    // Corpo
    const unit = r.invoice.lease.unit;
    doc.font('Helvetica').fontSize(11).fillColor(INK);
    doc.text(t('Recebemos de '), left, doc.y, { continued: true })
      .font('Helvetica-Bold').text(r.tenant.fullName, { continued: true })
      .font('Helvetica')
      .text(` (${t(DOC[r.tenant.idDocumentType] ?? 'Documento')} ${r.tenant.idDocumentNumber}${r.tenant.nuit ? `, NUIT ${r.tenant.nuit}` : ''}) ${t('a quantia de')}`);
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(26).text(money(r.amount, r.currency));
    doc.moveDown(0.6);
    doc.font('Helvetica').fontSize(11)
      .text(t('referente a '), { continued: true })
      .font('Helvetica-Bold').text(r.invoice.description, { continued: true })
      .font('Helvetica')
      .text(
        t(', fatura {numero}, do imóvel {imovel}, {unidade}, {rua}, {cidade}.', { numero: r.invoice.number, imovel: unit.property.name, unidade: unit.label, rua: unit.property.street, cidade: unit.property.city }),
        { width },
      );

    // Tabela de detalhes
    doc.moveDown(1.5);
    let ty = doc.y;
    doc.moveTo(left, ty).lineTo(left + width, ty).lineWidth(0.5).strokeColor(LINE).stroke();
    ty += 10;
    const rows: [string, string, boolean?][] = [
      [t('Forma de pagamento'), t(METHOD[r.method] ?? r.method)],
      ...(r.reference ? [[t('Referência'), r.reference] as [string, string]] : []),
      [t('Valor da fatura'), money(r.invoice.amount, r.currency)],
      [t('Total pago até à data'), money(r.invoice.paidAmount, r.currency)],
      [t('Em dívida nesta fatura'), money(r.invoice.amount - r.invoice.paidAmount, r.currency), true],
    ];
    for (const [label, value, bold] of rows) {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(bold ? INK : SOFT).text(label, left, ty, { width: width / 2 });
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(INK).text(value, left + width / 2, ty, { width: width / 2, align: 'right' });
      ty += 18;
    }

    // Assinaturas
    const sy = ty + 70;
    const colW = (width - 40) / 2;
    doc.lineWidth(0.8).strokeColor(INK);
    doc.moveTo(left, sy).lineTo(left + colW, sy).stroke();
    doc.moveTo(left + colW + 40, sy).lineTo(left + width, sy).stroke();
    doc.font('Helvetica').fontSize(9).fillColor(SOFT);
    doc.text(t('O senhorio / gestor'), left, sy + 6, { width: colW, align: 'center' });
    doc.text(t('O inquilino'), left + colW + 40, sy + 6, { width: colW, align: 'center' });

    doc.fontSize(8).fillColor('#7b8794').text(t('Documento emitido pelo Rentix'), left, doc.page.height - 70, { width, align: 'left' });
    doc.end();
  });
}
