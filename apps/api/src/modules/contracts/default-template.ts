/**
 * Modelo base de contrato de arrendamento para habitação (Moçambique).
 *
 * É um ponto de partida, não aconselhamento jurídico: cada organização deve revê-lo com um
 * jurista e adaptá-lo (o editor em Definições → Modelo de contrato diz isto mesmo).
 *
 * Sintaxe: "# " título, "## " secção, "- " alínea, **negrito**, {{variáveis}}, linha em branco
 * entre parágrafos e [assinaturas] para o bloco de assinaturas.
 */
export const DEFAULT_CONTRACT_TEMPLATE = `# Contrato de Arrendamento para Habitação

Entre:

**{{senhorio.nome}}**, com o NUIT {{senhorio.nuit}}, com sede ou residência em {{senhorio.morada}}, adiante designado por **Senhorio**;

e

**{{inquilino.nome}}**, {{inquilino.estado_civil}}, {{inquilino.profissao}}, portador(a) do {{inquilino.documento}}, com o NUIT {{inquilino.nuit}}, adiante designado(a) por **Inquilino**;

é celebrado, de boa-fé, o presente contrato de arrendamento, que se rege pelas cláusulas seguintes e, no que nelas for omisso, pela legislação aplicável na República de Moçambique.

## Cláusula 1.ª — Objeto

O Senhorio dá de arrendamento ao Inquilino a unidade **{{unidade.nome}}** ({{unidade.descricao}}) do imóvel **{{imovel.nome}}**, situado em {{imovel.morada}}, destinada exclusivamente a habitação do Inquilino e do seu agregado familiar.

## Cláusula 2.ª — Prazo

O contrato tem início a {{contrato.inicio}} e {{contrato.duracao}}.

A denúncia do contrato, por qualquer das partes, faz-se por escrito, com a antecedência mínima de 60 (sessenta) dias.

## Cláusula 3.ª — Renda

A renda mensal é de **{{contrato.renda}}** ({{contrato.renda_extenso}}), a pagar até ao dia {{contrato.dia_pagamento}} de cada mês a que respeita.

O pagamento pode ser feito por M-Pesa, e-Mola, transferência bancária ou outro meio aceite pelo Senhorio. Por cada pagamento é emitido um recibo, que o Inquilino pode consultar no portal do inquilino.

## Cláusula 4.ª — Atraso no pagamento

Se a renda não for paga até {{contrato.tolerancia}} dias depois da data de vencimento, acresce uma penalização de {{contrato.multa}} sobre o valor em dívida, sem prejuízo do direito do Senhorio a resolver o contrato nos termos legais.

## Cláusula 5.ª — Caução

Na data da assinatura, o Inquilino entrega a quantia de **{{contrato.caucao}}** ({{contrato.caucao_extenso}}) a título de caução, que será devolvida no fim do contrato, depois de verificado o estado do locado e descontados os valores em dívida ou os danos que não resultem do uso normal.

## Cláusula 6.ª — Uso e conservação

O Inquilino obriga-se a:

- usar o locado com prudência e apenas para habitação;
- mantê-lo em bom estado de conservação e limpeza;
- não fazer obras ou alterações sem autorização escrita do Senhorio;
- não ceder, sublocar ou emprestar o locado, no todo ou em parte, sem autorização escrita do Senhorio;
- permitir a visita do Senhorio, com aviso prévio razoável, para verificar o estado do locado ou realizar obras necessárias.

As reparações de estrutura e as obras necessárias que não resultem de mau uso são da responsabilidade do Senhorio.

## Cláusula 7.ª — Despesas

São da responsabilidade do Inquilino os consumos de água, energia elétrica, gás, telecomunicações e outros serviços que contrate para o locado, bem como as taxas de lixo e de condomínio, quando aplicáveis, salvo acordo escrito em contrário.

## Cláusula 8.ª — Fim do contrato e entrega

No fim do contrato, o Inquilino entrega o locado livre de pessoas e bens, no estado em que o recebeu, ressalvado o desgaste do uso normal, juntamente com todas as chaves.

## Cláusula 9.ª — Comunicações

As comunicações entre as partes são feitas para os contactos indicados neste contrato (telefone {{senhorio.telefone}} e email {{senhorio.email}}, do Senhorio; telefone {{inquilino.telefone}} e email {{inquilino.email}}, do Inquilino), ou para outros que as partes venham a comunicar por escrito.

## Cláusula 10.ª — Foro

Para a resolução de qualquer litígio emergente deste contrato, as partes elegem o foro da comarca de {{imovel.cidade}}, com renúncia a qualquer outro.

Feito em {{local}}, a {{data.hoje}}, em dois exemplares de igual valor, ficando um em poder de cada parte.

[assinaturas]
`;

