export type ProviderMode = 'unavailable' | 'sandbox' | 'live';

export interface ProviderStatus {
  name: string;
  mode: ProviderMode;
  available: boolean;
  message: string;
}

export interface ExternalTransferDispatchRequest {
  reference: string;
  transferType: 'DOMESTIC' | 'INTERNATIONAL';
  amount: string;
  currency: string;
  recipientName: string;
  recipientAccountNumber: string;
  recipientBank: string;
  recipientCountry: string;
  recipientCurrency: string;
  description: string;
}

export interface ExternalTransferDispatchResult {
  accepted: boolean;
  providerName: string;
  providerReference?: string;
  status: 'PROCESSING' | 'FAILED';
  message: string;
}

export interface IBankingPartnerAdapter {
  getStatus(): ProviderStatus;
  dispatchTransfer(req: ExternalTransferDispatchRequest): Promise<ExternalTransferDispatchResult>;
}

export interface DepositInitRequest {
  reference: string;
  amount: string;
  currency: string;
  method: 'BANK_TRANSFER' | 'CARD_PAYMENT' | 'PAYMENT_GATEWAY' | 'PARTNER_ACCOUNT';
  customerEmail: string;
}

export interface DepositInitResult {
  initiated: boolean;
  providerName: string;
  providerReference?: string;
  instructions: string;
}

export interface IPaymentGatewayAdapter {
  getStatus(): ProviderStatus;
  initiateDeposit(req: DepositInitRequest): Promise<DepositInitResult>;
}

export interface FxRateQuote {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  sourceProvider: string;
  isLive: boolean;
  fetchedAt: string;
}

export interface IFxRateProvider {
  getStatus(): ProviderStatus;
  getRate(baseCurrency: string, quoteCurrency: string): Promise<FxRateQuote | null>;
}

export interface CardIssuanceRequest {
  userId: number;
  cardholderName: string;
  cardType: 'VIRTUAL' | 'PHYSICAL';
  currency: string;
}

export interface CardIssuanceResult {
  issued: boolean;
  providerName: string;
  providerCardToken?: string;
  last4?: string;
  expiryMonth?: number;
  expiryYear?: number;
  cardBrand?: string;
  status: 'PENDING_ISSUANCE' | 'ACTIVE';
  message: string;
}

export interface ICardIssuerAdapter {
  getStatus(): ProviderStatus;
  issueCard(req: CardIssuanceRequest): Promise<CardIssuanceResult>;
}

export interface IKycProviderAdapter {
  getStatus(): ProviderStatus;
}

export interface INotificationProvider {
  getEmailStatus(): ProviderStatus;
  getSmsStatus(): ProviderStatus;
  sendEmail(to: string, subject: string, text: string, html?: string): Promise<boolean>;
  sendSms(to: string, message: string): Promise<boolean>;
}
