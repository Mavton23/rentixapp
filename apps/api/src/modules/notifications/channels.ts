import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';

export interface OutgoingMessage {
  to: string;
  subject?: string | null;
  body: string;
  /** Identificador estável da mensagem (ex.: id da notificação). Evita duplicados se um reenvio se seguir a um envio já aceite. */
  idempotencyKey?: string;
}

export interface SendResult {
  providerMessageId?: string;
}

/** Interface comum a todos os canais. Para integrar um gateway SMS local, implementar esta interface. */
export interface MessageChannel {
  send(msg: OutgoingMessage): Promise<SendResult>;
}

/**
 * Envio de email pelo Resend (REST, sem SDK, tal como o Twilio).
 * https://resend.com/docs/api-reference/emails/send-email
 */
export class ResendChannel implements MessageChannel {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = fetch,
    /** Espera máxima aceite antes de repetir um pedido limitado (429). */
    private readonly maxRetryWaitMs = 5_000,
  ) {}

  async send(msg: OutgoingMessage): Promise<SendResult> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (msg.idempotencyKey) headers['Idempotency-Key'] = msg.idempotencyKey;
    const payload = JSON.stringify({
      from: this.from,
      to: [msg.to],
      subject: msg.subject ?? 'Rentix',
      text: msg.body,
    });

    let res = await this.post(headers, payload);
    // O Resend limita o ritmo (429). Uma segunda tentativa curta evita desperdiçar uma tentativa da fila.
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) * 1000;
      if (Number.isFinite(wait) && wait > 0 && wait <= this.maxRetryWaitMs) {
        await new Promise((r) => setTimeout(r, wait));
        res = await this.post(headers, payload);
      }
    }

    const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string; message?: string };
    if (!res.ok) throw new Error(`Resend ${res.status}${body.name ? ` (${body.name})` : ''}: ${body.message ?? 'erro'}`);
    return { providerMessageId: body.id };
  }

  private post(headers: Record<string, string>, body: string): Promise<Response> {
    return this.fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(20_000),
    });
  }
}

/** Fornecedor de desenvolvimento: escreve no log em vez de enviar. */
@Injectable()
export class LogEmailChannel implements MessageChannel {
  private readonly logger = new Logger('EmailChannel');
  async send(msg: OutgoingMessage): Promise<SendResult> {
    this.logger.log(`[sem RESEND_API_KEY] Email para ${msg.to}: ${msg.subject}\n${msg.body}`);
    return {};
  }
}

/** Escolhe o canal de email: Resend se houver chave, senão só log. */
export function buildEmailChannel(config: AppConfig): MessageChannel {
  const apiKey = config.get('RESEND_API_KEY');
  return apiKey ? new ResendChannel(apiKey, config.get('MAIL_FROM')) : new LogEmailChannel();
}

/** Fornecedor de desenvolvimento: escreve no log em vez de enviar. */
@Injectable()
export class LogSmsChannel implements MessageChannel {
  private readonly logger = new Logger('SmsChannel');
  async send(msg: OutgoingMessage): Promise<SendResult> {
    this.logger.log(`[SMS] ${msg.to}: ${msg.body}`);
    return {};
  }
}

@Injectable()
export class LogWhatsAppChannel implements MessageChannel {
  private readonly logger = new Logger('WhatsAppChannel');
  async send(msg: OutgoingMessage): Promise<SendResult> {
    this.logger.log(`[WhatsApp] ${msg.to}: ${msg.body}`);
    return {};
  }
}

/**
 * Envio por Twilio (REST, sem SDK). Serve para SMS e WhatsApp.
 * https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource
 */
export class TwilioChannel implements MessageChannel {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly from: string,
    private readonly kind: 'sms' | 'whatsapp',
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(msg: OutgoingMessage): Promise<SendResult> {
    const to = this.kind === 'whatsapp' ? `whatsapp:${msg.to}` : msg.to;
    const params = new URLSearchParams({ To: to, Body: msg.body });
    // Um Messaging Service SID (MG...) usa outro parâmetro.
    if (this.from.startsWith('MG')) params.set('MessagingServiceSid', this.from);
    else params.set('From', this.from);

    const res = await this.fetchFn(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
        signal: AbortSignal.timeout(20_000),
      },
    );
    const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (!res.ok) throw new Error(`Twilio ${res.status}${body.code ? ` (${body.code})` : ''}: ${body.message ?? 'erro'}`);
    return { providerMessageId: body.sid };
  }
}

/** Escolhe o canal de SMS/WhatsApp conforme a configuração. */
export function buildMessagingChannels(config: AppConfig): { sms: MessageChannel; whatsapp: MessageChannel } {
  const sid = config.get('TWILIO_ACCOUNT_SID');
  const token = config.get('TWILIO_AUTH_TOKEN');
  const sms =
    config.get('SMS_PROVIDER') === 'twilio' && sid && token && config.get('TWILIO_SMS_FROM')
      ? new TwilioChannel(sid, token, config.get('TWILIO_SMS_FROM')!, 'sms')
      : new LogSmsChannel();
  const whatsapp =
    config.get('WHATSAPP_PROVIDER') === 'twilio' && sid && token && config.get('TWILIO_WHATSAPP_FROM')
      ? new TwilioChannel(sid, token, config.get('TWILIO_WHATSAPP_FROM')!.replace(/^(?!whatsapp:)/, 'whatsapp:'), 'whatsapp')
      : new LogWhatsAppChannel();
  return { sms, whatsapp };
}
