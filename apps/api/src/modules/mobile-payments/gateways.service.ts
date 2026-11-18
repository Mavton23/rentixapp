import { Injectable, Logger } from '@nestjs/common';
import type { MobileMethod, MpesaGatewayInput, SimulatorGatewayInput } from '@rentix/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfig } from '../../config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { SecretBox } from '../../common/utils/secret-box';
import { badRequest, forbidden } from '../../common/utils/errors';
import type { OrgContext } from '../../common/auth-context';
import type { PaymentGateway, PaymentGatewayConfig } from '../../generated/prisma/client';
import type { MobileMoneyProvider } from './providers/provider';
import { SimulatorProvider } from './providers/simulator.provider';
import { mpesaBearer, MpesaVodacomProvider, type MpesaCredentials } from './providers/mpesa.provider';

export interface ResolvedGateway {
  config: PaymentGatewayConfig;
  provider: MobileMoneyProvider;
}

/**
 * Ligações de cada organização aos fornecedores de pagamento.
 * As credenciais ficam cifradas e nunca são devolvidas pela API.
 */
@Injectable()
export class GatewaysService {
  private readonly logger = new Logger(GatewaysService.name);
  private readonly box: SecretBox;
  /** O simulador guarda o resultado em memória para as consultas; uma só instância. */
  private readonly simulator: SimulatorProvider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {
    this.box = new SecretBox(config.get('PAYMENT_CREDENTIALS_KEY'));
    this.simulator = new SimulatorProvider(config.get('PAYMENT_SIMULATOR_DELAY_MS'));
  }

  get simulatorAllowed(): boolean {
    return this.config.get('PAYMENT_SIMULATOR_ALLOWED');
  }

  async list(ctx: OrgContext) {
    const rows = await this.prisma.paymentGatewayConfig.findMany({ where: { organizationId: ctx.organizationId } });
    const byGateway = new Map(rows.map((r) => [r.gateway, r]));
    const view = (gateway: PaymentGateway, methods: MobileMethod[]) => {
      const r = byGateway.get(gateway);
      return {
        gateway,
        enabled: r?.enabled ?? false,
        methods: (r?.methods as MobileMethod[] | undefined) ?? methods,
        hasCredentials: !!r?.credentialsEncrypted,
        publicInfo: (r?.publicInfo as Record<string, unknown> | undefined) ?? {},
        updatedAt: r?.updatedAt ?? null,
      };
    };
    return {
      gateways: [view('MPESA_VODACOM', ['MPESA']), ...(this.simulatorAllowed ? [view('SIMULATOR', ['MPESA', 'EMOLA'])] : [])],
      availableMethods: await this.availableMethods(ctx.organizationId),
      simulatorAllowed: this.simulatorAllowed,
    };
  }

