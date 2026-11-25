import React, { useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  Globe,
  Lock,
  ShieldCheck,
  Smartphone,
  Wallet,
} from 'lucide-react';
import { apiRequest, ApiError } from '../utils/api';
import { useRouter } from '../utils/router';
import type { PublicBrandConfig } from '../components/PublicLayout';
import { AlertBanner, ResilientImage, StatusText } from '../components/ui';

const HERO_IMG = '/src/assets/images/hero_banking_architecture_1795603571246.jpg';
const CARD_IMG = '/src/assets/images/personal_banking_card_1795603573213.jpg';
const TREASURY_IMG = '/src/assets/images/global_treasury_office_1795603576702.jpg';
const SECURITY_IMG = '/src/assets/images/security_vault_abstract_1795603576535.jpg';

export interface CurrencyMeta {
  code: string;
  name: string;
  symbol: string;
  minorUnits: number;
  isSupported: boolean;
  partnerAvailable: boolean;
  partnerName: string | null;
}

export interface PublicAppConfig {
  brand: PublicBrandConfig;
  currencies: CurrencyMeta[];
  providers: Record<string, { name: string; mode: string; available: boolean; message: string }>;
  publicSettings: Record<string, string>;
}

const FAQS = [
  {
    q: 'How are customer balances calculated and protected?',
    a: 'Every balance is derived strictly from an immutable, double-entry MySQL financial ledger. Every posted transfer, deposit, withdrawal, and conversion generates balanced debit and credit legs inside an ACID database transaction with row-level locking.',
  },
  {
    q: 'Which currencies are supported and how do partner rails work?',
    a: 'The platform architecture supports USD, EUR, GBP, NGN, CAD, AUD, CHF, and JPY wallets. Internal platform transfers settle instantaneously on the core ledger, while external domestic/international rails and live FX feeds operate strictly when licensed financial partner credentials are configured.',
  },
  {
    q: 'Why does a deposit remain Pending after I submit a request or upload a receipt?',
    a: 'Customer balances are never credited merely for submitting a deposit form or uploading a receipt. Funds post to Available Balance only after independent webhook signature verification from a configured payment provider or authorized Finance Administrator reconciliation.',
  },
  {
    q: 'How is identity verification (KYC) handled?',
    a: 'Uploaded government IDs, passports, and proof-of-address documents are encrypted with AES-256-GCM and stored in private access-controlled storage—never in public web folders. Compliance Officers review submissions with full audit logging.',
  },
  {
    q: 'What security controls protect my account?',
    a: 'Accounts use bcrypt password hashing, optional transaction PINs, TOTP authenticator two-factor authentication, account lockout after repeated failed logins, device fingerprinting, and per-session revocation.',
  },
];

