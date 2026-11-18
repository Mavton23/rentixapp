import ExcelJS from 'exceljs';
import { dateToIsoDate, type ReportExportKind } from '@rentix/shared';
import type { ReportsService, ResolvedRange } from './reports.service';
import { translator } from '../../common/i18n';
import { intlLocale, type Locale } from '@rentix/shared';

const KIND: Record<string, string> = { RENT: 'Renda', DEPOSIT: 'Caução', LATE_FEE: 'Multa', OTHER: 'Outro' };
const STATUS: Record<string, string> = { OPEN: 'Por pagar', PARTIALLY_PAID: 'Paga em parte', PAID: 'Paga', VOID: 'Anulada' };
const PAY_STATUS: Record<string, string> = { CONFIRMED: 'Confirmado', REVERSED: 'Estornado' };
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
const DOC: Record<string, string> = { BI: 'BI', PASSPORT: 'Passaporte', DIRE: 'DIRE', DRIVING_LICENSE: 'Carta de condução', OTHER: 'Outro' };

export const EXPORT_TITLE: Record<ReportExportKind, string> = {
  invoices: 'Faturas',
  payments: 'Pagamentos',
  tenants: 'Inquilinos',
  aging: 'Dívidas por antiguidade',
};

type Col = { header: string; key: string; width: number; type?: 'money' | 'date' | 'int' };
const money = (minor: number) => minor / 100;
const date = (d: Date | null) => (d ? new Date(`${dateToIsoDate(d)}T12:00:00Z`) : null);
const fmtDate = (iso: string) => iso.split('-').reverse().join('/');

/**
 * Livro Excel pronto para o contabilista: cabeçalho na linha 1 (importável), filtros,
 * primeira linha fixa, valores como números (não texto) e datas como datas.
 * Uma segunda folha regista a organização, o período e quando foi gerado.
 */
