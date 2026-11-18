import { z } from 'zod';

/**
 * Mensagens de validação por omissão, em português (as traduções estão nos dicionários).
 * Só se aplicam quando o schema não define a sua própria mensagem.
 */
z.config({
  customError: (iss) => {
    switch (iss.code) {
      case 'invalid_type':
        return iss.input === undefined || iss.input === null ? 'Campo obrigatório' : 'Valor inválido';
      case 'too_small':
        if (iss.origin === 'string') return Number(iss.minimum) <= 1 ? 'Campo obrigatório' : `Mínimo de ${iss.minimum} caracteres`;
        if (iss.origin === 'array' || iss.origin === 'set') return `Escolha pelo menos ${iss.minimum}`;
        return `O valor mínimo é ${iss.minimum}`;
      case 'too_big':
        if (iss.origin === 'string') return `Máximo de ${iss.maximum} caracteres`;
        if (iss.origin === 'array' || iss.origin === 'set') return `No máximo ${iss.maximum}`;
        return `O valor máximo é ${iss.maximum}`;
      case 'invalid_format':
        if (iss.format === 'email') return 'Email inválido';
        if (iss.format === 'url') return 'URL inválido';
        if (iss.format === 'uuid') return 'Identificador inválido';
        return 'Formato inválido';
      case 'invalid_value':
        return 'Opção inválida';
      case 'not_multiple_of':
        return 'Valor inválido';
      case 'unrecognized_keys':
        return 'Campos não reconhecidos';
      default:
        return 'Valor inválido';
    }
  },
});
