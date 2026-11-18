import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { moneyToWords, numberToWords,
  applyBps,
  addMonthsToPeriod,
  dueDateFor,
  diffDays,
  formatMoney,
  mzMobileOperator,
  normalizePhone,
  toDecimalString,
  toMinor,
  todayIn,
  createLeaseSchema,
  registerSchema,
} from './index';

test('toMinor converte formatos comuns sem erros de float', () => {
  assert.equal(toMinor('1500'), 150000);
  assert.equal(toMinor('1500,5'), 150050);
  assert.equal(toMinor('1 500,50'), 150050);
  assert.equal(toMinor('1.500,50'), 150050);
  assert.equal(toMinor('1,500.50'), 150050);
  assert.equal(toMinor(0.1 + 0.2), 30);
  assert.equal(toMinor(19.99), 1999);
  assert.throws(() => toMinor('12.345'));
  assert.throws(() => toMinor('abc'));
});

test('toDecimalString', () => {
  assert.equal(toDecimalString(150050), '1500.50');
  assert.equal(toDecimalString(5), '0.05');
});

test('applyBps arredonda half-up com inteiros', () => {
  assert.equal(applyBps(1_500_000, 300), 45_000); // 3% de 15 000,00
  assert.equal(applyBps(333, 5000), 167); // 166.5 -> 167
  assert.equal(applyBps(100, 0), 0);
});

test('formatMoney MZN', () => {
  assert.match(formatMoney(150050, 'MZN'), /1\s?500,50\s?MTn/);
});

test('normalizePhone para Moçambique', () => {
  assert.equal(normalizePhone('84 123 4567'), '+258841234567');
  assert.equal(normalizePhone('+258 84 123 4567'), '+258841234567');
  assert.equal(normalizePhone('00258841234567'), '+258841234567');
  assert.equal(normalizePhone('258871234567'), '+258871234567');
  assert.equal(normalizePhone('891234567'), null); // prefixo inexistente
  assert.equal(normalizePhone('+27821234567'), '+27821234567'); // África do Sul
  assert.equal(mzMobileOperator('+258841234567'), 'VODACOM');
  assert.equal(mzMobileOperator('+258861234567'), 'MOVITEL');
  assert.equal(mzMobileOperator('+258821234567'), 'TMCEL');
});

test('datas e períodos', () => {
  assert.equal(dueDateFor('2026-02', 28), '2026-02-28');
  assert.equal(dueDateFor('2026-02', 31), '2026-02-28');
  assert.equal(addMonthsToPeriod('2026-12', 1), '2027-01');
  assert.equal(addMonthsToPeriod('2026-01', -1), '2025-12');
  assert.equal(diffDays('2026-01-30', '2026-02-02'), 3);
  // 23:30 UTC de 14/11 já é dia 15 em Maputo (UTC+2)
  assert.equal(todayIn('Africa/Maputo', new Date('2026-11-14T23:30:00Z')), '2026-11-15');
});

test('schemas', () => {
  const r = registerSchema.safeParse({
    name: 'Ana',
    email: ' ANA@Exemplo.co.mz ',
    phone: '84 123 4567',
    password: 'segredo123',
  });
  assert.ok(r.success);
  assert.equal(r.data.email, 'ana@exemplo.co.mz');
  assert.equal(r.data.phone, '+258841234567');

  const bad = createLeaseSchema.safeParse({
    unitId: '00000000-0000-4000-8000-000000000000',
    tenantId: '00000000-0000-4000-8000-000000000000',
    startDate: '2026-05-01',
    endDate: '2026-04-01',
    rentAmount: 1000,
  });
  assert.ok(!bad.success);
});

describe('por extenso', () => {
  it('números', () => {
    const cases: [number, string][] = [
      [0, 'zero'],
      [16, 'dezasseis'],
      [21, 'vinte e um'],
      [100, 'cem'],
      [101, 'cento e um'],
      [345, 'trezentos e quarenta e cinco'],
      [1000, 'mil'],
      [1500, 'mil e quinhentos'],
      [1530, 'mil quinhentos e trinta'],
      [2020, 'dois mil e vinte'],
      [15000, 'quinze mil'],
      [100000, 'cem mil'],
      [1_000_000, 'um milhão'],
      [2_500_000, 'dois milhões e quinhentos mil'],
      [1_000_001, 'um milhão e um'],
    ];
    for (const [n, text] of cases) assert.equal(numberToWords(n), text);
  });
  it('valores', () => {
    assert.equal(moneyToWords(1_500_000), 'quinze mil meticais');
    assert.equal(moneyToWords(100), 'um metical');
    assert.equal(moneyToWords(1_550_050), 'quinze mil e quinhentos meticais e cinquenta centavos');
    assert.equal(moneyToWords(100_000_000), 'um milhão de meticais');
    assert.equal(moneyToWords(50), 'cinquenta centavos');
    assert.equal(moneyToWords(250_000, 'USD'), 'dois mil e quinhentos dólares americanos');
  });
});

import { createTranslator, normalizeLocale, formatPeriod, formatPhone, numberToWordsEn, moneyToWordsEn } from './index';

test('idiomas: normalizar e traduzir com padrões', () => {
  assert.equal(normalizeLocale('en-GB,en;q=0.9,pt;q=0.8'), 'en');
  assert.equal(normalizeLocale('fr-FR,pt-PT;q=0.8'), 'pt');
  assert.equal(normalizeLocale('de'), 'pt');
  const t = createTranslator('en', { Entrar: 'Sign in', 'Limite de {n} unidades atingido': '{n}-unit limit reached', 'Olá, {nome}': 'Hello, {nome}' });
  assert.equal(t('Entrar'), 'Sign in');
  assert.equal(t('Olá, {nome}', { nome: 'Ana' }), 'Hello, Ana');
  assert.equal(t('Limite de 20 unidades atingido'), '20-unit limit reached');
  assert.equal(t('Sem tradução'), 'Sem tradução');
  const pt = createTranslator('pt', {});
  assert.equal(pt('Olá, {nome}', { nome: 'Ana' }), 'Olá, Ana');
  assert.equal(formatPeriod('2026-11', 'en'), 'November 2026');
  assert.equal(formatPeriod('2026-11', 'pt'), 'novembro de 2026');
});

test('extenso em inglês', () => {
  assert.equal(numberToWordsEn(1520), 'one thousand five hundred and twenty');
  assert.equal(numberToWordsEn(2000005), 'two million and five');
  assert.equal(numberToWordsEn(115), 'one hundred and fifteen');
  assert.equal(moneyToWordsEn(1550050, 'MZN'), 'fifteen thousand five hundred meticais and fifty centavos');
  assert.equal(moneyToWords(100, 'USD', 'en'), 'one US dollar');
});

test('telefones de outros países', () => {
  assert.equal(normalizePhone('+27 82 123 4567'), '+27821234567');
  assert.equal(normalizePhone('082 123 4567', 'ZA'), '+27821234567');
  assert.equal(normalizePhone('+44 7911 123456'), '+447911123456');
  assert.equal(normalizePhone('+27 12'), null);
  assert.equal(formatPhone('+258841234567'), '+258 84 123 4567');
});
