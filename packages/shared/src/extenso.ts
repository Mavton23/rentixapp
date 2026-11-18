/**
 * Números e valores por extenso, em português (como se escrevem nos contratos):
 * 15 000,00 MTn → "quinze mil meticais".
 */

const UNITS = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezasseis', 'dezassete', 'dezoito', 'dezanove'];
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const HUNDREDS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

/** 0 a 999. */
function upTo999(n: number): string {
  if (n === 100) return 'cem';
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(HUNDREDS[h]!);
  if (rest) {
    if (rest < 20) parts.push(UNITS[rest]!);
    else {
      const t = Math.floor(rest / 10);
      const u = rest % 10;
      parts.push(u ? `${TENS[t]} e ${UNITS[u]}` : TENS[t]!);
    }
  }
  return parts.join(' e ');
}

const SCALES: [number, string, string][] = [
  [1e9, 'mil milhões', 'mil milhões'],
  [1e6, 'milhão', 'milhões'],
  [1e3, 'mil', 'mil'],
];

/** Inteiro por extenso (0 até 999 999 999 999). */
export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) throw new RangeError('Número fora do intervalo');
  if (n === 0) return 'zero';
  const groups: { coef: number; text: string }[] = [];
  let rest = n;
  for (const [size, one, many] of SCALES) {
    const g = Math.floor(rest / size);
    rest %= size;
    if (!g) continue;
    // "mil" e não "um mil"; "um milhão", "dois milhões".
    const text = size === 1e3 && g === 1 ? 'mil' : size === 1e9 && g === 1 ? 'mil milhões' : `${upTo999(g)} ${g === 1 ? one : many}`;
    groups.push({ coef: g, text });
  }
  if (rest) groups.push({ coef: rest, text: upTo999(rest) });
  // "e" antes do último grupo quando este é menor que 100 ou um número redondo de centenas:
  // "mil e quinhentos", "dois mil e vinte", "dois milhões e quinhentos mil", mas "mil quinhentos e trinta".
  return groups
    .map((g, i) => {
      if (i === 0) return g.text;
      const last = i === groups.length - 1;
      const small = g.coef < 100 || g.coef % 100 === 0;
      return `${last && small ? 'e ' : ''}${g.text}`;
    })
    .join(' ');
}

const CURRENCY_WORDS: Record<string, [string, string]> = {
  MZN: ['metical', 'meticais'],
  USD: ['dólar americano', 'dólares americanos'],
  ZAR: ['rand', 'rands'],
  EUR: ['euro', 'euros'],
};

/** Valor em centavos por extenso: 1 550 050 → "quinze mil e quinhentos meticais e cinquenta centavos". */
export function moneyToWords(minor: number, currency = 'MZN', locale: 'pt' | 'en' = 'pt'): string {
  if (locale === 'en') return moneyToWordsEn(minor, currency);
  const [one, many] = CURRENCY_WORDS[currency] ?? [currency, currency];
  const whole = Math.floor(minor / 100);
  const cents = minor % 100;
  // "um milhão de meticais": "de" depois de milhão/milhões redondos.
  const de = whole >= 1e6 && whole % 1e6 === 0 ? 'de ' : '';
  const main = `${numberToWords(whole)} ${de}${whole === 1 ? one : many}`;
  if (!cents) return main;
  const c = `${numberToWords(cents)} ${cents === 1 ? 'centavo' : 'centavos'}`;
  return whole ? `${main} e ${c}` : c;
}

// ---------- Inglês ----------

const EN_UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function enUpTo999(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${EN_UNITS[h]} hundred`);
  if (rest) {
    const r = rest < 20 ? EN_UNITS[rest]! : `${EN_TENS[Math.floor(rest / 10)]}${rest % 10 ? `-${EN_UNITS[rest % 10]}` : ''}`;
    parts.push(h ? `and ${r}` : r);
  }
  return parts.join(' ');
}

/** Inteiro por extenso em inglês britânico: 1 520 → "one thousand five hundred and twenty". */
export function numberToWordsEn(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) throw new RangeError('Number out of range');
  if (n === 0) return 'zero';
  const parts: string[] = [];
  let rest = n;
  for (const [size, name] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']] as const) {
    const g = Math.floor(rest / size);
    rest %= size;
    if (g) parts.push(`${enUpTo999(g)} ${name}`);
  }
  if (rest) parts.push(parts.length && rest < 100 ? `and ${enUpTo999(rest)}` : enUpTo999(rest));
  return parts.join(' ');
}

const EN_CURRENCY_WORDS: Record<string, [string, string, string, string]> = {
  MZN: ['metical', 'meticais', 'centavo', 'centavos'],
  USD: ['US dollar', 'US dollars', 'cent', 'cents'],
  ZAR: ['rand', 'rand', 'cent', 'cents'],
  EUR: ['euro', 'euros', 'cent', 'cents'],
};

/** 1 550 050 MZN → "fifteen thousand five hundred meticais and fifty centavos". */
export function moneyToWordsEn(minor: number, currency = 'MZN'): string {
  const [one, many, c1, cMany] = EN_CURRENCY_WORDS[currency] ?? [currency, currency, 'cent', 'cents'];
  const whole = Math.floor(minor / 100);
  const cents = minor % 100;
  const main = `${numberToWordsEn(whole)} ${whole === 1 ? one : many}`;
  if (!cents) return main;
  const c = `${numberToWordsEn(cents)} ${cents === 1 ? c1 : cMany}`;
  return whole ? `${main} and ${c}` : c;
}