/**
 * Base template in English. Same structure and variables as the Portuguese one; also a
 * starting point only, to be reviewed by a lawyer for the jurisdiction where it is used.
 */
export const DEFAULT_CONTRACT_TEMPLATE_EN = `# Residential Lease Agreement

Between:

**{{senhorio.nome}}**, tax number (NUIT) {{senhorio.nuit}}, with registered office or residence at {{senhorio.morada}}, hereinafter the **Landlord**;

and

**{{inquilino.nome}}**, {{inquilino.estado_civil}}, {{inquilino.profissao}}, holder of {{inquilino.documento}}, tax number (NUIT) {{inquilino.nuit}}, hereinafter the **Tenant**;

this lease agreement is entered into in good faith and is governed by the following clauses and, where they are silent, by the applicable law.

## Clause 1 — Premises

The Landlord lets to the Tenant the unit **{{unidade.nome}}** ({{unidade.descricao}}) of the property **{{imovel.nome}}**, located at {{imovel.morada}}, to be used exclusively as a residence for the Tenant and the Tenant's household.

## Clause 2 — Term

The lease starts on {{contrato.inicio}} and {{contrato.duracao}}.

Either party may terminate the lease by written notice given at least 60 (sixty) days in advance.

## Clause 3 — Rent

The monthly rent is **{{contrato.renda}}** ({{contrato.renda_extenso}}), payable by day {{contrato.dia_pagamento}} of each month to which it relates.

Payment may be made by M-Pesa, e-Mola, bank transfer or any other method accepted by the Landlord. A receipt is issued for each payment and can be viewed by the Tenant in the tenant portal.

## Clause 4 — Late payment

If the rent is not paid within {{contrato.tolerancia}} days after the due date, a penalty of {{contrato.multa}} of the amount owed is added, without prejudice to the Landlord's right to terminate the lease under the law.

## Clause 5 — Deposit

On signing, the Tenant pays **{{contrato.caucao}}** ({{contrato.caucao_extenso}}) as a deposit, to be returned at the end of the lease after the condition of the premises has been checked and any amounts owed or damage beyond normal wear and tear have been deducted.

## Clause 6 — Use and upkeep

The Tenant undertakes to:

- use the premises with care and only as a residence;
- keep them in good condition and clean;
- make no works or alterations without the Landlord's written consent;
- not assign, sublet or lend the premises, in whole or in part, without the Landlord's written consent;
- allow the Landlord to visit, with reasonable prior notice, to check the condition of the premises or carry out necessary works.

Structural repairs and necessary works not caused by misuse are the Landlord's responsibility.

## Clause 7 — Running costs

The Tenant pays for water, electricity, gas, telecommunications and any other services contracted for the premises, as well as refuse and service charges where applicable, unless otherwise agreed in writing.

## Clause 8 — End of the lease

At the end of the lease, the Tenant returns the premises vacant and in the condition in which they were received, except for normal wear and tear, together with all keys.

## Clause 9 — Notices

Notices between the parties are sent to the contacts given in this agreement (the Landlord's phone {{senhorio.telefone}} and email {{senhorio.email}}; the Tenant's phone {{inquilino.telefone}} and email {{inquilino.email}}), or to any others that the parties notify in writing.

## Clause 10 — Jurisdiction

Any dispute arising from this agreement shall be settled by the courts of {{imovel.cidade}}, the parties waiving any other jurisdiction.

Signed in {{local}} on {{data.hoje}}, in two copies of equal value, one for each party.

[assinaturas]
`;

/** Modelo base no idioma da organização. */
export const defaultContractTemplate = (locale: 'pt' | 'en') => (locale === 'en' ? DEFAULT_CONTRACT_TEMPLATE_EN : DEFAULT_CONTRACT_TEMPLATE);