export async function buildWorkbook(kind: ReportExportKind, organizationId: string, r: ResolvedRange, reports: ReportsService, locale: Locale = 'pt'): Promise<Buffer> {
  const tr = translator(locale);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Rentix';
  wb.created = new Date();
  const ws = wb.addWorksheet(tr(EXPORT_TITLE[kind]), { views: [{ state: 'frozen', ySplit: 1 }] });

  let cols: Col[] = [];
  let rows: Record<string, unknown>[] = [];

  if (kind === 'invoices') {
    cols = [
      { header: 'Número', key: 'number', width: 18 },
      { header: 'Tipo', key: 'kind', width: 10 },
      { header: 'Estado', key: 'status', width: 14 },
      { header: 'Emissão', key: 'issueDate', width: 12, type: 'date' },
      { header: 'Vencimento', key: 'dueDate', width: 12, type: 'date' },
      { header: 'Período', key: 'period', width: 10 },
      { header: 'Inquilino', key: 'tenant', width: 28 },
      { header: 'NUIT do inquilino', key: 'nuit', width: 14 },
      { header: 'Imóvel', key: 'property', width: 24 },
      { header: 'Unidade', key: 'unit', width: 12 },
      { header: 'Descrição', key: 'description', width: 34 },
      { header: 'Valor', key: 'amount', width: 14, type: 'money' },
      { header: 'Pago', key: 'paid', width: 14, type: 'money' },
      { header: 'Em dívida', key: 'outstanding', width: 14, type: 'money' },
      { header: 'Moeda', key: 'currency', width: 8 },
    ];
    rows = (await reports.invoicesFor(organizationId, r)).map((i) => ({
      number: i.number,
      kind: tr(KIND[i.kind] ?? ''),
      status: tr(STATUS[i.status] ?? ''),
      issueDate: date(i.issueDate),
      dueDate: date(i.dueDate),
      period: i.period ?? '',
      tenant: i.tenant.fullName,
      nuit: i.tenant.nuit ?? '',
      property: i.lease.unit.property.name,
      unit: i.lease.unit.label,
      description: i.description,
      amount: money(i.amount),
      paid: money(i.paidAmount),
      outstanding: i.status === 'VOID' ? 0 : money(i.amount - i.paidAmount),
      currency: i.currency,
    }));
  } else if (kind === 'payments') {
    cols = [
      { header: 'Recibo', key: 'receipt', width: 18 },
      { header: 'Data', key: 'paidAt', width: 12, type: 'date' },
      { header: 'Estado', key: 'status', width: 12 },
      { header: 'Inquilino', key: 'tenant', width: 28 },
      { header: 'NUIT do inquilino', key: 'nuit', width: 14 },
      { header: 'Fatura', key: 'invoice', width: 18 },
      { header: 'Imóvel', key: 'property', width: 24 },
      { header: 'Unidade', key: 'unit', width: 12 },
      { header: 'Método', key: 'method', width: 20 },
      { header: 'Referência', key: 'reference', width: 22 },
      { header: 'Valor', key: 'amount', width: 14, type: 'money' },
      { header: 'Moeda', key: 'currency', width: 8 },
    ];
    rows = (await reports.paymentsFor(organizationId, r)).map((p) => ({
      receipt: p.receiptNumber ?? '',
      paidAt: date(p.paidAt),
      status: tr(PAY_STATUS[p.status] ?? p.status),
      tenant: p.tenant.fullName,
      nuit: p.tenant.nuit ?? '',
      invoice: p.invoice.number,
      property: p.invoice.lease.unit.property.name,
      unit: p.invoice.lease.unit.label,
      method: tr(METHOD[p.method] ?? ''),
      reference: p.providerTransactionId ?? p.reference ?? '',
      amount: money(p.status === 'REVERSED' ? -p.amount : p.amount),
      currency: p.currency,
    }));
  } else if (kind === 'tenants') {
    cols = [
      { header: 'Nome', key: 'name', width: 28 },
      { header: 'Documento', key: 'doc', width: 10 },
      { header: 'Número do documento', key: 'docNumber', width: 18 },
      { header: 'NUIT', key: 'nuit', width: 12 },
      { header: 'Telefone', key: 'phone', width: 16 },
      { header: 'Email', key: 'email', width: 26 },
      { header: 'Contrato ativo', key: 'unit', width: 30 },
      { header: 'Início', key: 'start', width: 12, type: 'date' },
      { header: 'Fim', key: 'end', width: 12, type: 'date' },
      { header: 'Renda', key: 'rent', width: 14, type: 'money' },
      { header: 'Em dívida', key: 'outstanding', width: 14, type: 'money' },
    ];
    rows = (await reports.tenantsFor(organizationId)).map((t) => {
      const l = t.leases[0];
      return {
        name: t.fullName,
        doc: tr(DOC[t.idDocumentType] ?? t.idDocumentType),
        docNumber: t.idDocumentNumber,
        nuit: t.nuit ?? '',
        phone: t.phone,
        email: t.email ?? '',
        unit: t.leases.map((x) => `${x.unit.property.name}, ${x.unit.label}`).join('; '),
        start: l ? date(l.startDate) : null,
        end: l ? date(l.endDate) : null,
        rent: l ? money(t.leases.reduce((s, x) => s + x.rentAmount, 0)) : null,
        outstanding: money(t.invoices.reduce((s, i) => s + i.amount - i.paidAmount, 0)),
      };
    });
  } else {
    cols = [
      { header: 'Inquilino', key: 'tenant', width: 28 },
      { header: 'Telefone', key: 'phone', width: 16 },
      { header: 'Unidades', key: 'units', width: 32 },
      { header: 'Faturas', key: 'invoices', width: 9, type: 'int' },
      { header: 'Vencimento mais antigo', key: 'oldest', width: 14, type: 'date' },
      { header: 'Ainda não vencido', key: 'current', width: 14, type: 'money' },
      { header: '1 a 30 dias', key: 'd1_30', width: 14, type: 'money' },
      { header: '31 a 60 dias', key: 'd31_60', width: 14, type: 'money' },
      { header: '61 a 90 dias', key: 'd61_90', width: 14, type: 'money' },
      { header: 'Mais de 90 dias', key: 'd90_plus', width: 14, type: 'money' },
      { header: 'Total', key: 'total', width: 14, type: 'money' },
      { header: 'Moeda', key: 'currency', width: 8 },
    ];
    const a = await reports.aging(organizationId);
    rows = a.rows.map((x) => ({
      tenant: x.tenant.fullName,
      phone: x.tenant.phone,
      units: x.units.join('; '),
      invoices: x.invoices,
      oldest: new Date(`${x.oldestDueDate}T12:00:00Z`),
      current: money(x.buckets.current),
      d1_30: money(x.buckets.d1_30),
      d31_60: money(x.buckets.d31_60),
      d61_90: money(x.buckets.d61_90),
      d90_plus: money(x.buckets.d90_plus),
      total: money(x.total),
      currency: x.currency,
    }));
  }

  ws.columns = cols.map((c) => ({
    header: tr(c.header),
    key: c.key,
    width: c.width,
    style: c.type === 'money' ? { numFmt: '#,##0.00' } : c.type === 'date' ? { numFmt: 'dd/mm/yyyy' } : {},
  }));
  ws.addRows(rows);
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1E2E' } };
  header.alignment = { vertical: 'middle' };
  header.height = 20;
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  // Totais das colunas de valores (com fórmulas, para continuarem certos se filtrar/editar).
  if (rows.length && kind !== 'tenants') {
    const last = rows.length + 1;
    const total = ws.addRow({});
    total.getCell(1).value = tr('Total');
    total.font = { bold: true };
    cols.forEach((c, idx) => {
      if (c.type !== 'money') return;
      const letter = ws.getColumn(idx + 1).letter;
      total.getCell(idx + 1).value = { formula: `SUBTOTAL(9,${letter}2:${letter}${last})` };
      total.getCell(idx + 1).numFmt = '#,##0.00';
    });
  }

  const info = wb.addWorksheet(tr('Informação'));
  info.columns = [{ width: 22 }, { width: 50 }];
  info.addRows([
    [tr('Organização'), r.organizationName],
    [tr('Relatório'), tr(EXPORT_TITLE[kind])],
    [
      tr('Período'),
      kind === 'tenants' || kind === 'aging'
        ? tr('Situação a {data}', { data: fmtDate(r.today) })
        : tr('{de} a {ate}', { de: fmtDate(r.from), ate: fmtDate(r.to) }),
    ],
    [tr('Gerado em'), new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'short', timeStyle: 'short', timeZone: r.timezone }).format(new Date())],
    [tr('Valores'), tr('Em unidades da moeda (ex.: 15000,00 = 15 000 MTn). Com várias moedas, filtrar pela coluna Moeda antes de somar.')],
  ]);
  info.getColumn(1).font = { bold: true };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
