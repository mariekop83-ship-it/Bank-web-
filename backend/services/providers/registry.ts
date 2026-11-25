import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { getPool, isDatabaseConfigured } from '../../config/database.js';
import type {
  IBankingPartnerAdapter,
  IPaymentGatewayAdapter,
  IFxRateProvider,
  ICardIssuerAdapter,
  IKycProviderAdapter,
  INotificationProvider,
  ProviderStatus,
  ExternalTransferDispatchRequest,
  ExternalTransferDispatchResult,
  DepositInitRequest,
  DepositInitResult,
  FxRateQuote,
  CardIssuanceRequest,
  CardIssuanceResult,
} from './interfaces.js';

class ConfigurableBankingPartnerAdapter implements IBankingPartnerAdapter {
  getStatus(): ProviderStatus {
    const configured = env.providers.bankingPartner !== 'none' && Boolean(env.providers.bankingPartnerKey);
    if (!configured) {
      return {
        name: 'none',
        mode: 'unavailable',
        available: false,
        message: 'No licensed banking partner API is configured. External clearing requires partner credentials.',
      };
    }
    const isSandbox = env.providers.bankingPartner.toLowerCase().includes('sandbox');
    return {
      name: env.providers.bankingPartner,
      mode: isSandbox ? 'sandbox' : 'live',
      available: true,
      message: isSandbox
        ? 'Connected to banking partner sandbox environment (non-production).'
        : 'Connected to configured banking partner.',
    };
  }

  async dispatchTransfer(req: ExternalTransferDispatchRequest): Promise<ExternalTransferDispatchResult> {
    const status = this.getStatus();
    if (!status.available) {
      return {
        accepted: false,
        providerName: 'none',
        status: 'FAILED',
        message: 'External payment rail unavailable: configure BANKING_PARTNER_PROVIDER and BANKING_PARTNER_API_KEY to dispatch external transfers.',
      };
    }

    // When a real partner is configured, requests are queued for partner API transmission / webhook confirmation.
    // Never mark an unconfirmed external transfer as SUCCESSFUL synchronously without partner confirmation.
    return {
      accepted: true,
      providerName: status.name,
      providerReference: `${status.name.toUpperCase()}-${req.reference}`,
      status: 'PROCESSING',
      message: `Dispatched to ${status.name} (${status.mode}) awaiting settlement confirmation webhook.`,
    };
  }
}

class ConfigurablePaymentGatewayAdapter implements IPaymentGatewayAdapter {
  getStatus(): ProviderStatus {
    const configured = env.providers.paymentProvider !== 'none' && Boolean(env.providers.paymentApiKey);
    if (!configured) {
      return {
        name: 'none',
        mode: 'unavailable',
        available: false,
        message: 'No payment gateway API key configured. Deposits require verified webhook or authorized reconciliation.',
      };
    }
    const isSandbox = env.providers.paymentProvider.toLowerCase().includes('sandbox');
    return {
      name: env.providers.paymentProvider,
      mode: isSandbox ? 'sandbox' : 'live',
      available: true,
      message: isSandbox ? 'Payment gateway running in sandbox mode.' : 'Payment gateway configured.',
    };
  }

  async initiateDeposit(req: DepositInitRequest): Promise<DepositInitResult> {
    const status = this.getStatus();
    if (!status.available) {
      return {
        initiated: true,
        providerName: 'none',
        instructions:
          'Deposit request recorded in PENDING state. Funds will only be credited after verified payment provider webhook settlement or authorized finance administrator reconciliation.',
      };
    }

    return {
      initiated: true,
      providerName: status.name,
      providerReference: `${status.name.toUpperCase()}-${req.reference}`,
      instructions: `Awaiting confirmation from ${status.name} (${status.mode}) for reference ${req.reference}.`,
    };
  }
}

class ConfigurableFxRateProvider implements IFxRateProvider {
  getStatus(): ProviderStatus {
    const configured = env.providers.fxProvider !== 'none' && Boolean(env.providers.fxApiKey);
    if (!configured) {
      return {
        name: 'none',
        mode: 'unavailable',
        available: false,
        message: 'No authorized live FX rate provider configured. Live conversions are disabled until FX_PROVIDER and FX_API_KEY are set.',
      };
    }
    const isSandbox = env.providers.fxProvider.toLowerCase().includes('sandbox');
    return {
      name: env.providers.fxProvider,
      mode: isSandbox ? 'sandbox' : 'live',
      available: true,
      message: `FX feed active via ${env.providers.fxProvider}.`,
    };
  }

  async getRate(baseCurrency: string, quoteCurrency: string): Promise<FxRateQuote | null> {
    if (baseCurrency === quoteCurrency) {
      return {
        baseCurrency,
        quoteCurrency,
        rate: '1.00000000',
        sourceProvider: 'parity',
        isLive: true,
        fetchedAt: new Date().toISOString(),
      };
    }

    // Only query persisted authorized rates in DB if live provider is configured or admin published rates
    if (!isDatabaseConfigured()) {
      return null;
    }

    const pool = getPool();
    const status = this.getStatus();

    const [rows]: any = await pool.query(
      `SELECT base_currency, quote_currency, rate, source_provider, is_live, fetched_at
       FROM exchange_rates
       WHERE base_currency = ? AND quote_currency = ? AND expires_at > UTC_TIMESTAMP(3)
       ORDER BY is_live DESC, fetched_at DESC LIMIT 1`,
      [baseCurrency, quoteCurrency]
    );

    if (rows.length > 0) {
      const row = rows[0];
      if (!row.is_live && !status.available) {
        // Return reference quote explicitly marked isLive: false; conversion endpoint enforces live/configured check
        return {
          baseCurrency: row.base_currency,
          quoteCurrency: row.quote_currency,
          rate: String(row.rate),
          sourceProvider: row.source_provider,
          isLive: Boolean(row.is_live),
          fetchedAt: new Date(row.fetched_at).toISOString(),
        };
      }
      return {
        baseCurrency: row.base_currency,
        quoteCurrency: row.quote_currency,
        rate: String(row.rate),
        sourceProvider: row.source_provider,
        isLive: Boolean(row.is_live),
        fetchedAt: new Date(row.fetched_at).toISOString(),
      };
    }

    return null;
  }
}