  async saveMpesa(ctx: OrgContext, input: MpesaGatewayInput) {
    const existing = await this.prisma.paymentGatewayConfig.findUnique({
      where: { organizationId_gateway: { organizationId: ctx.organizationId, gateway: 'MPESA_VODACOM' } },
    });
    const previous = existing?.credentialsEncrypted
      ? (JSON.parse(this.box.decrypt(existing.credentialsEncrypted)) as Partial<MpesaCredentials>)
      : {};
    const apiKey = input.apiKey ?? previous.apiKey;
    const publicKey = input.publicKey ?? previous.publicKey;
    if (input.enabled && (!apiKey || !publicKey)) {
      throw badRequest('MPESA_CREDENTIALS_MISSING', 'Indique a API Key e a Public Key do portal M-Pesa');
    }
    if (publicKey && input.publicKey) {
      // Validar já a chave pública, para não descobrir o erro só no primeiro pagamento.
      try {
        mpesaBearer('teste', publicKey);
      } catch {
        throw badRequest('MPESA_PUBLIC_KEY_INVALID', 'A Public Key não é válida. Copie-a outra vez do portal M-Pesa.');
      }
    }

    const credentials: MpesaCredentials | null =
      apiKey && publicKey
        ? { apiKey, publicKey, serviceProviderCode: input.serviceProviderCode, environment: input.environment }
        : null;
    const data = {
      enabled: input.enabled,
      methods: ['MPESA' as const],
      credentialsEncrypted: credentials ? this.box.encrypt(JSON.stringify(credentials)) : null,
      publicInfo: {
        serviceProviderCode: input.serviceProviderCode,
        environment: input.environment,
        apiKeyHint: apiKey ? `…${apiKey.slice(-4)}` : null,
      },
    };
    await this.prisma.paymentGatewayConfig.upsert({
      where: { organizationId_gateway: { organizationId: ctx.organizationId, gateway: 'MPESA_VODACOM' } },
      update: data,
      create: { ...data, organizationId: ctx.organizationId, gateway: 'MPESA_VODACOM' },
    });
    await this.audit.log({
      organizationId: ctx.organizationId,
      actorType: 'USER',
      actorId: ctx.userId,
      action: 'payment_gateway.updated',
      entityType: 'payment_gateway',
      metadata: { gateway: 'MPESA_VODACOM', enabled: input.enabled, environment: input.environment, keysChanged: !!(input.apiKey || input.publicKey) },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return this.list(ctx);
  }

  async saveSimulator(ctx: OrgContext, input: SimulatorGatewayInput) {
    if (!this.simulatorAllowed) throw forbidden('SIMULATOR_DISABLED', 'O simulador não está disponível neste ambiente');
    await this.prisma.paymentGatewayConfig.upsert({
      where: { organizationId_gateway: { organizationId: ctx.organizationId, gateway: 'SIMULATOR' } },
      update: { enabled: input.enabled, methods: input.methods },
      create: { organizationId: ctx.organizationId, gateway: 'SIMULATOR', enabled: input.enabled, methods: input.methods },
    });
    await this.audit.log({
      organizationId: ctx.organizationId,
      actorType: 'USER',
      actorId: ctx.userId,
      action: 'payment_gateway.updated',
      entityType: 'payment_gateway',
      metadata: { gateway: 'SIMULATOR', enabled: input.enabled, methods: input.methods },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return this.list(ctx);
  }

  /** Métodos de pagamento móvel ativos na organização. */
  async availableMethods(organizationId: string): Promise<MobileMethod[]> {
    const rows = await this.prisma.paymentGatewayConfig.findMany({ where: { organizationId, enabled: true } });
    const methods = new Set<MobileMethod>();
    for (const r of rows) {
      if (r.gateway === 'SIMULATOR' && !this.simulatorAllowed) continue;
      (r.methods as MobileMethod[]).forEach((m) => methods.add(m));
    }
    return [...methods];
  }

  /** Fornecedor que cobre o método na organização. Fornecedores reais têm prioridade sobre o simulador. */
  async resolve(organizationId: string, method: MobileMethod): Promise<ResolvedGateway | null> {
    const rows = await this.prisma.paymentGatewayConfig.findMany({
      where: { organizationId, enabled: true, methods: { has: method } },
    });
    const real = rows.find((r) => r.gateway !== 'SIMULATOR');
    const chosen = real ?? (this.simulatorAllowed ? rows.find((r) => r.gateway === 'SIMULATOR') : undefined);
    if (!chosen) return null;
    return { config: chosen, provider: this.providerFor(chosen) };
  }

  /**
   * Fornecedor da própria plataforma (cobrança das subscrições ao Rentix), configurado no .env.
   * Separado das ligações das organizações: o dinheiro vai para a conta do Rentix.
   */
  platform(): { gateway: PaymentGateway; methods: MobileMethod[]; provider: MobileMoneyProvider } | null {
    const kind = this.config.get('PLATFORM_PAYMENT_GATEWAY');
    if (kind === 'simulator' && this.simulatorAllowed) return { gateway: 'SIMULATOR', methods: ['MPESA', 'EMOLA'], provider: this.simulator };
    if (kind === 'mpesa') {
      this.platformMpesa ??= new MpesaVodacomProvider({
        apiKey: this.config.get('PLATFORM_MPESA_API_KEY')!,
        publicKey: this.config.get('PLATFORM_MPESA_PUBLIC_KEY')!,
        serviceProviderCode: this.config.get('PLATFORM_MPESA_SERVICE_PROVIDER_CODE')!,
        environment: this.config.get('PLATFORM_MPESA_ENVIRONMENT'),
      });
      return { gateway: 'MPESA_VODACOM', methods: ['MPESA'], provider: this.platformMpesa };
    }
    return null;
  }

  private platformMpesa?: MpesaVodacomProvider;

  /** Instancia o fornecedor de uma configuração já guardada (também usado ao consultar pendentes). */
  providerFor(config: PaymentGatewayConfig): MobileMoneyProvider {
    switch (config.gateway) {
      case 'SIMULATOR':
        return this.simulator;
      case 'MPESA_VODACOM': {
        if (!config.credentialsEncrypted) throw new Error('M-Pesa sem credenciais');
        return new MpesaVodacomProvider(JSON.parse(this.box.decrypt(config.credentialsEncrypted)) as MpesaCredentials);
      }
    }
  }
}
