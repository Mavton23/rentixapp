import { BLANK, fillTemplate, parseBlocks, renderContractPdf } from './contract-pdf';
import { termText } from './contracts.module';
import { DEFAULT_CONTRACT_TEMPLATE } from './default-template';
import { unknownTemplateVariables } from '@rentix/shared';

describe('modelo de contrato', () => {
  it('preenche variáveis e deixa em branco as que faltam', () => {
    expect(fillTemplate('Entre {{ senhorio.nome }} e {{inquilino.nome}}, NUIT {{inquilino.nuit}}.', { 'senhorio.nome': 'A', 'inquilino.nome': 'B', 'inquilino.nuit': ' ' })).toBe(
      `Entre A e B, NUIT ${BLANK}.`,
    );
  });

  it('separa títulos, parágrafos, alíneas e assinaturas', () => {
    const blocks = parseBlocks('# Título\n\nLinha um\nlinha dois\n\n## Secção\n- a\n- b\n\n[assinaturas]');
    expect(blocks).toEqual([
      { kind: 'h1', text: 'Título' },
      { kind: 'p', text: 'Linha um linha dois' },
      { kind: 'h2', text: 'Secção' },
      { kind: 'li', text: 'a' },
      { kind: 'li', text: 'b' },
      { kind: 'signatures' },
    ]);
  });

  it('o modelo base só usa variáveis conhecidas e gera um PDF', async () => {
    expect(unknownTemplateVariables(DEFAULT_CONTRACT_TEMPLATE)).toEqual([]);
    const pdf = await renderContractPdf(parseBlocks(fillTemplate(DEFAULT_CONTRACT_TEMPLATE, {})), {
      title: 't',
      parties: { landlord: 'A', tenant: 'B' },
      footer: 'rodapé',
    });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('prazo por extenso', () => {
    expect(termText('2026-12-01', '2027-11-30')).toBe('1 (um) ano');
    expect(termText('2026-12-01', '2027-05-31')).toBe('6 meses');
    expect(termText('2026-12-15', '2028-12-14')).toBe('2 anos');
    expect(termText('2026-12-01', null)).toBe('duração indeterminada');
  });
});
