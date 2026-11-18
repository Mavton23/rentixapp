import { formatMoney, intlLocale, normalizeLocale } from '@rentix/shared';
import { translator } from '../../common/i18n';

/**
 * Modelos de mensagens. Cada modelo produz o texto para email (subject + body) e uma
 * versão curta para SMS/WhatsApp (≤ 160 caracteres sempre que possível).
 * Para acrescentar um idioma, adicionar a chave do locale em cada modelo.
 */

export interface Rendered {
  subject: string;
  body: string;
  sms: string;
}

interface MoneyRef {
  amount: number;
  currency: string;
}

export interface TemplateData {
  WELCOME: { name: string; organizationName: string; appUrl: string };
  STAFF_PASSWORD_RESET: { name: string; resetUrl: string };
  TENANT_PASSWORD_RESET: { name: string; resetUrl: string };
  TENANT_INVITE: { tenantName: string; organizationName: string; inviteUrl: string };
  INVOICE_ISSUED: { tenantName: string; organizationName: string; number: string; description: string; due: MoneyRef; dueDate: string; portalUrl: string };
  PAYMENT_REMINDER: { tenantName: string; organizationName: string; number: string; due: MoneyRef; dueDate: string; portalUrl: string };
  INVOICE_OVERDUE: { tenantName: string; organizationName: string; number: string; due: MoneyRef; dueDate: string; portalUrl: string };
  LATE_FEE_APPLIED: { tenantName: string; organizationName: string; number: string; fee: MoneyRef; parentNumber: string };
  PAYMENT_RECEIVED: { tenantName: string; organizationName: string; receiptNumber: string; paid: MoneyRef; invoiceNumber: string; remaining: MoneyRef };
  CONTACT_MESSAGE: { name: string; email: string; phone: string; subject: string; message: string };
  LISTING_REVIEWED: { name: string; title: string; approved: boolean; reason: string; url: string };
  LISTING_INTEREST: { name: string; title: string; interestedOrg: string; message: string; url: string };
  LISTING_INTEREST_ACCEPTED: { name: string; title: string; ownerOrg: string; contact: string; url: string };
  TRIAL_ENDING: { name: string; organizationName: string; planName: string; endDate: string; url: string };
  SUBSCRIPTION_INVOICE: { name: string; organizationName: string; number: string; planName: string; due: MoneyRef; dueDate: string; renewal: boolean; url: string };
  SUBSCRIPTION_PAID: { name: string; organizationName: string; number: string; planName: string; paid: MoneyRef; periodEnd: string; url: string };
  SUBSCRIPTION_PAST_DUE: { name: string; organizationName: string; planName: string; downgradeDate: string; url: string };
  SUBSCRIPTION_DOWNGRADED: { name: string; organizationName: string; fromPlan: string; reason: 'TRIAL_ENDED' | 'CANCELED' | 'UNPAID' | 'CHANGED'; url: string };
  MEMBER_INVITE: { organizationName: string; invitedBy: string; role: string; inviteUrl: string; expiresDays: number };
}

export type TemplateKey = keyof TemplateData;

const m = (x: MoneyRef) => formatMoney(x.amount, x.currency);
const fmtDate = (iso: string) => {
  const [y, mo, d] = iso.split('-');
  return `${d}/${mo}/${y}`;
};

