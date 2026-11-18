/** Modelos de contrato de arrendamento: variáveis disponíveis e validação. */
import { z } from 'zod';

export const CONTRACT_VARIABLES = [
  { key: 'senhorio.nome', label: 'Nome do senhorio ou imobiliária', example: 'Imobiliária Demo, Lda.' },
  { key: 'senhorio.nuit', label: 'NUIT do senhorio', example: '400123456' },
  { key: 'senhorio.morada', label: 'Morada do senhorio', example: 'Av. Julius Nyerere 1234, Maputo' },
  { key: 'senhorio.telefone', label: 'Telefone do senhorio', example: '+258 84 123 4567' },
  { key: 'senhorio.email', label: 'Email do senhorio', example: 'geral@exemplo.co.mz' },
  { key: 'inquilino.nome', label: 'Nome do inquilino', example: 'Ana Maria Sitoe' },
  { key: 'inquilino.documento', label: 'Documento do inquilino', example: 'BI n.º 110100123456B' },
  { key: 'inquilino.nuit', label: 'NUIT do inquilino', example: '100234567' },
  { key: 'inquilino.telefone', label: 'Telefone do inquilino', example: '+258 84 765 4321' },
  { key: 'inquilino.email', label: 'Email do inquilino', example: 'ana@exemplo.co.mz' },
  { key: 'inquilino.estado_civil', label: 'Estado civil do inquilino', example: 'solteira' },
  { key: 'inquilino.profissao', label: 'Profissão do inquilino', example: 'enfermeira' },
  { key: 'imovel.nome', label: 'Nome do imóvel', example: 'Edifício Polana' },
  { key: 'imovel.morada', label: 'Morada do imóvel', example: 'Rua da Resistência 45, Malhangalene, Maputo' },
  { key: 'imovel.cidade', label: 'Cidade do imóvel', example: 'Maputo' },
  { key: 'unidade.nome', label: 'Unidade (flat, loja...)', example: 'Flat 3A' },
  { key: 'unidade.descricao', label: 'Descrição da unidade (quartos, WC, área)', example: '2 quartos, 1 casa de banho, 75 metros quadrados' },
  { key: 'contrato.inicio', label: 'Data de início', example: '1 de dezembro de 2026' },
  { key: 'contrato.fim', label: 'Data de fim', example: '30 de novembro de 2027' },
  { key: 'contrato.prazo', label: 'Prazo (ex.: 12 meses)', example: '12 meses' },
  {
    key: 'contrato.duracao',
    label: 'Duração em frase (com ou sem termo)',
    example: 'é celebrado pelo prazo de 12 meses, até 30 de novembro de 2027, renovando-se por iguais períodos se nenhuma das partes o denunciar',
  },
  { key: 'contrato.renda', label: 'Renda mensal', example: '25 000,00 MTn' },
  { key: 'contrato.renda_extenso', label: 'Renda por extenso', example: 'vinte e cinco mil meticais' },
  { key: 'contrato.dia_pagamento', label: 'Dia de pagamento', example: '5' },
  { key: 'contrato.caucao', label: 'Caução', example: '50 000,00 MTn' },
  { key: 'contrato.caucao_extenso', label: 'Caução por extenso', example: 'cinquenta mil meticais' },
  { key: 'contrato.multa', label: 'Multa por atraso', example: '10%' },
  { key: 'contrato.tolerancia', label: 'Dias de tolerância antes da multa', example: '5' },
  { key: 'data.hoje', label: 'Data de hoje', example: '16 de novembro de 2026' },
  { key: 'local', label: 'Local da assinatura (cidade do senhorio)', example: 'Maputo' },
] as const;

export type ContractVariable = (typeof CONTRACT_VARIABLES)[number]['key'];
const KNOWN = new Set<string>(CONTRACT_VARIABLES.map((v) => v.key));

/** Variáveis usadas num modelo, pela ordem em que aparecem (sem repetições). */
export function templateVariables(template: string): string[] {
  const found = [...template.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!);
  return [...new Set(found)];
}

export function unknownTemplateVariables(template: string): string[] {
  return templateVariables(template).filter((v) => !KNOWN.has(v));
}

export const contractTemplateSchema = z.object({
  template: z
    .string()
    .min(50, 'O modelo é demasiado curto')
    .max(60_000, 'O modelo é demasiado longo')
    .refine((t) => unknownTemplateVariables(t).length === 0, {
      message: 'O modelo usa variáveis que não existem',
    }),
});
export type ContractTemplateInput = z.infer<typeof contractTemplateSchema>;

export const contractPreviewSchema = z.object({ template: z.string().max(60_000).optional() });
