import { invoiceStatusFor, lateFeeFor, periodsDue, rentDates } from './billing.logic';

const lease = {
  startDate: '2026-09-10',
  endDate: null,
  billingDay: 5,
  firstBillingPeriod: '2026-09',
};

describe('periodsDue', () => {
  it('fatura do início do contrato até ao mês atual', () => {
    expect(periodsDue(lease, '2026-11-15')).toEqual(['2026-09', '2026-10', '2026-11']);
  });

  it('não fatura antes do início do contrato', () => {
    expect(periodsDue({ ...lease, startDate: '2026-12-01', firstBillingPeriod: '2026-12' }, '2026-11-15')).toEqual([]);
  });

  it('respeita o primeiro período de faturação (sem retroativos)', () => {
    expect(periodsDue({ ...lease, startDate: '2024-01-01', firstBillingPeriod: '2026-11' }, '2026-11-15')).toEqual([
      '2026-11',
    ]);
  });

  it('para no mês de fim do contrato', () => {
    expect(periodsDue({ ...lease, endDate: '2026-10-31' }, '2026-12-20')).toEqual(['2026-09', '2026-10']);
  });
});

describe('rentDates', () => {
  it('no primeiro mês, contrato a dia 10 com cobrança a dia 5 vence a dia 10', () => {
    expect(rentDates(lease, '2026-09', '2026-09-10')).toEqual({ issueDate: '2026-09-10', dueDate: '2026-09-10' });
  });

  it('emitida no dia 1, vence no dia de cobrança', () => {
    expect(rentDates(lease, '2026-10', '2026-10-01')).toEqual({ issueDate: '2026-10-01', dueDate: '2026-10-05' });
  });

  it('se só for gerada depois do dia de cobrança, não nasce em atraso', () => {
    expect(rentDates(lease, '2026-10', '2026-10-12')).toEqual({ issueDate: '2026-10-12', dueDate: '2026-10-12' });
  });

  it('dia de cobrança limitado ao fim do mês', () => {
    expect(rentDates({ ...lease, billingDay: 28 }, '2027-02', '2027-02-01').dueDate).toBe('2027-02-28');
  });
});

describe('lateFeeFor', () => {
  const base = { outstanding: 1_500_000, dueDate: '2026-11-05', graceDays: 5, bps: 300 };

  it('não aplica dentro da tolerância', () => {
    expect(lateFeeFor({ ...base, today: '2026-11-10' })).toBe(0);
  });

  it('aplica 3% sobre o valor em dívida depois da tolerância', () => {
    expect(lateFeeFor({ ...base, today: '2026-11-11' })).toBe(45_000);
  });

  it('não aplica se não há dívida ou multa configurada', () => {
    expect(lateFeeFor({ ...base, outstanding: 0, today: '2026-12-01' })).toBe(0);
    expect(lateFeeFor({ ...base, bps: 0, today: '2026-12-01' })).toBe(0);
  });
});

describe('invoiceStatusFor', () => {
  it('calcula o estado pelo valor pago', () => {
    expect(invoiceStatusFor(1000, 0)).toBe('OPEN');
    expect(invoiceStatusFor(1000, 400)).toBe('PARTIALLY_PAID');
    expect(invoiceStatusFor(1000, 1000)).toBe('PAID');
  });
});