function FxEstimator({ currencies, fxProviderStatus }: { currencies: CurrencyMeta[]; fxProviderStatus?: { available: boolean; message: string } }) {
  const [base, setBase] = useState('USD');
  const [quote, setQuote] = useState('EUR');
  const [amount, setAmount] = useState('1000');
  const [loading, setLoading] = useState(false);
  const [quoteResult, setQuoteResult] = useState<{
    rate: string;
    sourceProvider: string;
    isLive: boolean;
    message?: string;
  } | null>(null);

  const checkRate = async () => {
    setLoading(true);
    try {
      const res = await apiRequest(`/api/public/fx-rate?base=${base}&quote=${quote}`, { authScope: 'none' });
      if (res.quote) {
        setQuoteResult(res.quote);
      } else {
        setQuoteResult({
          rate: '',
          sourceProvider: res.providerStatus?.name || 'none',
          isLive: false,
          message: res.providerStatus?.message || 'No live FX provider configured.',
        });
      }
    } catch {
      setQuoteResult({
        rate: '',
        sourceProvider: 'none',
        isLive: false,
        message: 'Unable to query exchange rate service.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
      <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Exchange Rate Transparency</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Queries configured external FX rate feeds only — never fabricated rates
          </p>
        </div>
        <StatusText status={fxProviderStatus?.available ? 'LIVE' : 'UNAVAILABLE'} />
      </div>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">Amount</label>
          <input
            type="number"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">From Currency</label>
          <select
            value={base}
            onChange={(e) => setBase(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
          >
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">To Currency</label>
          <select
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
          >
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <button
          type="button"
          onClick={checkRate}
          disabled={loading}
          className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90 transition-opacity whitespace-nowrap cursor-pointer"
        >
          {loading ? 'Checking feed...' : 'Check Authorized Rate'}
        </button>

        {quoteResult && (
          <div className="text-xs text-slate-600 dark:text-slate-300">
            {quoteResult.rate ? (
              <span className="font-mono">
                1 {base} = {quoteResult.rate} {quote} · Est. {(Number(amount || 0) * Number(quoteResult.rate)).toFixed(2)} {quote} ({quoteResult.isLive ? 'Live' : 'Reference Only'})
              </span>
            ) : (
              <span>{quoteResult.message}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function HomePage({ config }: { config: PublicAppConfig }) {
  const { navigate } = useRouter();
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <div>
      {/* Hero Section */}
      <section className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center">
              <p className="text-xs font-medium tracking-wide text-blue-700 dark:text-blue-400">
                International Digital Banking Architecture · Multi-Currency Ledger
              </p>
              <h1
                className="mt-4 font-display font-bold tracking-tight text-slate-900 dark:text-white leading-[1.1]"
                style={{ fontSize: 'clamp(2.25rem, 4vw, 3.5rem)', textWrap: 'balance' }}
              >
                {config.publicSettings.public_hero_headline || 'Cross-border accounts and institutional ledger architecture.'}
              </h1>
              <p className="mt-5 text-base text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
                Hold and reconcile balances across USD, EUR, GBP, NGN, CAD, AUD, CHF, and JPY on an atomic double-entry accounting core with private KYC compliance and granular administrative governance.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => navigate('/register')}
                  className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white transition-colors whitespace-nowrap cursor-pointer"
                >
                  <span>Open an Account</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/security')}
                  className="inline-flex items-center px-5 py-3 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors whitespace-nowrap cursor-pointer"
                >
                  Explore Security Model
                </button>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="h-full min-h-[300px] lg:min-h-[420px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800">
                <ResilientImage
                  src={HERO_IMG}
                  alt="Meridian International Bank headquarters atrium"
                  fallbackTitle="Meridian International Banking"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>

          {/* 4-column Architectural Foundations Strip below Hero Split */}
          <div className="mt-12 pt-10 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Accounting Engine</p>
              <p className="mt-1 text-lg font-display font-semibold text-slate-900 dark:text-white">Double-Entry Ledger</p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Immutable debit/credit entries with MySQL row locking and exact DECIMAL(19,4) math.</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Currency Coverage</p>
              <p className="mt-1 text-lg font-display font-semibold text-slate-900 dark:text-white">8 Global Currencies</p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">USD, EUR, GBP, NGN, CAD, AUD, CHF, and JPY wallets with segregated available and pending legs.</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Identity & Custody</p>
              <p className="mt-1 text-lg font-display font-semibold text-slate-900 dark:text-white">Encrypted KYC Vault</p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">AES-256-GCM document encryption with strict compliance review and audit trails.</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Partner Architecture</p>
              <p className="mt-1 text-lg font-display font-semibold text-slate-900 dark:text-white">Adapter-Driven Rails</p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Modular adapters for licensed banking partners, card issuers, and HMAC-verified webhooks.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Main Banking Services (Asymmetric Layout) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-2xl">
          <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
            Core banking infrastructure built for clarity
          </h2>
          <p className="mt-3 text-base text-slate-600 dark:text-slate-300 leading-relaxed">
            Every account feature connects directly to verified database records—separating internal ledger settlement from external partner payment rails.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden grid grid-cols-1 md:grid-cols-2">
            <div className="p-8 flex flex-col justify-between">
              <div>
                <p className="text-xs font-medium text-blue-700 dark:text-blue-400">01. Multi-Currency Accounts</p>
                <h3 className="mt-2 text-xl font-display font-semibold text-slate-900 dark:text-white">
                  Segregated Wallets Across 8 Currencies
                </h3>
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  Track available, pending, and total ledger balances independently per currency. Convert currencies through authorized FX providers with transparent fee schedules.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/multi-currency')}
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
              >
                <span>Explore Multi-Currency</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            <div className="min-h-[240px]">
              <ResilientImage
                src={TREASURY_IMG}
                alt="International treasury management workspace"
                fallbackTitle="Global Treasury"
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 flex flex-col justify-between">
            <div>
              <p className="text-xs font-medium text-blue-700 dark:text-blue-400">02. Cross-Border Transfers</p>
              <h3 className="mt-2 text-xl font-display font-semibold text-slate-900 dark:text-white">
                Idempotent Payment Engine
              </h3>
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Instant internal transfers between platform customers and structured partner dispatch for domestic and SWIFT international wires with transaction PIN controls.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/international-transfers')}
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
            >
              <span>Transfer Capabilities</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden grid grid-cols-1 sm:grid-cols-2">
            <div className="min-h-[200px]">
              <ResilientImage
                src={CARD_IMG}
                alt="Tokenized obsidian and brushed titanium cards"
                fallbackTitle="Tokenized Bank Cards"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="p-7 flex flex-col justify-between">
              <div>
                <p className="text-xs font-medium text-blue-700 dark:text-blue-400">03. Tokenized Cards</p>
                <h3 className="mt-2 text-lg font-display font-semibold text-slate-900 dark:text-white">
                  Virtual & Physical Card Controls
                </h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  Freeze or unfreeze cards instantly, adjust daily and monthly spending caps, and request replacements without storing raw PANs or CVVs.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/cards')}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
              >
                <span>View Card Controls</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden grid grid-cols-1 sm:grid-cols-2">
            <div className="min-h-[200px]">
              <ResilientImage
                src={SECURITY_IMG}
                alt="Precision brushed steel security architecture"
                fallbackTitle="Institutional Security"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="p-7 flex flex-col justify-between">
              <div>
                <p className="text-xs font-medium text-blue-700 dark:text-blue-400">04. Security & Governance</p>
                <h3 className="mt-2 text-lg font-display font-semibold text-slate-900 dark:text-white">
                  Zero-Trust Access & Audit Logs
                </h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  Authenticator 2FA, session revocation, RBAC administrator oversight, and immutable security event auditing across every sensitive operation.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/security')}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
              >
                <span>Security Documentation</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Currency Coverage & Live FX Transparency */}
      <section className="border-y border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            <div className="lg:col-span-5">
              <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-white">
                Supported Currencies vs. Partner Rails
              </h2>
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                We clearly distinguish core ledger currency support from external clearing rails. Currencies marked as Internal Ledger operate immediately between platform accounts; external clearing activates only when a licensed partner is configured.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                {config.currencies.map((c) => (
                  <div
                    key={c.code}
                    className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between"
                  >
                    <div>
                      <p className="text-sm font-mono font-semibold text-slate-900 dark:text-white">{c.code}</p>
                      <p className="text-xs text-slate-500">{c.name}</p>
                    </div>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {c.partnerAvailable ? 'Partner Live' : 'Ledger'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-7 space-y-6">
              <FxEstimator currencies={config.currencies} fxProviderStatus={config.providers.fxRates} />

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-6 flex items-start gap-4">
                <Smartphone className="w-5 h-5 text-blue-700 dark:text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Responsive Web & Mobile Banking Access
                  </h3>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    Access your wallets, approve transfers with your transaction PIN, freeze cards, upload encrypted KYC documents, and export PDF/CSV statements from any desktop, tablet, or mobile browser.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center">
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-slate-900 dark:text-white">
            Frequently Asked Questions
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Clear operational details on our ledger, verification, and partner integrations.
          </p>
        </div>

        <div className="mt-10 divide-y divide-slate-200 dark:divide-slate-800 border-y border-slate-200 dark:border-slate-800">
          {FAQS.map((item, idx) => (
            <div key={item.q} className="py-4">
              <button
                type="button"
                onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                className="w-full flex items-center justify-between gap-4 text-left py-2 cursor-pointer"
              >
                <span className="text-sm font-semibold text-slate-900 dark:text-white">{item.q}</span>
                <ChevronDown
                  className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${
                    openFaq === idx ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {openFaq === idx && (
                <p className="mt-2 pb-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  {item.a}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Customer Support CTA */}
        <div className="mt-12 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div>
            <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-white">
              Need assistance from Client Support?
            </h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Reach our support team directly or log a tracked inquiry ticket.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => navigate('/contact')}
              className="px-4 py-2.5 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white whitespace-nowrap cursor-pointer"
            >
              Contact Support
            </button>
            <button
              type="button"
              onClick={() => navigate('/help-center')}
              className="px-4 py-2.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 whitespace-nowrap cursor-pointer"
            >
              Help Center
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function ContentPage({
  pageKey,
  config,
}: {
  pageKey: string;
  config: PublicAppConfig;
}) {
  const { navigate } = useRouter();
  const [contactEmail, setContactEmail] = useState('');
  const [contactSubject, setContactSubject] = useState('');
  const [contactCategory, setContactCategory] = useState('GENERAL');
  const [contactMsg, setContactMsg] = useState('');
  const [contactStatus, setContactStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setContactStatus(null);
    try {
      const res = await apiRequest('/api/public/contact', {
        method: 'POST',
        authScope: 'none',
        body: {
          email: contactEmail,
          subject: contactSubject,
          category: contactCategory,
          message: contactMsg,
        },
      });
      setContactStatus({
        type: 'success',
        msg: `${res.message} Reference: ${res.reference}`,
      });
      setContactSubject('');
      setContactMsg('');
    } catch (err) {
      setContactStatus({
        type: 'error',
        msg: err instanceof ApiError ? err.message : 'Unable to send inquiry right now.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (pageKey === '/contact') {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className="text-3xl font-display font-bold text-slate-900 dark:text-white">Contact Client Support</h1>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Submit a support ticket directly to our operations queue or write to {config.brand.supportEmail}.
        </p>

        {contactStatus && (
          <div className="mt-6">
            <AlertBanner type={contactStatus.type} message={contactStatus.msg} />
          </div>
        )}

        <form onSubmit={handleContactSubmit} className="mt-8 space-y-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email Address</label>
              <input
                type="email"
                required
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Category</label>
              <select
                value={contactCategory}
                onChange={(e) => setContactCategory(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              >
                <option value="GENERAL">General Inquiry</option>
                <option value="TRANSFERS">Transfers & Payments</option>
                <option value="KYC">KYC & Verification</option>
                <option value="CARDS">Card Services</option>
                <option value="SECURITY">Security & Access</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Subject</label>
            <input
              type="text"
              required
              minLength={3}
              value={contactSubject}
              onChange={(e) => setContactSubject(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Message</label>
            <textarea
              required
              minLength={10}
              rows={5}
              value={contactMsg}
              onChange={(e) => setContactMsg(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2.5 text-sm font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white cursor-pointer"
          >
            {submitting ? 'Submitting...' : 'Submit Inquiry'}
          </button>
        </form>
      </div>
    );
  }

  if (pageKey === '/faq') {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className="text-3xl font-display font-bold text-slate-900 dark:text-white">Frequently Asked Questions</h1>
        <div className="mt-8 space-y-6">
          {FAQS.map((f) => (
            <div key={f.q} className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">{f.q}</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{f.a}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const pageContentMap: Record<
    string,
    { title: string; subtitle: string; sections: Array<{ heading: string; body: string }>; icon: React.ReactNode }
  > = {
    '/about': {
      title: `About ${config.brand.brandName}`,
      subtitle: 'Built around transparent ledger accounting, segregated partner adapters, and institutional security controls.',
      icon: <Globe className="w-5 h-5 text-blue-700 dark:text-blue-400" />,
      sections: [
        {
          heading: 'Ledger-First Financial Architecture',
          body: 'Unlike consumer apps that store a mutable single balance integer, our core engine computes every customer wallet strictly from balanced double-entry debit and credit entries inside MySQL ACID transactions.',
        },
        {
          heading: 'Honest Regulatory & Partner Separation',
          body: config.brand.legalDisclosures.regulatoryNotice,
        },
        {
          heading: 'Global Account Architecture',
          body: 'Designed for international individuals and treasury teams operating across USD, EUR, GBP, NGN, CAD, AUD, CHF, and JPY with real-time reconciliation and exportable audit trails.',
        },
      ],
    },
    '/personal': {
      title: 'Personal Banking',
      subtitle: 'Everyday multi-currency accounts, instant peer-to-peer ledger transfers, and full transaction transparency.',
      icon: <Wallet className="w-5 h-5 text-blue-700 dark:text-blue-400" />,
      sections: [
        {
          heading: 'Personal Multi-Currency Wallets',
          body: 'Hold separate balances in up to 8 currencies under one unified client profile, with clear visibility into Available, Pending, and Ledger balances.',
        },
        {
          heading: 'Protected Transfers & PIN Authorization',
          body: 'Protect every transfer with a dedicated 4–6 digit Transaction PIN, TOTP Authenticator 2FA, and idempotent duplicate-submission safeguards.',
        },
        {
          heading: 'Statements & Receipts',
          body: 'Download CSV transaction statements, print formatted banking statements, and inspect double-entry receipts for every settled payment.',
        },
      ],
    },
    '/business': {
      title: 'Business Banking & Treasury',
      subtitle: 'Structured corporate wallets, beneficiary management, and dual-control reconciliation workflows.',
      icon: <Globe className="w-5 h-5 text-blue-700 dark:text-blue-400" />,
      sections: [
        {
          heading: 'Treasury Account Tier',
          body: 'Register under our Business tier to maintain multi-currency operating wallets, saved international vendor beneficiaries, and configurable daily transfer limits.',
        },
        {
          heading: 'Reconciliation & Audit Readiness',
          body: 'Every deposit, payout, and currency conversion carries a unique reference, idempotency key, and immutable ledger journal ready for financial audits.',
        },
      ],
    },
    '/international-transfers': {
      title: 'International & Domestic Transfers',
      subtitle: 'Instant internal settlement and partner-backed external payment rails.',
      icon: <ArrowRight className="w-5 h-5 text-blue-700 dark:text-blue-400" />,
      sections: [
        {
          heading: 'Internal Platform Transfers',
          body: 'Transfers between platform customers settle atomically across internal ledger accounts with zero external clearing delay.',
        },
        {
          heading: 'External Domestic & SWIFT Transfers',
          body: 'External payouts place funds into a pending reserve and dispatch strictly through configured, licensed banking partners. External transfers are never falsely marked as settled without partner confirmation.',
        },
      ],
    },
    '/multi-currency': {
      title: 'Multi-Currency Accounts & FX',
      subtitle: 'Hold 8 major currencies and convert using authorized exchange-rate feeds.',
      icon: <Wallet className="w-5 h-5 text-blue-700 dark:text-blue-400" />,
      sections: [
        {
          heading: 'Supported Currencies',
          body: 'Open wallets in USD, EUR, GBP, NGN, CAD, AUD, CHF, and JPY. Each wallet maintains separate Available and Pending ledger sub-accounts.',
        },
        {
          heading: 'Authorized FX Conversions',
          body: config.brand.legalDisclosures.fxNotice,
        },
      ],
    },
    '/cards': {
      title: 'Tokenized Virtual & Physical Cards',
      subtitle: 'Real-time freeze/unfreeze controls and spending limits without storing raw card numbers.',
      icon: <Lock className="w-5 h-5 text-blue-700 dark:text-blue-400" />,
      sections: [
        {
          heading: 'PCI-Minded Tokenization',
          body: 'Our database stores only issuer card tokens, last 4 digits, expiry metadata, and spending limits—never raw PANs, CVVs, or card PINs.',
        },
        {
          heading: 'Instant Card Controls',
          body: 'Freeze or unfreeze active cards, adjust daily/monthly limits, toggle international or online acceptance, and request card replacements directly from your dashboard.',
        },
      ],
    },
    '/security': {
      title: 'Security & Privacy Architecture',
      subtitle: 'Defense-in-depth engineering across authentication, storage, webhooks, and administrative access.',
      icon: <ShieldCheck className="w-5 h-5 text-blue-700 dark:text-blue-400" />,
      sections: [
        {
          heading: 'Authentication & Account Takeover Defense',
          body: 'Bcrypt password hashing, brute-force account lockout after repeated failures, RFC 6238 TOTP two-factor authentication, HTTP-only secure cookies, CSRF origin validation, and active device session revocation.',
        },
        {
          heading: 'Private Encrypted KYC Custody',
          body: 'Identity documents are encrypted using AES-256-GCM before persistence and accessed exclusively via authenticated, audit-logged endpoints.',
        },
        {
          heading: 'Role-Based Admin Governance',
          body: 'Administrative access is strictly separated from customer authentication, protected by MFA, granular RBAC roles (Super Admin, Finance, Compliance, Support, Auditor), and immutable audit logs.',
        },
      ],
    },
    '/help-center': {
      title: 'Help Center',
      subtitle: 'Guides for onboarding, KYC verification, transfers, and security setup.',
      icon: <ShieldCheck className="w-5 h-5 text-blue-700 dark:text-blue-400" />,
      sections: [
        {
          heading: '01. Account Onboarding & Email Verification',
          body: 'Register with your legal name, residential address, and date of birth. Verify your email address and configure a 4–6 digit Transaction PIN and TOTP 2FA in Security Settings.',
        },
        {
          heading: '02. Completing Identity Verification (KYC)',
          body: 'Navigate to KYC Verification in your dashboard to upload a Government ID or Passport plus Proof of Address. Compliance Officers review submissions and record formal decisions.',
        },
        {
          heading: '03. Deposits, Transfers & Statements',
          body: 'Submit deposit requests under Deposits & Withdrawals. Once reconciled by a payment provider webhook or finance administrator, funds become available for internal transfers, FX, or approved withdrawals.',
        },
      ],
    },
    '/privacy-policy': {
      title: 'Privacy Policy',
      subtitle: 'How customer personal data, KYC records, and security telemetry are processed and protected.',
      icon: <Lock className="w-5 h-5 text-blue-700 dark:text-blue-400" />,
      sections: [
        {
          heading: 'Data Minimization & Encryption',
          body: 'We collect only personal, address, and identity verification data required for account administration and compliance screening. Sensitive KYC documents and MFA secrets are encrypted at rest.',
        },
        {
          heading: 'Retention & Access Logging',
          body: 'Every administrative inspection of customer identity documents or financial records is recorded in an immutable audit log with timestamp, actor ID, and reason.',
        },
      ],
    },
    '/terms': {
      title: 'Terms & Conditions',
      subtitle: 'Platform usage terms, partner rail disclosures, and ledger reconciliation rules.',
      icon: <ShieldCheck className="w-5 h-5 text-blue-700 dark:text-blue-400" />,
      sections: [
        {
          heading: 'Platform Scope & Partner Dependencies',
          body: config.brand.legalDisclosures.regulatoryNotice,
        },
        {
          heading: 'Settlement Finality & Verification',
          body: 'Deposit requests do not confer available funds until independently confirmed. External payouts and withdrawals remain subject to KYC approval, account limits, and configured banking partner settlement.',
        },
      ],
    },
    '/cookie-policy': {
      title: 'Cookie Policy',
      subtitle: 'Strict use of essential security and session cookies.',
      icon: <Lock className="w-5 h-5 text-blue-700 dark:text-blue-400" />,
      sections: [
        {
          heading: 'Essential Authentication Cookies',
          body: 'This platform uses HTTP-only, Secure, SameSite session cookies strictly to maintain authenticated customer and administrator sessions and prevent cross-site request forgery. No third-party advertising cookies are used.',
        },
      ],
    },
  };

  const info = pageContentMap[pageKey] || pageContentMap['/about'];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div className="flex items-center gap-3 text-xs font-medium text-blue-700 dark:text-blue-400">
        {info.icon}
        <span>{config.brand.shortName}</span>
      </div>
      <h1 className="mt-3 text-3xl sm:text-4xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
        {info.title}
      </h1>
      <p className="mt-3 text-base text-slate-600 dark:text-slate-300 leading-relaxed">{info.subtitle}</p>

      <div className="mt-10 space-y-6">
        {info.sections.map((sec) => (
          <div key={sec.heading} className="p-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <h2 className="text-lg font-display font-semibold text-slate-900 dark:text-white">{sec.heading}</h2>
            <p className="mt-2.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{sec.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => navigate('/register')}
          className="px-5 py-2.5 text-sm font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white cursor-pointer"
        >
          Open Account
        </button>
        <button
          type="button"
          onClick={() => navigate('/contact')}
          className="px-5 py-2.5 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer"
        >
          Contact Support
        </button>
      </div>
    </div>
  );
}
