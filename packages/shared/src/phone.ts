import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

/**
 * Telefones são guardados em formato E.164 (ex.: +258841234567).
 * Para Moçambique aceitamos as formas comuns de escrita: 84 123 4567, 841234567,
 * 258841234567, +258 84 123 4567, 00258841234567.
 */

/** Prefixos móveis em Moçambique (Vodacom 84/85, Tmcel 82/83, Movitel 86/87). */
export const MZ_MOBILE_PREFIXES = ['82', '83', '84', '85', '86', '87'] as const;

export type MobileOperatorMZ = 'VODACOM' | 'TMCEL' | 'MOVITEL';

/** Normaliza para E.164. Devolve null se o número não for válido. */
export function normalizePhone(input: string, defaultCountry: string | null = 'MZ'): string | null {
  let digits = input.replace(/[\s\-().]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;

  if (!digits.startsWith('+')) {
    if (defaultCountry === 'MZ') {
      if (/^258\d{9}$/.test(digits)) digits = `+${digits}`;
      else if (/^8\d{8}$/.test(digits) || /^2\d{7,8}$/.test(digits)) digits = `+258${digits}`;
      else return null;
    } else if (defaultCountry) {
      // Número nacional de outro país (ex.: "082 123 4567" na África do Sul).
      const p = parsePhoneNumberFromString(digits, defaultCountry.toUpperCase() as CountryCode);
      return p?.isValid() ? p.number : null;
    } else {
      return null;
    }
  }

  if (digits.startsWith('+258')) {
    const national = digits.slice(4);
    // Móvel: 8X + 7 dígitos. Fixo: 2X + 6/7 dígitos.
    if (/^8[2-7]\d{7}$/.test(national) || /^2\d{7,8}$/.test(national)) return digits;
    return null;
  }

  // Outros países: validação com as regras de numeração de cada país.
  const p = parsePhoneNumberFromString(digits);
  return p?.isValid() ? p.number : null;
}

export function isValidPhone(input: string): boolean {
  return normalizePhone(input) !== null;
}

/** Identifica o operador móvel moçambicano (útil para escolher M-Pesa / e-Mola / mKesh). */
export function mzMobileOperator(e164: string): MobileOperatorMZ | null {
  const m = /^\+258(8[2-7])\d{7}$/.exec(e164);
  if (!m) return null;
  switch (m[1]) {
    case '84':
    case '85':
      return 'VODACOM';
    case '82':
    case '83':
      return 'TMCEL';
    case '86':
    case '87':
      return 'MOVITEL';
    default:
      return null;
  }
}

/** Carteira móvel associada ao operador do número (M-Pesa = Vodacom, e-Mola = Movitel, mKesh = Tmcel). */
export function walletForPhone(e164: string): 'MPESA' | 'EMOLA' | 'MKESH' | null {
  const op = mzMobileOperator(e164);
  return op === 'VODACOM' ? 'MPESA' : op === 'MOVITEL' ? 'EMOLA' : op === 'TMCEL' ? 'MKESH' : null;
}

/** Apresentação legível: "+258 84 123 4567", "+27 82 123 4567". */
export function formatPhone(e164: string): string {
  const p = parsePhoneNumberFromString(e164);
  return p ? p.formatInternational() : e164;
}