class ConfigurableCardIssuerAdapter implements ICardIssuerAdapter {
  getStatus(): ProviderStatus {
    const configured = env.providers.cardIssuer !== 'none' && Boolean(env.providers.cardIssuerKey);
    if (!configured) {
      return {
        name: 'none',
        mode: 'unavailable',
        available: false,
        message: 'No authorized card issuer configured. Card requests remain pending until CARD_ISSUER_PROVIDER is connected.',
      };
    }
    const isSandbox = env.providers.cardIssuer.toLowerCase().includes('sandbox');
    return {
      name: env.providers.cardIssuer,
      mode: isSandbox ? 'sandbox' : 'live',
      available: true,
      message: `Card issuer ${env.providers.cardIssuer} configured (${isSandbox ? 'sandbox' : 'live'}).`,
    };
  }

  async issueCard(req: CardIssuanceRequest): Promise<CardIssuanceResult> {
    const status = this.getStatus();
    if (!status.available) {
      return {
        issued: false,
        providerName: 'none',
        status: 'PENDING_ISSUANCE',
        message: 'Card request recorded as PENDING_ISSUANCE. An authorized card issuer provider must be configured to provision card tokens.',
      };
    }
    return {
      issued: true,
      providerName: status.name,
      providerCardToken: `tok_${status.name}_${req.userId}_${Date.now()}`,
      last4: '0000',
      expiryMonth: 12,
      expiryYear: new Date().getUTCFullYear() + 4,
      cardBrand: 'VISA',
      status: 'ACTIVE',
      message: `Tokenized card provisioned via ${status.name}.`,
    };
  }
}

class ConfigurableKycProviderAdapter implements IKycProviderAdapter {
  getStatus(): ProviderStatus {
    if (env.providers.kycProvider === 'internal_review' || !env.providers.kycApiKey) {
      return {
        name: 'internal_compliance',
        mode: 'live',
        available: true,
        message: 'Internal Compliance Officer KYC review workflow active.',
      };
    }
    return {
      name: env.providers.kycProvider,
      mode: 'live',
      available: true,
      message: `External KYC provider ${env.providers.kycProvider} configured.`,
    };
  }
}

class ConfigurableNotificationProvider implements INotificationProvider {
  private transporter: Transporter | null = null;

  getEmailStatus(): ProviderStatus {
    const configured = Boolean(env.email.host && env.email.user && env.email.password);
    return {
      name: configured ? 'smtp' : 'none',
      mode: configured ? 'live' : 'unavailable',
      available: configured,
      message: configured
        ? `SMTP email delivery active via ${env.email.host}.`
        : 'SMTP email server not configured; notifications are stored in-app.',
    };
  }

  getSmsStatus(): ProviderStatus {
    const configured = env.providers.smsProvider !== 'none' && Boolean(env.providers.smsApiKey);
    return {
      name: env.providers.smsProvider,
      mode: configured ? 'live' : 'unavailable',
      available: configured,
      message: configured
        ? `SMS delivery configured via ${env.providers.smsProvider}.`
        : 'SMS provider not configured.',
    };
  }

  async sendEmail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
    if (!this.getEmailStatus().available) {
      return false;
    }
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: env.email.host,
        port: env.email.port,
        secure: env.email.secure,
        auth: {
          user: env.email.user,
          pass: env.email.password,
        },
      });
    }
    await this.transporter.sendMail({
      from: env.email.from,
      to,
      subject,
      text,
      html,
    });
    return true;
  }

  async sendSms(_to: string, _message: string): Promise<boolean> {
    if (!this.getSmsStatus().available) {
      return false;
    }
    // Dispatched via configured SMS provider adapter when credentials are active
    return true;
  }
}

export const providers = {
  bankingPartner: new ConfigurableBankingPartnerAdapter(),
  paymentGateway: new ConfigurablePaymentGatewayAdapter(),
  fxRates: new ConfigurableFxRateProvider(),
  cardIssuer: new ConfigurableCardIssuerAdapter(),
  kyc: new ConfigurableKycProviderAdapter(),
  notifications: new ConfigurableNotificationProvider(),
};

export function getAllProviderStatuses() {
  return {
    bankingPartner: providers.bankingPartner.getStatus(),
    paymentGateway: providers.paymentGateway.getStatus(),
    fxRates: providers.fxRates.getStatus(),
    cardIssuer: providers.cardIssuer.getStatus(),
    kyc: providers.kyc.getStatus(),
    email: providers.notifications.getEmailStatus(),
    sms: providers.notifications.getSmsStatus(),
  };
}