const pt: { [K in TemplateKey]: (d: TemplateData[K]) => Rendered } = {
  WELCOME: (d) => ({
    subject: `Bem-vindo(a) ao Rentix, ${d.name}`,
    body: `Olá ${d.name},\n\nA sua conta e a organização "${d.organizationName}" foram criadas.\nComece por registar os seus imóveis e inquilinos em ${d.appUrl}.\n\nEquipa Rentix`,
    sms: `Rentix: conta criada para ${d.organizationName}. Aceda em ${d.appUrl}`,
  }),
  STAFF_PASSWORD_RESET: (d) => ({
    subject: 'Recuperação de senha — Rentix',
    body: `Olá ${d.name},\n\nRecebemos um pedido para redefinir a sua senha. Use o link abaixo (válido por 1 hora):\n${d.resetUrl}\n\nSe não foi você, ignore esta mensagem.`,
    sms: `Rentix: redefina a sua senha em ${d.resetUrl} (válido 1h).`,
  }),
  TENANT_PASSWORD_RESET: (d) => ({
    subject: 'Recuperação de senha — Portal do Inquilino',
    body: `Olá ${d.name},\n\nPara redefinir a senha do portal do inquilino use o link (válido por 1 hora):\n${d.resetUrl}\n\nSe não foi você, ignore esta mensagem.`,
    sms: `Rentix: redefina a senha do portal em ${d.resetUrl} (válido 1h).`,
  }),
  TENANT_INVITE: (d) => ({
    subject: `${d.organizationName} convidou-o(a) para o Portal do Inquilino`,
    body: `Olá ${d.tenantName},\n\n${d.organizationName} usa o Rentix para gerir o seu arrendamento.\nNo portal pode ver as suas faturas, pagamentos e recibos.\n\nCrie a sua senha aqui (válido por 7 dias):\n${d.inviteUrl}`,
    sms: `${d.organizationName}: aceda ao portal do inquilino e veja as suas faturas: ${d.inviteUrl}`,
  }),
  INVOICE_ISSUED: (d) => ({
    subject: `Fatura ${d.number} — ${d.description}`,
    body: `Olá ${d.tenantName},\n\nFoi emitida a fatura ${d.number} (${d.description}) no valor de ${m(d.due)}, com vencimento a ${fmtDate(d.dueDate)}.\n\nDetalhes: ${d.portalUrl}\n\n${d.organizationName}`,
    sms: `${d.organizationName}: fatura ${d.number} de ${m(d.due)} vence a ${fmtDate(d.dueDate)}.`,
  }),
  PAYMENT_REMINDER: (d) => ({
    subject: `Lembrete: a fatura ${d.number} vence a ${fmtDate(d.dueDate)}`,
    body: `Olá ${d.tenantName},\n\nLembramos que a fatura ${d.number}, com ${m(d.due)} em aberto, vence a ${fmtDate(d.dueDate)}.\n\nDetalhes: ${d.portalUrl}\n\n${d.organizationName}`,
    sms: `${d.organizationName}: lembrete — ${m(d.due)} da fatura ${d.number} vence a ${fmtDate(d.dueDate)}.`,
  }),
  INVOICE_OVERDUE: (d) => ({
    subject: `Fatura ${d.number} em atraso`,
    body: `Olá ${d.tenantName},\n\nA fatura ${d.number} venceu a ${fmtDate(d.dueDate)} e tem ${m(d.due)} em aberto.\nPor favor regularize o pagamento para evitar multas.\n\nDetalhes: ${d.portalUrl}\n\n${d.organizationName}`,
    sms: `${d.organizationName}: a fatura ${d.number} está em atraso (${m(d.due)}). Regularize para evitar multa.`,
  }),
  LATE_FEE_APPLIED: (d) => ({
    subject: `Multa por atraso — fatura ${d.number}`,
    body: `Olá ${d.tenantName},\n\nFoi aplicada uma multa por atraso de ${m(d.fee)} referente à fatura ${d.parentNumber} (nova fatura ${d.number}).\n\n${d.organizationName}`,
    sms: `${d.organizationName}: multa de ${m(d.fee)} aplicada pelo atraso da fatura ${d.parentNumber}.`,
  }),
  PAYMENT_RECEIVED: (d) => ({
    subject: `Recibo ${d.receiptNumber} — pagamento recebido`,
    body: `Olá ${d.tenantName},\n\nConfirmamos a receção de ${m(d.paid)} referente à fatura ${d.invoiceNumber}. Recibo n.º ${d.receiptNumber}.\n${d.remaining.amount > 0 ? `Valor ainda em aberto: ${m(d.remaining)}.` : 'A fatura está totalmente paga. Obrigado!'}\n\n${d.organizationName}`,
    sms: `${d.organizationName}: recebemos ${m(d.paid)} (recibo ${d.receiptNumber}).${d.remaining.amount > 0 ? ` Em aberto: ${m(d.remaining)}.` : ' Obrigado!'}`,
  }),
  CONTACT_MESSAGE: (d) => ({
    subject: `Contacto pelo site: ${d.subject}`,
    body: `De: ${d.name} <${d.email}>${d.phone ? `, ${d.phone}` : ''}\nAssunto: ${d.subject}\n\n${d.message}`,
    sms: `Rentix: nova mensagem de ${d.name} pelo site.`,
  }),
  LISTING_REVIEWED: (d) => ({
    subject: d.approved ? `Anúncio publicado: ${d.title}` : `Anúncio não aprovado: ${d.title}`,
    body: d.approved
      ? `Olá ${d.name},\n\nO seu anúncio "${d.title}" foi aprovado e já está visível no marketplace.\n${d.url}`
      : `Olá ${d.name},\n\nO seu anúncio "${d.title}" não foi aprovado.\nMotivo: ${d.reason}\n\nPode corrigi-lo e voltar a submeter: ${d.url}`,
    sms: d.approved ? `Rentix: o anúncio "${d.title}" foi publicado.` : `Rentix: o anúncio "${d.title}" não foi aprovado.`,
  }),
  LISTING_INTEREST: (d) => ({
    subject: `Novo interesse no anúncio: ${d.title}`,
    body: `Olá ${d.name},\n\n${d.interestedOrg} mostrou interesse no seu anúncio "${d.title}".${d.message ? `\n\nMensagem: ${d.message}` : ''}\n\nResponda aqui: ${d.url}`,
    sms: `Rentix: ${d.interestedOrg} tem interesse em "${d.title}".`,
  }),
  LISTING_INTEREST_ACCEPTED: (d) => ({
    subject: `Interesse aceite: ${d.title}`,
    body: `Olá ${d.name},\n\n${d.ownerOrg} aceitou o seu interesse no anúncio "${d.title}".\nContacto: ${d.contact}\n\n${d.url}`,
    sms: `Rentix: ${d.ownerOrg} aceitou o seu interesse. Contacto: ${d.contact}`,
  }),
  TRIAL_ENDING: (d) => ({
    subject: `O período de teste do Rentix termina a ${fmtDate(d.endDate)}`,
    body: `Olá ${d.name},

O período de teste do plano ${d.planName} de "${d.organizationName}" termina a ${fmtDate(d.endDate)}.
Para continuar com o ${d.planName}, escolha o plano e pague por M-Pesa ou transferência:
${d.url}

Se não fizer nada, a conta passa para o plano Grátis. Nenhum dado é apagado.

Equipa Rentix`,
    sms: `Rentix: o teste do plano ${d.planName} termina a ${fmtDate(d.endDate)}. Escolha o plano em ${d.url}`,
  }),
  SUBSCRIPTION_INVOICE: (d) => ({
    subject: `Fatura ${d.number} do Rentix: ${m(d.due)}`,
    body: `Olá ${d.name},

${d.renewal ? `A subscrição do plano ${d.planName} de "${d.organizationName}" renova a ${fmtDate(d.dueDate)}.` : `Emitimos a fatura do plano ${d.planName} para "${d.organizationName}".`}
Fatura ${d.number}: ${m(d.due)}, a pagar até ${fmtDate(d.dueDate)}.

Pague por M-Pesa ou transferência em ${d.url}

Equipa Rentix`,
    sms: `Rentix: fatura ${d.number} de ${m(d.due)} até ${fmtDate(d.dueDate)}. Pague em ${d.url}`,
  }),
  SUBSCRIPTION_PAID: (d) => ({
    subject: `Pagamento recebido: fatura ${d.number}`,
    body: `Olá ${d.name},

Recebemos ${m(d.paid)} pela fatura ${d.number}. O plano ${d.planName} de "${d.organizationName}" está ativo até ${fmtDate(d.periodEnd)}.
O recibo está em ${d.url}

Obrigado,
Equipa Rentix`,
    sms: `Rentix: pagamento de ${m(d.paid)} recebido. Plano ${d.planName} ativo até ${fmtDate(d.periodEnd)}.`,
  }),
  SUBSCRIPTION_PAST_DUE: (d) => ({
    subject: 'A renovação do Rentix está por pagar',
    body: `Olá ${d.name},

A renovação do plano ${d.planName} de "${d.organizationName}" ainda não foi paga.
O plano mantém-se até ${fmtDate(d.downgradeDate)}; depois a conta passa para o plano Grátis (nenhum dado é apagado).

Pagar agora: ${d.url}

Equipa Rentix`,
    sms: `Rentix: a renovação do plano ${d.planName} está por pagar. Pague até ${fmtDate(d.downgradeDate)} em ${d.url}`,
  }),
  SUBSCRIPTION_DOWNGRADED: (d) => {
    const why = {
      TRIAL_ENDED: 'o período de teste terminou',
      CANCELED: 'pediu para não renovar',
      UNPAID: 'a renovação não foi paga',
      CHANGED: 'mudou de plano',
    }[d.reason];
    return {
      subject: `"${d.organizationName}" passou para o plano Grátis`,
      body: `Olá ${d.name},

Como ${why}, "${d.organizationName}" passou do plano ${d.fromPlan} para o Grátis.
Todos os dados continuam lá. Se tiver mais unidades ou inquilinos do que o Grátis permite, pode consultá-los e editá-los, mas não acrescentar novos.

Voltar a um plano pago: ${d.url}

Equipa Rentix`,
      sms: `Rentix: "${d.organizationName}" passou para o plano Grátis. Os dados mantêm-se. ${d.url}`,
    };
  },
  MEMBER_INVITE: (d) => ({
    subject: `${d.invitedBy} convidou-o para a equipa de ${d.organizationName} no Rentix`,
    body: `Olá,

${d.invitedBy} convidou-o para a equipa de "${d.organizationName}" no Rentix, como ${d.role}.

Aceite o convite (válido ${d.expiresDays} dias):
${d.inviteUrl}

Se não esperava este convite, ignore esta mensagem.`,
    sms: `Rentix: ${d.invitedBy} convidou-o para ${d.organizationName}. Aceite em ${d.inviteUrl}`,
  }),
};


const me = (x: MoneyRef) => formatMoney(x.amount, x.currency, intlLocale('en'));
/** Valores que chegam em português (papel, plano, descrição da fatura). */
const tr = (s: string) => translator('en')(s);

const en: { [K in TemplateKey]: (d: TemplateData[K]) => Rendered } = {
  WELCOME: (d) => ({
    subject: `Welcome to Rentix, ${d.name}`,
    body: `Hello ${d.name},\n\nYour account and the organisation "${d.organizationName}" have been created.\nStart by adding your properties and tenants at ${d.appUrl}.\n\nThe Rentix team`,
    sms: `Rentix: account created for ${d.organizationName}. Sign in at ${d.appUrl}`,
  }),
  STAFF_PASSWORD_RESET: (d) => ({
    subject: 'Password reset — Rentix',
    body: `Hello ${d.name},\n\nWe received a request to reset your password. Use the link below (valid for 1 hour):\n${d.resetUrl}\n\nIf this wasn't you, ignore this message.`,
    sms: `Rentix: reset your password at ${d.resetUrl} (valid 1h).`,
  }),
  TENANT_PASSWORD_RESET: (d) => ({
    subject: 'Password reset — Tenant portal',
    body: `Hello ${d.name},\n\nTo reset your tenant portal password, use this link (valid for 1 hour):\n${d.resetUrl}\n\nIf this wasn't you, ignore this message.`,
    sms: `Rentix: reset your portal password at ${d.resetUrl} (valid 1h).`,
  }),
  TENANT_INVITE: (d) => ({
    subject: `${d.organizationName} invited you to the tenant portal`,
    body: `Hello ${d.tenantName},\n\n${d.organizationName} uses Rentix to manage your tenancy.\nIn the portal you can see your invoices, payments and receipts.\n\nCreate your password here (valid for 7 days):\n${d.inviteUrl}`,
    sms: `${d.organizationName}: open the tenant portal to see your invoices: ${d.inviteUrl}`,
  }),
  INVOICE_ISSUED: (d) => ({
    subject: `Invoice ${d.number} — ${tr(d.description)}`,
    body: `Hello ${d.tenantName},\n\nInvoice ${d.number} (${tr(d.description)}) has been issued for ${me(d.due)}, due on ${fmtDate(d.dueDate)}.\n\nDetails: ${d.portalUrl}\n\n${d.organizationName}`,
    sms: `${d.organizationName}: invoice ${d.number} for ${me(d.due)} is due on ${fmtDate(d.dueDate)}.`,
  }),
  PAYMENT_REMINDER: (d) => ({
    subject: `Reminder: invoice ${d.number} is due on ${fmtDate(d.dueDate)}`,
    body: `Hello ${d.tenantName},\n\nThis is a reminder that invoice ${d.number}, with ${me(d.due)} outstanding, is due on ${fmtDate(d.dueDate)}.\n\nDetails: ${d.portalUrl}\n\n${d.organizationName}`,
    sms: `${d.organizationName}: reminder — ${me(d.due)} on invoice ${d.number} is due on ${fmtDate(d.dueDate)}.`,
  }),
  INVOICE_OVERDUE: (d) => ({
    subject: `Invoice ${d.number} is overdue`,
    body: `Hello ${d.tenantName},\n\nInvoice ${d.number} was due on ${fmtDate(d.dueDate)} and has ${me(d.due)} outstanding.\nPlease settle the payment to avoid late fees.\n\nDetails: ${d.portalUrl}\n\n${d.organizationName}`,
    sms: `${d.organizationName}: invoice ${d.number} is overdue (${me(d.due)}). Please pay to avoid a late fee.`,
  }),
  LATE_FEE_APPLIED: (d) => ({
    subject: `Late fee — invoice ${d.number}`,
    body: `Hello ${d.tenantName},\n\nA late fee of ${me(d.fee)} has been applied for invoice ${d.parentNumber} (new invoice ${d.number}).\n\n${d.organizationName}`,
    sms: `${d.organizationName}: late fee of ${me(d.fee)} applied for the late payment of invoice ${d.parentNumber}.`,
  }),
  PAYMENT_RECEIVED: (d) => ({
    subject: `Receipt ${d.receiptNumber} — payment received`,
    body: `Hello ${d.tenantName},\n\nWe confirm receipt of ${me(d.paid)} for invoice ${d.invoiceNumber}. Receipt no. ${d.receiptNumber}.\n${d.remaining.amount > 0 ? `Amount still outstanding: ${me(d.remaining)}.` : 'The invoice is fully paid. Thank you!'}\n\n${d.organizationName}`,
    sms: `${d.organizationName}: we received ${me(d.paid)} (receipt ${d.receiptNumber}).${d.remaining.amount > 0 ? ` Outstanding: ${me(d.remaining)}.` : ' Thank you!'}`,
  }),
  CONTACT_MESSAGE: (d) => ({
    subject: `Website contact: ${d.subject}`,
    body: `From: ${d.name} <${d.email}>${d.phone ? `, ${d.phone}` : ''}\nSubject: ${d.subject}\n\n${d.message}`,
    sms: `Rentix: new message from ${d.name} on the website.`,
  }),
  LISTING_REVIEWED: (d) => ({
    subject: d.approved ? `Listing published: ${d.title}` : `Listing not approved: ${d.title}`,
    body: d.approved
      ? `Hello ${d.name},\n\nYour listing "${d.title}" has been approved and is now visible on the marketplace.\n${d.url}`
      : `Hello ${d.name},\n\nYour listing "${d.title}" was not approved.\nReason: ${d.reason}\n\nYou can fix it and submit it again: ${d.url}`,
    sms: d.approved ? `Rentix: the listing "${d.title}" has been published.` : `Rentix: the listing "${d.title}" was not approved.`,
  }),
  LISTING_INTEREST: (d) => ({
    subject: `New interest in your listing: ${d.title}`,
    body: `Hello ${d.name},\n\n${d.interestedOrg} is interested in your listing "${d.title}".${d.message ? `\n\nMessage: ${d.message}` : ''}\n\nReply here: ${d.url}`,
    sms: `Rentix: ${d.interestedOrg} is interested in "${d.title}".`,
  }),
  LISTING_INTEREST_ACCEPTED: (d) => ({
    subject: `Interest accepted: ${d.title}`,
    body: `Hello ${d.name},\n\n${d.ownerOrg} accepted your interest in the listing "${d.title}".\nContact: ${d.contact}\n\n${d.url}`,
    sms: `Rentix: ${d.ownerOrg} accepted your interest. Contact: ${d.contact}`,
  }),
  TRIAL_ENDING: (d) => ({
    subject: `Your Rentix trial ends on ${fmtDate(d.endDate)}`,
    body: `Hello ${d.name},

The trial of the ${tr(d.planName)} plan for "${d.organizationName}" ends on ${fmtDate(d.endDate)}.
To keep ${tr(d.planName)}, choose the plan and pay by M-Pesa or bank transfer:
${d.url}

If you do nothing, the account moves to the Free plan. No data is deleted.

The Rentix team`,
    sms: `Rentix: the ${tr(d.planName)} trial ends on ${fmtDate(d.endDate)}. Choose your plan at ${d.url}`,
  }),
  SUBSCRIPTION_INVOICE: (d) => ({
    subject: `Rentix invoice ${d.number}: ${me(d.due)}`,
    body: `Hello ${d.name},

${d.renewal ? `The ${tr(d.planName)} subscription for "${d.organizationName}" renews on ${fmtDate(d.dueDate)}.` : `We have issued the ${tr(d.planName)} plan invoice for "${d.organizationName}".`}
Invoice ${d.number}: ${me(d.due)}, payable by ${fmtDate(d.dueDate)}.

Pay by M-Pesa or bank transfer at ${d.url}

The Rentix team`,
    sms: `Rentix: invoice ${d.number} for ${me(d.due)} due ${fmtDate(d.dueDate)}. Pay at ${d.url}`,
  }),
  SUBSCRIPTION_PAID: (d) => ({
    subject: `Payment received: invoice ${d.number}`,
    body: `Hello ${d.name},

We received ${me(d.paid)} for invoice ${d.number}. The ${tr(d.planName)} plan for "${d.organizationName}" is active until ${fmtDate(d.periodEnd)}.
The receipt is at ${d.url}

Thank you,
The Rentix team`,
    sms: `Rentix: payment of ${me(d.paid)} received. ${tr(d.planName)} plan active until ${fmtDate(d.periodEnd)}.`,
  }),
  SUBSCRIPTION_PAST_DUE: (d) => ({
    subject: 'Your Rentix renewal is unpaid',
    body: `Hello ${d.name},

The renewal of the ${tr(d.planName)} plan for "${d.organizationName}" has not been paid yet.
The plan stays active until ${fmtDate(d.downgradeDate)}; after that the account moves to the Free plan (no data is deleted).

Pay now: ${d.url}

The Rentix team`,
    sms: `Rentix: the ${tr(d.planName)} renewal is unpaid. Pay by ${fmtDate(d.downgradeDate)} at ${d.url}`,
  }),
  SUBSCRIPTION_DOWNGRADED: (d) => {
    const why = {
      TRIAL_ENDED: 'the trial has ended',
      CANCELED: 'you asked not to renew',
      UNPAID: 'the renewal was not paid',
      CHANGED: 'you changed plan',
    }[d.reason];
    return {
      subject: `"${d.organizationName}" is now on the Free plan`,
      body: `Hello ${d.name},

Because ${why}, "${d.organizationName}" moved from the ${tr(d.fromPlan)} plan to Free.
All your data is still there. If you have more units or tenants than Free allows, you can view and edit them, but not add new ones.

Go back to a paid plan: ${d.url}

The Rentix team`,
      sms: `Rentix: "${d.organizationName}" is now on the Free plan. Your data is kept. ${d.url}`,
    };
  },
  MEMBER_INVITE: (d) => ({
    subject: `${d.invitedBy} invited you to the ${d.organizationName} team on Rentix`,
    body: `Hello,

${d.invitedBy} invited you to join the "${d.organizationName}" team on Rentix as ${tr(d.role)}.

Accept the invitation (valid for ${d.expiresDays} days):
${d.inviteUrl}

If you weren't expecting this invitation, ignore this message.`,
    sms: `Rentix: ${d.invitedBy} invited you to ${d.organizationName}. Accept at ${d.inviteUrl}`,
  }),
};

const LOCALES: Record<string, typeof pt> = { pt, en };

export function render<K extends TemplateKey>(key: K, data: TemplateData[K], locale = 'pt'): Rendered {
  const set = LOCALES[normalizeLocale(locale)] ?? pt;
  return (set[key] as (d: TemplateData[K]) => Rendered)(data);
}
