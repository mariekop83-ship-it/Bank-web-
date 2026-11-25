import React, { useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Bell,
  Building2,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  Eye,
  EyeOff,
  FileCheck2,
  History,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Pencil,
  Printer,
  Send,
  Settings,
  ShieldCheck,
  UserCircle2,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  apiRequest,
  ApiError,
  formatDateUtc,
  formatMoney,
  generateIdempotencyKey,
  setCustomerToken,
} from '../utils/api';
import { useRouter } from '../utils/router';
import { AlertBanner, ConfirmDialog, EmptyState, StatusText, ThemeToggle } from '../components/ui';

type TabId =
  | 'overview'
  | 'wallets'
  | 'transfers'
  | 'funding'
  | 'transactions'
  | 'beneficiaries'
  | 'cards'
  | 'kyc'
  | 'profile'
  | 'security';

function formatIbanDisplay(iban?: string | null) {
  if (!iban) return '—';
  return String(iban).replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
}

export function CustomerDashboard({
  dark,
  onToggleTheme,
}: {
  dark: boolean;
  onToggleTheme: () => void;
}) {
  const { navigate } = useRouter();
  const [tab, setTab] = useState<TabId>('overview');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [hideBalances, setHideBalances] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Core data state
  const [dashboard, setDashboard] = useState<any>(null);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [deposits, setDeposits] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<any[]>([]);
  const [cardsData, setCardsData] = useState<{ issuerStatus?: any; cards: any[] }>({ cards: [] });
  const [kycData, setKycData] = useState<{ kycStatus: string; documents: any[] }>({
    kycStatus: 'NOT_STARTED',
    documents: [],
  });
  const [sessionsData, setSessionsData] = useState<{ currentSessionId?: number; sessions: any[] }>({
    sessions: [],
  });
  const [txList, setTxList] = useState<any[]>([]);
  const [txPagination, setTxPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [txFilters, setTxFilters] = useState({ search: '', type: '', status: '', currency: '', from: '', to: '' });

  // Modals
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [receiptTx, setReceiptTx] = useState<{ tx: any; entries: any[] } | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  // Transfer form state
  const [transferForm, setTransferForm] = useState({
    sourceCurrencyAccountId: 0,
    transferType: 'INTERNAL' as 'INTERNAL' | 'DOMESTIC' | 'INTERNATIONAL' | 'BENEFICIARY',
    recipientName: '',
    recipientAccountNumber: '',
    recipientBank: 'Meridian International Bank',
    recipientCountry: 'GB',
    recipientCurrency: 'USD',
    amount: '',
    description: '',
    transactionPin: '',
  });
  const [confirmTransferOpen, setConfirmTransferOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generatingAccount, setGeneratingAccount] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState('');
  const [accountLookup, setAccountLookup] = useState<{
    loading: boolean;
    found?: boolean;
    accountName?: string;
    bankName?: string;
    country?: string;
    supportedCurrencies?: string[];
    supportsRequestedCurrency?: boolean;
    isOwnAccount?: boolean;
    error?: string;
  } | null>(null);

  // FX Form
  const [fxForm, setFxForm] = useState({ sourceWalletId: 0, targetWalletId: 0, sourceAmount: '' });

  // Deposit / Withdrawal Forms
  const [depositForm, setDepositForm] = useState({
    currencyAccountId: 0,
    method: 'BANK_TRANSFER' as 'BANK_TRANSFER' | 'CARD_PAYMENT' | 'PAYMENT_GATEWAY' | 'PARTNER_ACCOUNT',
    amount: '',
  });
  const [withdrawalForm, setWithdrawalForm] = useState({
    currencyAccountId: 0,
    method: 'EXTERNAL_BANK' as 'INTERNAL_ACCOUNT' | 'EXTERNAL_BANK' | 'PAYOUT_PROVIDER',
    amount: '',
    accountName: '',
    accountNumber: '',
    bankName: '',
    country: 'GB',
    swiftBic: '',
  });

  // Beneficiary Form
  const [benefForm, setBenefForm] = useState({
    beneficiaryName: '',
    accountNumber: '',
    bankName: '',
    bankCountry: 'GB',
    currency: 'USD',
    bicSwift: '',
    beneficiaryType: 'INTERNAL' as 'INTERNAL' | 'DOMESTIC' | 'INTERNATIONAL',
  });

  // KYC Upload Form
  const [kycForm, setKycForm] = useState({
    documentType: 'PASSPORT' as 'GOVERNMENT_ID' | 'PASSPORT' | 'PROOF_OF_ADDRESS' | 'ADDITIONAL_DOCUMENT',
    documentNumber: '',
    issuingCountry: 'GB',
    expiryDate: '',
  });
  const [kycFile, setKycFile] = useState<File | null>(null);

  // Security / 2FA / PIN Forms
  const [pinForm, setPinForm] = useState({ pin: '', currentPassword: '' });
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '' });
  const [twoFaSetup, setTwoFaSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [twoFaCode, setTwoFaCode] = useState('');

  // Customer Profile ("Me") State
  const [profileData, setProfileData] = useState<any>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileForm, setProfileForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    occupation: '',
    preferredCurrency: 'USD',
    addressLine1: '',
    addressLine2: '',
    city: '',
    stateRegion: '',
    postalCode: '',
    country: 'GB',
  });

  const loadDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest('/api/user/dashboard');
      setDashboard(data);
      if (data.wallets?.length > 0) {
        const firstId = data.wallets[0].id;
        setTransferForm((f) => ({ ...f, sourceCurrencyAccountId: f.sourceCurrencyAccountId || firstId }));
        setDepositForm((f) => ({ ...f, currencyAccountId: f.currencyAccountId || firstId }));
        setWithdrawalForm((f) => ({ ...f, currencyAccountId: f.currencyAccountId || firstId }));
        setFxForm((f) => ({
          ...f,
          sourceWalletId: f.sourceWalletId || firstId,
          targetWalletId: f.targetWalletId || (data.wallets[1]?.id || firstId),
        }));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setCustomerToken(null);
        navigate('/login');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Unable to load dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadTabData = async (targetTab: TabId) => {
    try {
      if (targetTab === 'transfers') {
        const [tr, ben] = await Promise.all([apiRequest('/api/transfers'), apiRequest('/api/beneficiaries')]);
        setTransfers(tr.transfers || []);
        setBeneficiaries(ben.beneficiaries || []);
      } else if (targetTab === 'funding') {
        const [dep, wd] = await Promise.all([apiRequest('/api/deposits'), apiRequest('/api/withdrawals')]);
        setDeposits(dep.deposits || []);
        setWithdrawals(wd.withdrawals || []);
      } else if (targetTab === 'transactions') {
        await fetchTransactions(1);
      } else if (targetTab === 'beneficiaries') {
        const ben = await apiRequest('/api/beneficiaries');
        setBeneficiaries(ben.beneficiaries || []);
      } else if (targetTab === 'cards') {
        const c = await apiRequest('/api/cards');
        setCardsData(c);
      } else if (targetTab === 'kyc') {
        const k = await apiRequest('/api/kyc/status');
        setKycData(k);
      } else if (targetTab === 'profile') {
        const p = await apiRequest('/api/user/profile');
        if (p?.profile) {
          setProfileData(p.profile);
          setProfileForm({
            firstName: p.profile.first_name || '',
            lastName: p.profile.last_name || '',
            phone: p.profile.phone || '',
            occupation: p.profile.occupation || '',
            preferredCurrency: p.profile.preferred_currency || 'USD',
            addressLine1: p.profile.address_line_1 || '',
            addressLine2: p.profile.address_line_2 || '',
            city: p.profile.city || '',
            stateRegion: p.profile.state_region || '',
            postalCode: p.profile.postal_code || '',
            country: p.profile.country || 'GB',
          });
        }
      } else if (targetTab === 'security') {
        const s = await apiRequest('/api/auth/sessions');
        setSessionsData(s);
      }
    } catch (err) {
      setToast({
        type: 'error',
        message: err instanceof ApiError ? err.message : 'Failed to load section data.',
      });
    }
  };

  const switchTab = (next: TabId) => {
    setTab(next);
    setMobileMenu(false);
    if (next !== 'profile') {
      setProfileEditing(false);
    }
    loadTabData(next);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiRequest('/api/user/profile', {
        method: 'PUT',
        body: profileForm,
      });
      if (res?.profile) {
        setProfileData(res.profile);
      }
      setProfileEditing(false);
      setToast({ type: 'success', message: 'Personal profile details updated.' });
      await loadDashboard();
    } catch (err) {
      setToast({
        type: 'error',
        message: err instanceof ApiError ? err.message : 'Unable to save profile changes.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const fetchTransactions = async (page = 1) => {
    const params = new URLSearchParams({ page: String(page), limit: '15' });
    if (txFilters.search) params.set('search', txFilters.search);
    if (txFilters.type) params.set('type', txFilters.type);
    if (txFilters.status) params.set('status', txFilters.status);
    if (txFilters.currency) params.set('currency', txFilters.currency);
    if (txFilters.from) params.set('from', txFilters.from);
    if (txFilters.to) params.set('to', txFilters.to);
    const res = await apiRequest(`/api/transactions?${params.toString()}`);
    setTxList(res.transactions || []);
    setTxPagination(res.pagination || { page: 1, totalPages: 1, total: 0 });
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsg(`${label} copied`);
      setTimeout(() => setCopiedMsg(''), 2000);
    } catch {
      setToast({ type: 'info', message: `${label}: ${text}` });
    }
  };

  const resolveRecipientAccount = async (acctNum: string) => {
    const clean = acctNum.trim();
    if (clean.length < 6 || transferForm.transferType !== 'INTERNAL') {
      setAccountLookup(null);
      return;
    }
    const sourceWallet = wallets.find((w: any) => Number(w.id) === Number(transferForm.sourceCurrencyAccountId));
    const curr = sourceWallet?.currency || transferForm.recipientCurrency || 'USD';
    setAccountLookup({ loading: true });
    try {
      const res = await apiRequest(
        `/api/transfers/resolve-account?accountNumber=${encodeURIComponent(clean)}&currency=${encodeURIComponent(curr)}`
      );
      setAccountLookup({ loading: false, ...res });
      if (res.found) {
        setTransferForm((f) => ({
          ...f,
          recipientName: res.accountName || f.recipientName,
          recipientBank: res.bankName || 'Meridian International Bank',
          recipientCountry: res.country || f.recipientCountry,
          recipientCurrency: curr,
        }));
      }
    } catch (err) {
      setAccountLookup({
        loading: false,
        found: false,
        error: err instanceof ApiError ? err.message : 'Unable to verify account number.',
      });
    }
  };

  useEffect(() => {
    if (tab !== 'transfers' || transferForm.transferType !== 'INTERNAL') {
      setAccountLookup(null);
      return;
    }
    const clean = transferForm.recipientAccountNumber.trim();
    if (clean.length < 6) {
      setAccountLookup(null);
      return;
    }
    const timer = setTimeout(() => {
      resolveRecipientAccount(clean);
    }, 320);
    return () => clearTimeout(timer);
  }, [transferForm.recipientAccountNumber, transferForm.transferType, transferForm.sourceCurrencyAccountId, tab]);

  const handleGenerateAccountNumber = async () => {
    setGeneratingAccount(true);
    try {
      const res = await apiRequest('/api/user/bank-accounts', { method: 'POST', body: {} });
      setToast({
        type: 'success',
        message: `New account number ${res.bankAccount.account_number} generated with multi-currency wallets.`,
      });
      await loadDashboard();
    } catch (err) {
      setToast({
        type: 'error',
        message: err instanceof ApiError ? err.message : 'Unable to generate account number.',
      });
    } finally {
      setGeneratingAccount(false);
    }
  };

  const downloadReceiptFile = (tx: any, entries: any[]) => {
    const esc = (v: unknown) =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Transaction Receipt - ${esc(tx.reference)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; padding: 32px; }
  .card { max-width: 640px; margin: 0 auto; background: #fff; border: 1px solid #cbd5e1; border-radius: 12px; padding: 28px; }
  .head { border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-start; }
  .brand { font-size: 18px; font-weight: 700; color: #0f172a; }
  .sub { font-size: 12px; color: #64748b; margin-top: 2px; }
  .status { font-size: 12px; font-weight: 700; color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; padding: 4px 10px; border-radius: 6px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; font-size: 13px; }
  .label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 3px; }
  .val { font-weight: 600; color: #0f172a; word-break: break-word; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .amount-box { margin: 20px 0; padding: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; }
  .foot { margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 14px; font-size: 11px; color: #64748b; }
</style>
</head>
<body>
  <div class="card">
    <div class="head">
      <div>
        <div class="brand">Meridian International Bank</div>
        <div class="sub">Official Double-Entry Transaction Receipt</div>
      </div>
      <div class="status">${esc(tx.status)}</div>
    </div>
    <div class="amount-box">
      <div>
        <div class="label">Transfer Amount</div>
        <div class="val mono" style="font-size:22px;">${esc(formatMoney(tx.total_amount ?? tx.amount, tx.currency))}</div>
      </div>
      <div style="text-align:right;">
        <div class="label">Fee</div>
        <div class="val mono">${esc(formatMoney(tx.fee_amount || '0', tx.currency))}</div>
      </div>
    </div>
    <div class="grid">
      <div><div class="label">Reference</div><div class="val mono">${esc(tx.reference)}</div></div>
      <div><div class="label">Date (UTC)</div><div class="val mono">${esc(formatDateUtc(tx.posted_at || tx.created_at))}</div></div>
      ${tx.sender_name ? `<div><div class="label">Sender Name</div><div class="val">${esc(tx.sender_name)}</div></div>` : ''}
      ${tx.sender_account_number ? `<div><div class="label">Sender Account</div><div class="val mono">${esc(tx.sender_account_number)}</div></div>` : ''}
      ${tx.recipient_name ? `<div><div class="label">Recipient Name</div><div class="val">${esc(tx.recipient_name)}</div></div>` : ''}
      ${tx.recipient_account_number ? `<div><div class="label">Recipient Account</div><div class="val mono">${esc(tx.recipient_account_number)}</div></div>` : ''}
      ${tx.recipient_bank ? `<div><div class="label">Recipient Bank</div><div class="val">${esc(tx.recipient_bank)}</div></div>` : ''}
      <div><div class="label">Type</div><div class="val">${esc(String(tx.transaction_type || tx.transfer_type || '').replace(/_/g, ' '))}</div></div>
      <div style="grid-column: span 2;"><div class="label">Description</div><div class="val">${esc(tx.description)}</div></div>
    </div>
    ${
      entries.length > 0
        ? `<div style="margin-top:18px;border-top:1px solid #e2e8f0;padding-top:14px;"><div class="label" style="margin-bottom:8px;">Customer Ledger Postings</div>${entries
            .map(
              (e) =>
                `<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;" class="mono"><span>${esc(e.entry_type)} · ${esc(e.name)}</span><span>${esc(formatMoney(e.amount, e.currency))}</span></div>`
            )
            .join('')}</div>`
        : ''
    }
    <div class="foot">Generated automatically by Meridian International Bank Ledger Engine · Reference ${esc(tx.reference)}</div>
  </div>
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Meridian-Receipt-${tx.reference || 'TX'}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const openTransactionReceipt = async (id: number) => {
    try {
      const res = await apiRequest(`/api/transactions/${id}`);
      setReceiptTx({ tx: res.transaction, entries: res.entries || [] });
    } catch (err) {
      setToast({ type: 'error', message: err instanceof ApiError ? err.message : 'Unable to load receipt.' });
    }
  };

  const handleTransferSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await apiRequest('/api/transfers', {
        method: 'POST',
        body: {
          ...transferForm,
          idempotencyKey: generateIdempotencyKey('trf'),
          ...(transferForm.transactionPin ? { transactionPin: transferForm.transactionPin } : {}),
        },
      });
      setConfirmTransferOpen(false);
      setToast({
        type: 'success',
        message: `Transfer ${res.transfer.reference} (${res.transfer.status}) completed. Official receipt generated below.`,
      });
      setTransferForm((f) => ({ ...f, amount: '', description: '', transactionPin: '' }));
      setAccountLookup(null);
      await Promise.all([loadDashboard(), loadTabData('transfers')]);

      if (res.transfer?.ledger_transaction_id) {
        await openTransactionReceipt(Number(res.transfer.ledger_transaction_id));
      } else {
        setReceiptTx({
          tx: {
            ...res.transfer,
            transaction_type: `${res.transfer.transfer_type}_TRANSFER`,
            total_amount: res.transfer.amount,
            posted_at: res.transfer.created_at || new Date().toISOString(),
            sender_name: `${customer?.first_name || ''} ${customer?.last_name || ''}`.trim(),
            sender_account_number: primaryAccount?.account_number,
          },
          entries: [],
        });
      }
    } catch (err) {
      setConfirmTransferOpen(false);
      setToast({ type: 'error', message: err instanceof ApiError ? err.message : 'Transfer failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenWallet = async (currency: string) => {
    try {
      await apiRequest('/api/user/accounts', { method: 'POST', body: { currency } });
      setToast({ type: 'success', message: `${currency} wallet opened.` });
      await loadDashboard();
    } catch (err) {
      setToast({ type: 'error', message: err instanceof ApiError ? err.message : 'Unable to open wallet.' });
    }
  };

  const handleFxConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiRequest('/api/transfers/fx-convert', {
        method: 'POST',
        body: { ...fxForm, idempotencyKey: generateIdempotencyKey('fx') },
      });
      setToast({
        type: 'success',
        message: `Converted ${res.conversion.source_amount} ${res.conversion.source_currency} to ${res.conversion.target_amount} ${res.conversion.target_currency}.`,
      });
      setFxForm((f) => ({ ...f, sourceAmount: '' }));
      await loadDashboard();
    } catch (err) {
      setToast({ type: 'error', message: err instanceof ApiError ? err.message : 'FX conversion unavailable.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiRequest('/api/deposits', {
        method: 'POST',
        body: { ...depositForm, idempotencyKey: generateIdempotencyKey('dep') },
      });
      setToast({ type: 'info', message: `${res.deposit.reference}: ${res.instructions}` });
      setDepositForm((f) => ({ ...f, amount: '' }));
      await loadTabData('funding');
    } catch (err) {
      setToast({ type: 'error', message: err instanceof ApiError ? err.message : 'Deposit request failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiRequest('/api/withdrawals', {
        method: 'POST',
        body: {
          currencyAccountId: withdrawalForm.currencyAccountId,
          method: withdrawalForm.method,
          amount: withdrawalForm.amount,
          destinationDetails: {
            accountName: withdrawalForm.accountName,
            accountNumber: withdrawalForm.accountNumber,
            bankName: withdrawalForm.bankName,
            country: withdrawalForm.country,
            swiftBic: withdrawalForm.swiftBic,
          },
          idempotencyKey: generateIdempotencyKey('wdr'),
        },
      });
      setToast({
        type: 'success',
        message: `Withdrawal ${res.withdrawal.reference} placed in pending hold awaiting payout approval.`,
      });
      setWithdrawalForm((f) => ({ ...f, amount: '' }));
      await Promise.all([loadDashboard(), loadTabData('funding')]);
    } catch (err) {
      setToast({ type: 'error', message: err instanceof ApiError ? err.message : 'Withdrawal failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddBeneficiary = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/beneficiaries', { method: 'POST', body: benefForm });
      setToast({ type: 'success', message: 'Beneficiary saved.' });
      setBenefForm({
        beneficiaryName: '',
        accountNumber: '',
        bankName: '',
        bankCountry: 'GB',
        currency: 'USD',
        bicSwift: '',
        beneficiaryType: 'INTERNAL',
      });
      await loadTabData('beneficiaries');
    } catch (err) {
      setToast({ type: 'error', message: err instanceof ApiError ? err.message : 'Failed to save beneficiary.' });
    }
  };

  const handleKycUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kycFile) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('document', kycFile);
      fd.append('documentType', kycForm.documentType);
      if (kycForm.documentNumber) fd.append('documentNumber', kycForm.documentNumber);
      if (kycForm.issuingCountry) fd.append('issuingCountry', kycForm.issuingCountry);
      if (kycForm.expiryDate) fd.append('expiryDate', kycForm.expiryDate);

      await apiRequest('/api/kyc/documents', { method: 'POST', body: fd, isFormData: true });
      setToast({ type: 'success', message: 'Encrypted identity document uploaded and queued for compliance review.' });
      setKycFile(null);
      await Promise.all([loadDashboard(), loadTabData('kyc')]);
    } catch (err) {
      setToast({ type: 'error', message: err instanceof ApiError ? err.message : 'Upload failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore
    }
    setCustomerToken(null);
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-8">
        <div className="max-w-6xl mx-auto space-y-6 animate-pulse">
          <div className="h-10 w-64 bg-slate-200 dark:bg-slate-800 rounded-lg" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-28 bg-slate-200 dark:bg-slate-800 rounded-xl" />
            ))}
          </div>
          <div className="h-72 bg-slate-200 dark:bg-slate-800 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-lg w-full space-y-4">
          <AlertBanner type="error" title="Account Unavailable" message={error} />
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={loadDashboard} className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-700 text-white cursor-pointer">
              Retry
            </button>
            <button type="button" onClick={() => navigate('/')} className="px-4 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 cursor-pointer">
              Public Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const wallets = dashboard?.wallets || [];
  const primaryAccount = dashboard?.bankAccounts?.[0];
  const customer = dashboard?.customer;
  const unreadCount = (dashboard?.notifications || []).filter((n: any) => !n.is_read).length;

  const navItems: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'wallets', label: 'Currency Wallets', icon: <Wallet className="w-4 h-4" /> },
    { id: 'transfers', label: 'Send & FX', icon: <Send className="w-4 h-4" /> },
    { id: 'funding', label: 'Deposits & Withdrawals', icon: <ArrowLeftRight className="w-4 h-4" /> },
    { id: 'transactions', label: 'Transactions', icon: <History className="w-4 h-4" /> },
    { id: 'beneficiaries', label: 'Beneficiaries', icon: <Users className="w-4 h-4" /> },
    { id: 'cards', label: 'Bank Cards', icon: <CreditCard className="w-4 h-4" /> },
    { id: 'kyc', label: 'KYC Verification', icon: <FileCheck2 className="w-4 h-4" /> },
    { id: 'profile', label: 'Me (Profile)', icon: <UserCircle2 className="w-4 h-4" /> },
    { id: 'security', label: 'Security', icon: <Settings className="w-4 h-4" /> },
  ];

  const allCurrencyCodes = ['USD', 'EUR', 'GBP', 'NGN', 'CAD', 'AUD', 'CHF', 'JPY'];
  const ownedCodes = new Set(wallets.map((w: any) => w.currency));

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:flex lg:flex-col w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shrink-0">
        <div className="h-16 px-6 flex items-center border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-base font-display font-bold tracking-tight text-slate-900 dark:text-white cursor-pointer"
          >
            Meridian Bank
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => switchTab(item.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                tab === item.id
                  ? 'bg-blue-700 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900'
              }`}
            >
              {item.icon}
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <button
            type="button"
            onClick={() => switchTab('profile')}
            className="w-full px-2 py-1.5 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors cursor-pointer"
          >
            <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
              {customer?.first_name} {customer?.last_name}
            </p>
            <p className="text-xs text-slate-500 truncate">{customer?.email}</p>
            <p className="mt-0.5 text-[11px] font-medium text-blue-700 dark:text-blue-400">View Profile</p>
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Bottom Sheet Drawer */}
      {mobileMenu && (
        <div className="no-print fixed inset-0 z-50 lg:hidden flex flex-col justify-end">
          <div className="flex-1 bg-slate-950/50 backdrop-blur-[1px]" onClick={() => setMobileMenu(false)} />
          <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 rounded-t-2xl p-5 pb-24 shadow-2xl max-h-[82vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="min-w-0">
                <p className="font-display font-bold text-slate-900 dark:text-white">Customer Account</p>
                <p className="text-xs text-slate-500 truncate">{customer?.first_name} {customer?.last_name} · {customer?.email}</p>
              </div>
              <button type="button" onClick={() => setMobileMenu(false)} aria-label="Close menu" className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="grid grid-cols-2 gap-2">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => switchTab(item.id)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium rounded-xl border transition-colors cursor-pointer ${
                    tab === item.id
                      ? 'border-blue-700 bg-blue-700 text-white'
                      : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </button>
              ))}
            </nav>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="no-print h-16 px-4 sm:px-8 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="text-sm font-medium text-slate-600 dark:text-slate-400 truncate">
              Customer Account <span aria-hidden="true">/</span>{' '}
              <span className="text-slate-900 dark:text-white font-semibold">
                {navItems.find((i) => i.id === tab)?.label}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setHideBalances((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 whitespace-nowrap cursor-pointer"
            >
              {hideBalances ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{hideBalances ? 'Show Balances' : 'Hide Balances'}</span>
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setNotificationsOpen((v) => !v)}
                aria-label="Notifications"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 cursor-pointer"
              >
                <Bell className="w-3.5 h-3.5" />
                <span className="font-mono">{unreadCount}</span>
              </button>

              {notificationsOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl z-40 p-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                    <span className="text-xs font-semibold">Notifications</span>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await apiRequest('/api/notifications/read-all', { method: 'PUT' });
                          await loadDashboard();
                        } catch (err) {
                          setToast({
                            type: 'error',
                            message: err instanceof ApiError ? err.message : 'Unable to mark notifications read.',
                          });
                        }
                      }}
                      className="text-xs text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      Mark all read
                    </button>
                  </div>
                  <div className="mt-2 max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {(dashboard?.notifications || []).length === 0 ? (
                      <p className="py-6 text-center text-xs text-slate-500">No notifications yet.</p>
                    ) : (
                      dashboard.notifications.map((n: any) => (
                        <div key={n.id} className="py-2.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900 dark:text-white">{n.title}</span>
                            {!n.is_read && <span className="text-[11px] font-medium text-blue-700 dark:text-blue-400">New</span>}
                          </div>
                          <p className="mt-1 text-slate-600 dark:text-slate-400">{n.message}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <ThemeToggle dark={dark} onToggle={onToggleTheme} />
          </div>
        </header>

        <main className="flex-1 p-4 pb-24 sm:p-8 sm:pb-24 lg:pb-8 max-w-7xl w-full mx-auto space-y-6">

          {toast && (
            <AlertBanner
              type={toast.type}
              message={toast.message}
              onDismiss={() => setToast(null)}
            />
          )}

          {/* TAB 1: OVERVIEW */}
          {tab === 'overview' && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white">
                    Welcome, {customer?.first_name} {customer?.last_name}
                  </h1>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>
                      Account <span className="font-mono text-slate-800 dark:text-slate-200">{primaryAccount?.account_number}</span>
                    </span>
                    {primaryAccount?.account_number && (
                      <button
                        type="button"
                        onClick={() => copyToClipboard(primaryAccount.account_number, 'Account number')}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </button>
                    )}
                    <span aria-hidden="true">·</span>
                    <span>
                      KYC: <StatusText status={customer?.kyc_status} />
                    </span>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => switchTab('profile')}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      <UserCircle2 className="w-3.5 h-3.5" />
                      <span>View Profile</span>
                    </button>
                    {copiedMsg && <span className="text-emerald-600 dark:text-emerald-400 font-medium">{copiedMsg}</span>}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => switchTab('transfers')}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white cursor-pointer"
                  >
                    Send Money
                  </button>
                  <button
                    type="button"
                    onClick={() => setReceiveModalOpen(true)}
                    className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer"
                  >
                    Receive Money
                  </button>
                </div>
              </div>

              {/* Balance & Summary Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <p className="text-xs text-slate-500">Primary Wallet Available ({wallets[0]?.currency || 'USD'})</p>
                  <p className="mt-2 text-2xl font-mono font-semibold text-slate-900 dark:text-white">
                    {formatMoney(wallets[0]?.available_balance, wallets[0]?.currency || 'USD', hideBalances)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 font-mono">
                    Ledger: {formatMoney(wallets[0]?.ledger_balance, wallets[0]?.currency || 'USD', hideBalances)}
                  </p>
                </div>

                <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <p className="text-xs text-slate-500">Pending Hold ({wallets[0]?.currency || 'USD'})</p>
                  <p className="mt-2 text-2xl font-mono font-semibold text-slate-900 dark:text-white">
                    {formatMoney(wallets[0]?.pending_balance, wallets[0]?.currency || 'USD', hideBalances)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Pending Transactions: <span className="font-mono">{dashboard?.summary?.pendingCount ?? 0}</span>
                  </p>
                </div>

                <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <p className="text-xs text-slate-500">Total Verified Deposits</p>
                  <p className="mt-2 text-2xl font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                    {formatMoney(dashboard?.summary?.totalDeposits, 'USD', hideBalances)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Across settled inflows</p>
                </div>

                <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <p className="text-xs text-slate-500">Total Settled Withdrawals</p>
                  <p className="mt-2 text-2xl font-mono font-semibold text-slate-900 dark:text-white">
                    {formatMoney(dashboard?.summary?.totalWithdrawals, 'USD', hideBalances)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Approved payouts</p>
                </div>
              </div>

              {/* 8 Quick Actions */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                {[
                  { label: 'Send Money', icon: <ArrowUpRight className="w-4 h-4" />, onClick: () => switchTab('transfers') },
                  { label: 'Receive Money', icon: <ArrowDownLeft className="w-4 h-4" />, onClick: () => setReceiveModalOpen(true) },
                  { label: 'Deposit', icon: <Building2 className="w-4 h-4" />, onClick: () => switchTab('funding') },
                  { label: 'Withdraw', icon: <ArrowLeftRight className="w-4 h-4" />, onClick: () => switchTab('funding') },
                  { label: 'Exchange FX', icon: <Wallet className="w-4 h-4" />, onClick: () => switchTab('wallets') },
                  { label: 'Transactions', icon: <History className="w-4 h-4" />, onClick: () => switchTab('transactions') },
                  { label: 'Beneficiaries', icon: <Users className="w-4 h-4" />, onClick: () => switchTab('beneficiaries') },
                  { label: 'Statement', icon: <Download className="w-4 h-4" />, onClick: () => switchTab('transactions') },
                ].map((qa) => (
                  <button
                    key={qa.label}
                    type="button"
                    onClick={qa.onClick}
                    className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-600 text-left transition-colors cursor-pointer"
                  >
                    <div className="text-blue-700 dark:text-blue-400">{qa.icon}</div>
                    <p className="mt-2 text-xs font-medium text-slate-900 dark:text-white whitespace-nowrap truncate">
                      {qa.label}
                    </p>
                  </button>
                ))}
              </div>

              {/* Multi-Currency Wallets + Statistics Chart */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                  <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                    <h2 className="text-base font-semibold">Currency Wallets</h2>
                    <button
                      type="button"
                      onClick={() => switchTab('wallets')}
                      className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      Manage Wallets
                    </button>
                  </div>
                  <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
                    {wallets.map((w: any) => (
                      <div key={w.id} className="py-3 flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold">
                            <span className="font-mono">{w.currency}</span> · {w.currency_name}
                          </p>
                          <p className="text-xs text-slate-500">
                            {w.partner_available ? 'Partner clearing active' : 'Internal ledger wallet'}
                          </p>
                        </div>
                        <div className="text-right font-mono">
                          <p className="text-sm font-semibold">{formatMoney(w.available_balance, w.currency, hideBalances)}</p>
                          <p className="text-xs text-slate-500">
                            Pending: {formatMoney(w.pending_balance, w.currency, hideBalances)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                  <h2 className="text-base font-semibold pb-4 border-b border-slate-100 dark:border-slate-800">
                    Monthly Settled Volume
                  </h2>
                  {(dashboard?.monthlyVolume || []).length === 0 ? (
                    <div className="py-10 text-center text-xs text-slate-500">
                      Settled transaction volume statistics will appear after your first completed transaction.
                    </div>
                  ) : (
                    <div className="mt-6 space-y-3">
                      {dashboard.monthlyVolume.map((m: any) => {
                        const maxVol = Math.max(
                          1,
                          ...dashboard.monthlyVolume.map((x: any) => Number(x.volume || 0))
                        );
                        const pct = Math.min(100, Math.round((Number(m.volume || 0) / maxVol) * 100));
                        return (
                          <div key={m.month_label} className="space-y-1">
                            <div className="flex justify-between text-xs font-mono">
                              <span>{m.month_label}</span>
                              <span>{formatMoney(m.volume, 'USD', hideBalances)} ({m.tx_count} tx)</span>
                            </div>
                            <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                              <div className="h-full bg-blue-700" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Recent Transactions */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                  <h2 className="text-base font-semibold">Recent Ledger Activity</h2>
                  <button
                    type="button"
                    onClick={() => switchTab('transactions')}
                    className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    Full History
                  </button>
                </div>

                {(dashboard?.recentTransactions || []).length === 0 ? (
                  <div className="pt-4">
                    <EmptyState
                      title="No ledger transactions yet"
                      description="Submit a deposit request or receive an internal transfer to see double-entry activity."
                      actionLabel="Request Deposit"
                      onAction={() => switchTab('funding')}
                    />
                  </div>
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                          <th className="py-2.5 pr-4 font-medium">Reference</th>
                          <th className="py-2.5 pr-4 font-medium">Type</th>
                          <th className="py-2.5 pr-4 font-medium">Description</th>
                          <th className="py-2.5 pr-4 font-medium">Status</th>
                          <th className="py-2.5 pr-4 font-medium text-right">Amount</th>
                          <th className="py-2.5 font-medium text-right">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {dashboard.recentTransactions.map((tx: any) => (
                          <tr
                            key={tx.id}
                            onClick={() => openTransactionReceipt(tx.id)}
                            className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                          >
                            <td className="py-3 pr-4 font-mono font-medium">{tx.reference}</td>
                            <td className="py-3 pr-4">{tx.transaction_type.replace(/_/g, ' ')}</td>
                            <td className="py-3 pr-4 max-w-xs truncate">{tx.description}</td>
                            <td className="py-3 pr-4"><StatusText status={tx.status} /></td>
                            <td className="py-3 pr-4 text-right font-mono font-semibold">
                              {formatMoney(tx.total_amount, tx.currency, hideBalances)}
                            </td>
                            <td className="py-3 text-right font-mono text-slate-500">
                              {formatDateUtc(tx.posted_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: MULTI-CURRENCY WALLETS & FX */}
          {tab === 'wallets' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {wallets.map((w: any) => (
                  <div key={w.id} className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-bold">{w.currency}</span>
                      <StatusText status={w.status} />
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{w.currency_name}</p>
                    <p className="mt-4 text-xl font-mono font-semibold">
                      {formatMoney(w.available_balance, w.currency, hideBalances)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 font-mono">
                      Pending: {formatMoney(w.pending_balance, w.currency, hideBalances)}
                    </p>
                    <p className="mt-2 text-[11px] text-slate-400">
                      {w.partner_available ? 'Partner clearing enabled' : 'Internal ledger only'}
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                  <h2 className="text-base font-semibold">Open Additional Currency Wallet</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Provision segregated Available and Pending ledger accounts for supported currencies.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {allCurrencyCodes
                      .filter((c) => !ownedCodes.has(c))
                      .map((code) => (
                        <button
                          key={code}
                          type="button"
                          onClick={() => handleOpenWallet(code)}
                          className="px-3.5 py-2 text-xs font-mono font-semibold rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-600 cursor-pointer"
                        >
                          + Open {code}
                        </button>
                      ))}
                    {allCurrencyCodes.every((c) => ownedCodes.has(c)) && (
                      <p className="text-xs text-slate-500">All 8 supported currency wallets are active.</p>
                    )}
                  </div>
                </div>

                <form
                  onSubmit={handleFxConvert}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4"
                >
                  <div>
                    <h2 className="text-base font-semibold">Currency Conversion</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Executes via authorized FX rate feed (FX_PROVIDER) with double-entry clearing legs.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs mb-1">From Wallet</label>
                      <select
                        value={fxForm.sourceWalletId}
                        onChange={(e) => setFxForm({ ...fxForm, sourceWalletId: Number(e.target.value) })}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      >
                        {wallets.map((w: any) => (
                          <option key={w.id} value={w.id}>{w.currency}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs mb-1">To Wallet</label>
                      <select
                        value={fxForm.targetWalletId}
                        onChange={(e) => setFxForm({ ...fxForm, targetWalletId: Number(e.target.value) })}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      >
                        {wallets.map((w: any) => (
                          <option key={w.id} value={w.id}>{w.currency}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs mb-1">Amount</label>
                      <input
                        type="text"
                        required
                        placeholder="100.00"
                        value={fxForm.sourceAmount}
                        onChange={(e) => setFxForm({ ...fxForm, sourceAmount: e.target.value })}
                        className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white cursor-pointer"
                  >
                    {submitting ? 'Converting...' : 'Convert Currency'}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 3: TRANSFERS */}
          {tab === 'transfers' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
                <div>
                  <h2 className="text-base font-semibold">Send Money</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Choose bank, enter recipient account number to auto-verify account name, set amount, and get an instant receipt.
                  </p>
                </div>

                {beneficiaries.length > 0 && (
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Quick Fill from Saved Beneficiary</label>
                    <select
                      onChange={(e) => {
                        const b = beneficiaries.find((x) => String(x.id) === e.target.value);
                        if (b) {
                          setTransferForm((f) => ({
                            ...f,
                            transferType: b.beneficiary_type,
                            recipientName: b.beneficiary_name,
                            recipientAccountNumber: b.account_number,
                            recipientBank: b.bank_name,
                            recipientCountry: b.bank_country,
                            recipientCurrency: b.currency,
                          }));
                        }
                      }}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    >
                      <option value="">Select beneficiary...</option>
                      {beneficiaries.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.beneficiary_name} ({b.account_number} · {b.currency})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">1. From Wallet</label>
                    <select
                      value={transferForm.sourceCurrencyAccountId}
                      onChange={(e) => {
                        const nextId = Number(e.target.value);
                        const w = wallets.find((x: any) => Number(x.id) === nextId);
                        setTransferForm({
                          ...transferForm,
                          sourceCurrencyAccountId: nextId,
                          recipientCurrency: w?.currency || transferForm.recipientCurrency,
                        });
                      }}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    >
                      {wallets.map((w: any) => (
                        <option key={w.id} value={w.id}>
                          {w.currency} ({formatMoney(w.available_balance, w.currency, hideBalances)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">2. Choose Bank</label>
                    <select
                      value={transferForm.transferType}
                      onChange={(e) => {
                        const nextType = e.target.value as 'INTERNAL' | 'DOMESTIC' | 'INTERNATIONAL';
                        setAccountLookup(null);
                        setTransferForm({
                          ...transferForm,
                          transferType: nextType,
                          recipientBank: nextType === 'INTERNAL' ? 'Meridian International Bank' : '',
                          recipientName: nextType === 'INTERNAL' ? '' : transferForm.recipientName,
                        });
                      }}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    >
                      <option value="INTERNAL">Meridian International Bank (Instant)</option>
                      <option value="DOMESTIC">External Domestic Bank (Partner Rail)</option>
                      <option value="INTERNATIONAL">External International SWIFT (Partner Rail)</option>
                    </select>
                  </div>
                </div>

                {transferForm.transferType !== 'INTERNAL' && (
                  <div>
                    <label className="block text-xs font-medium mb-1">External Bank Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Barclays Bank UK"
                      value={transferForm.recipientBank}
                      onChange={(e) => setTransferForm({ ...transferForm, recipientBank: e.target.value })}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium mb-1">3. Recipient Account Number / IBAN</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Enter 10-digit account number or IBAN"
                      value={transferForm.recipientAccountNumber}
                      onChange={(e) =>
                        setTransferForm({
                          ...transferForm,
                          recipientAccountNumber: e.target.value,
                          ...(transferForm.transferType === 'INTERNAL' ? { recipientName: '' } : {}),
                        })
                      }
                      className="flex-1 px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    />
                    {transferForm.transferType === 'INTERNAL' && (
                      <button
                        type="button"
                        onClick={() => resolveRecipientAccount(transferForm.recipientAccountNumber)}
                        disabled={transferForm.recipientAccountNumber.trim().length < 6 || accountLookup?.loading}
                        className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                      >
                        {accountLookup?.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Verify'}
                      </button>
                    )}
                  </div>
                  {accountLookup && !accountLookup.loading && accountLookup.found && (
                    <div className="mt-2 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-300 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold">Account Verified: {accountLookup.accountName}</p>
                        <p className="text-[11px] opacity-90">
                          {accountLookup.bankName} · Supported: {(accountLookup.supportedCurrencies || []).join(', ')}
                          {accountLookup.isOwnAccount ? ' (Your own account)' : ''}
                        </p>
                      </div>
                    </div>
                  )}
                  {accountLookup && !accountLookup.loading && accountLookup.found === false && (
                    <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">{accountLookup.error}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1">4. Recipient Account Name</label>
                  <input
                    type="text"
                    placeholder={transferForm.transferType === 'INTERNAL' ? 'Auto-filled once account number is verified' : 'Full beneficiary name'}
                    value={transferForm.recipientName}
                    onChange={(e) => setTransferForm({ ...transferForm, recipientName: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs mb-1">Country (ISO)</label>
                    <input
                      type="text"
                      maxLength={2}
                      value={transferForm.recipientCountry}
                      onChange={(e) => setTransferForm({ ...transferForm, recipientCountry: e.target.value.toUpperCase() })}
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1">Currency</label>
                    <input
                      type="text"
                      maxLength={3}
                      value={transferForm.recipientCurrency}
                      onChange={(e) => setTransferForm({ ...transferForm, recipientCurrency: e.target.value.toUpperCase() })}
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">5. Amount</label>
                    <input
                      type="text"
                      placeholder="250.00"
                      value={transferForm.amount}
                      onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })}
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1">6. Description / Narration</label>
                  <input
                    type="text"
                    placeholder="Payment for dinner, invoice, etc."
                    value={transferForm.description}
                    onChange={(e) => setTransferForm({ ...transferForm, description: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>

                <div>
                  <label className="block text-xs mb-1">Transaction PIN (if configured)</label>
                  <input
                    type="password"
                    maxLength={6}
                    placeholder="4-6 digits"
                    value={transferForm.transactionPin}
                    onChange={(e) => setTransferForm({ ...transferForm, transactionPin: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setConfirmTransferOpen(true)}
                  disabled={
                    !transferForm.amount ||
                    !transferForm.recipientAccountNumber ||
                    !transferForm.recipientName ||
                    !transferForm.description.trim()
                  }
                  className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white cursor-pointer"
                >
                  Review & Send Transfer
                </button>
              </div>

              <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                <h2 className="text-base font-semibold pb-4 border-b border-slate-100 dark:border-slate-800">
                  Transfer History
                </h2>
                {transfers.length === 0 ? (
                  <div className="pt-4">
                    <EmptyState title="No transfers yet" description="Completed and pending transfers will appear here." />
                  </div>
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                          <th className="py-2 pr-3">Reference</th>
                          <th className="py-2 pr-3">Counterparty</th>
                          <th className="py-2 pr-3">Bank</th>
                          <th className="py-2 pr-3">Status</th>
                          <th className="py-2 pr-3 text-right">Amount</th>
                          <th className="py-2 text-right">Receipt</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {transfers.map((t) => {
                          const isIncoming = t.direction === 'INCOMING';
                          return (
                            <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                              <td className="py-2.5 pr-3 font-mono">{t.reference}</td>
                              <td className="py-2.5 pr-3">
                                <p className="font-medium">
                                  {isIncoming
                                    ? `From ${t.sender_name || 'Platform Sender'}`
                                    : `To ${t.recipient_name}`}
                                </p>
                                <p className="font-mono text-[11px] text-slate-500">
                                  {isIncoming
                                    ? t.sender_account_number || 'Meridian Account'
                                    : t.recipient_account_number}
                                </p>
                              </td>
                              <td className="py-2.5 pr-3">{t.recipient_bank}</td>
                              <td className="py-2.5 pr-3"><StatusText status={t.status} /></td>
                              <td
                                className={`py-2.5 pr-3 text-right font-mono font-semibold ${
                                  isIncoming ? 'text-emerald-700 dark:text-emerald-400' : ''
                                }`}
                              >
                                {isIncoming ? '+' : '-'}
                                {formatMoney(t.amount, t.currency, hideBalances)}
                              </td>
                              <td className="py-2.5 text-right">
                                {t.ledger_transaction_id && (
                                  <button
                                    type="button"
                                    onClick={() => openTransactionReceipt(Number(t.ledger_transaction_id))}
                                    className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:border-blue-600 text-blue-700 dark:text-blue-400 font-medium cursor-pointer"
                                  >
                                    Receipt
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: DEPOSITS & WITHDRAWALS */}
          {tab === 'funding' && (
            <div className="space-y-6">
              <AlertBanner
                type="info"
                title="Settlement Verification Policy"
                message="Deposit requests and receipt references are logged for reconciliation only. Customer balances are credited strictly upon verified payment provider webhook settlement or Finance Administrator confirmation."
              />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <form onSubmit={handleCreateDeposit} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
                  <h2 className="text-base font-semibold">Request Deposit</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs mb-1">Target Wallet</label>
                      <select
                        value={depositForm.currencyAccountId}
                        onChange={(e) => setDepositForm({ ...depositForm, currencyAccountId: Number(e.target.value) })}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      >
                        {wallets.map((w: any) => (
                          <option key={w.id} value={w.id}>{w.currency}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs mb-1">Deposit Method</label>
                      <select
                        value={depositForm.method}
                        onChange={(e) => setDepositForm({ ...depositForm, method: e.target.value as any })}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      >
                        <option value="BANK_TRANSFER">Bank Transfer</option>
                        <option value="CARD_PAYMENT">Card Payment</option>
                        <option value="PAYMENT_GATEWAY">Payment Gateway</option>
                        <option value="PARTNER_ACCOUNT">Partner Account</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs mb-1">Amount</label>
                    <input
                      type="text"
                      required
                      placeholder="500.00"
                      value={depositForm.amount}
                      onChange={(e) => setDepositForm({ ...depositForm, amount: e.target.value })}
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white cursor-pointer"
                  >
                    Submit Deposit Request
                  </button>
                </form>

                <form onSubmit={handleCreateWithdrawal} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
                  <h2 className="text-base font-semibold">Request Withdrawal</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs mb-1">Source Wallet</label>
                      <select
                        value={withdrawalForm.currencyAccountId}
                        onChange={(e) => setWithdrawalForm({ ...withdrawalForm, currencyAccountId: Number(e.target.value) })}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      >
                        {wallets.map((w: any) => (
                          <option key={w.id} value={w.id}>
                            {w.currency} ({formatMoney(w.available_balance, w.currency, hideBalances)})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs mb-1">Method</label>
                      <select
                        value={withdrawalForm.method}
                        onChange={(e) => setWithdrawalForm({ ...withdrawalForm, method: e.target.value as any })}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      >
                        <option value="EXTERNAL_BANK">External Bank</option>
                        <option value="PAYOUT_PROVIDER">Payout Provider</option>
                        <option value="INTERNAL_ACCOUNT">Internal Account</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs mb-1">Amount</label>
                      <input
                        type="text"
                        required
                        placeholder="150.00"
                        value={withdrawalForm.amount}
                        onChange={(e) => setWithdrawalForm({ ...withdrawalForm, amount: e.target.value })}
                        className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs mb-1">Account Holder Name</label>
                      <input
                        type="text"
                        required
                        value={withdrawalForm.accountName}
                        onChange={(e) => setWithdrawalForm({ ...withdrawalForm, accountName: e.target.value })}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs mb-1">Account / IBAN</label>
                      <input
                        type="text"
                        required
                        value={withdrawalForm.accountNumber}
                        onChange={(e) => setWithdrawalForm({ ...withdrawalForm, accountNumber: e.target.value })}
                        className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs mb-1">Bank Name</label>
                      <input
                        type="text"
                        required
                        value={withdrawalForm.bankName}
                        onChange={(e) => setWithdrawalForm({ ...withdrawalForm, bankName: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs mb-1">Country (ISO)</label>
                      <input
                        type="text"
                        required
                        maxLength={2}
                        value={withdrawalForm.country}
                        onChange={(e) => setWithdrawalForm({ ...withdrawalForm, country: e.target.value.toUpperCase() })}
                        className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 cursor-pointer"
                  >
                    Submit Withdrawal Request
                  </button>
                </form>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                  <h3 className="text-sm font-semibold mb-3">Deposit Requests</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                          <th className="py-2 pr-2">Ref</th>
                          <th className="py-2 pr-2">Method</th>
                          <th className="py-2 pr-2">Status</th>
                          <th className="py-2 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {deposits.map((d) => (
                          <tr key={d.id}>
                            <td className="py-2 pr-2 font-mono">{d.reference}</td>
                            <td className="py-2 pr-2">{d.method}</td>
                            <td className="py-2 pr-2"><StatusText status={d.status} /></td>
                            <td className="py-2 text-right font-mono">{formatMoney(d.amount, d.currency, hideBalances)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                  <h3 className="text-sm font-semibold mb-3">Withdrawal Requests</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                          <th className="py-2 pr-2">Ref</th>
                          <th className="py-2 pr-2">Method</th>
                          <th className="py-2 pr-2">Status</th>
                          <th className="py-2 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {withdrawals.map((w) => (
                          <tr key={w.id}>
                            <td className="py-2 pr-2 font-mono">{w.reference}</td>
                            <td className="py-2 pr-2">{w.method}</td>
                            <td className="py-2 pr-2"><StatusText status={w.status} /></td>
                            <td className="py-2 text-right font-mono">{formatMoney(w.amount, w.currency, hideBalances)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: TRANSACTIONS & STATEMENTS */}
          {tab === 'transactions' && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold">Transaction Ledger & Statements</h2>
                  <p className="text-xs text-slate-500">
                    Click any row for double-entry ledger legs and printable receipt.
                  </p>
                </div>
                <div className="no-print flex items-center gap-2">
                  <a
                    href="/api/transactions/export/csv"
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print / PDF Statement</span>
                  </button>
                </div>
              </div>

              <div className="no-print grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                <input
                  type="text"
                  placeholder="Search reference or memo..."
                  value={txFilters.search}
                  onChange={(e) => setTxFilters({ ...txFilters, search: e.target.value })}
                  className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
                <select
                  value={txFilters.type}
                  onChange={(e) => setTxFilters({ ...txFilters, type: e.target.value })}
                  className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                >
                  <option value="">All Types</option>
                  <option value="INTERNAL_TRANSFER">Internal Transfer</option>
                  <option value="DOMESTIC_TRANSFER">Domestic Transfer</option>
                  <option value="INTERNATIONAL_TRANSFER">International Transfer</option>
                  <option value="DEPOSIT">Deposit</option>
                  <option value="WITHDRAWAL">Withdrawal</option>
                  <option value="FX_CONVERSION">FX Conversion</option>
                  <option value="REVERSAL">Reversal</option>
                </select>
                <select
                  value={txFilters.status}
                  onChange={(e) => setTxFilters({ ...txFilters, status: e.target.value })}
                  className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                >
                  <option value="">All Statuses</option>
                  <option value="SUCCESSFUL">Successful</option>
                  <option value="PENDING">Pending</option>
                  <option value="PROCESSING">Processing</option>
                  <option value="REVERSED">Reversed</option>
                  <option value="FAILED">Failed</option>
                </select>
                <input
                  type="date"
                  value={txFilters.from}
                  onChange={(e) => setTxFilters({ ...txFilters, from: e.target.value })}
                  className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
                <input
                  type="date"
                  value={txFilters.to}
                  onChange={(e) => setTxFilters({ ...txFilters, to: e.target.value })}
                  className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
                <button
                  type="button"
                  onClick={() => fetchTransactions(1)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white cursor-pointer"
                >
                  Apply Filters
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-2.5 pr-3">Reference</th>
                      <th className="py-2.5 pr-3">Type</th>
                      <th className="py-2.5 pr-3">Description</th>
                      <th className="py-2.5 pr-3">Status</th>
                      <th className="py-2.5 pr-3 text-right">Fee</th>
                      <th className="py-2.5 pr-3 text-right">Amount</th>
                      <th className="py-2.5 text-right">Timestamp (UTC)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {txList.map((tx) => (
                      <tr
                        key={tx.id}
                        onClick={() => openTransactionReceipt(tx.id)}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                      >
                        <td className="py-3 pr-3 font-mono">{tx.reference}</td>
                        <td className="py-3 pr-3">{tx.transaction_type}</td>
                        <td className="py-3 pr-3 max-w-xs truncate">{tx.description}</td>
                        <td className="py-3 pr-3"><StatusText status={tx.status} /></td>
                        <td className="py-3 pr-3 text-right font-mono">{formatMoney(tx.fee_amount, tx.currency, hideBalances)}</td>
                        <td className="py-3 pr-3 text-right font-mono font-semibold">{formatMoney(tx.total_amount, tx.currency, hideBalances)}</td>
                        <td className="py-3 text-right font-mono text-slate-500">{formatDateUtc(tx.posted_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="no-print flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
                <span className="text-slate-500">
                  Page {txPagination.page} of {txPagination.totalPages} · {txPagination.total} records
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={txPagination.page <= 1}
                    onClick={() => fetchTransactions(txPagination.page - 1)}
                    className="px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={txPagination.page >= txPagination.totalPages}
                    onClick={() => fetchTransactions(txPagination.page + 1)}
                    className="px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: BENEFICIARIES */}
          {tab === 'beneficiaries' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <form onSubmit={handleAddBeneficiary} className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
                <h2 className="text-base font-semibold">Add Saved Beneficiary</h2>
                <div>
                  <label className="block text-xs mb-1">Beneficiary Name</label>
                  <input
                    type="text"
                    required
                    value={benefForm.beneficiaryName}
                    onChange={(e) => setBenefForm({ ...benefForm, beneficiaryName: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs mb-1">Account / IBAN</label>
                    <input
                      type="text"
                      required
                      value={benefForm.accountNumber}
                      onChange={(e) => setBenefForm({ ...benefForm, accountNumber: e.target.value })}
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1">Bank Name</label>
                    <input
                      type="text"
                      required
                      value={benefForm.bankName}
                      onChange={(e) => setBenefForm({ ...benefForm, bankName: e.target.value })}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs mb-1">Country (ISO)</label>
                    <input
                      type="text"
                      maxLength={2}
                      required
                      value={benefForm.bankCountry}
                      onChange={(e) => setBenefForm({ ...benefForm, bankCountry: e.target.value.toUpperCase() })}
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1">Currency</label>
                    <select
                      value={benefForm.currency}
                      onChange={(e) => setBenefForm({ ...benefForm, currency: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    >
                      {allCurrencyCodes.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs mb-1">Rail Type</label>
                    <select
                      value={benefForm.beneficiaryType}
                      onChange={(e) => setBenefForm({ ...benefForm, beneficiaryType: e.target.value as any })}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    >
                      <option value="INTERNAL">Internal</option>
                      <option value="DOMESTIC">Domestic</option>
                      <option value="INTERNATIONAL">International</option>
                    </select>
                  </div>
                </div>
                <button type="submit" className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white cursor-pointer">
                  Save Beneficiary
                </button>
              </form>

              <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                <h2 className="text-base font-semibold pb-3 border-b border-slate-100 dark:border-slate-800">
                  Saved Beneficiaries
                </h2>
                <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
                  {beneficiaries.length === 0 ? (
                    <EmptyState title="No saved beneficiaries" description="Save recurring recipients for faster transfers." />
                  ) : (
                    beneficiaries.map((b) => (
                      <div key={b.id} className="py-3 flex items-center justify-between gap-4 text-xs">
                        <div>
                          <p className="font-semibold text-sm">{b.beneficiary_name}</p>
                          <p className="font-mono text-slate-500">
                            {b.account_number} · {b.bank_name} ({b.bank_country}) · {b.currency}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setTransferForm((f) => ({
                                ...f,
                                transferType: b.beneficiary_type,
                                recipientName: b.beneficiary_name,
                                recipientAccountNumber: b.account_number,
                                recipientBank: b.bank_name,
                                recipientCountry: b.bank_country,
                                recipientCurrency: b.currency,
                              }));
                              switchTab('transfers');
                            }}
                            className="px-3 py-1.5 rounded bg-blue-700 text-white font-medium cursor-pointer"
                          >
                            Send
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await apiRequest(`/api/beneficiaries/${b.id}`, { method: 'DELETE' });
                                await loadTabData('beneficiaries');
                              } catch (err) {
                                setToast({
                                  type: 'error',
                                  message: err instanceof ApiError ? err.message : 'Failed to remove beneficiary.',
                                });
                              }
                            }}
                            className="px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 text-rose-600 cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: TOKENIZED BANK CARDS */}
          {tab === 'cards' && (
            <div className="space-y-6">
              {cardsData.issuerStatus && !cardsData.issuerStatus.available && (
                <AlertBanner
                  type="info"
                  title="Card Issuer Status"
                  message={cardsData.issuerStatus.message}
                />
              )}

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold">Request Virtual or Physical Card</h2>
                  <p className="text-xs text-slate-500">
                    Tokenized card lifecycle — raw card numbers, CVVs, and PINs are never stored in the application database.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!wallets[0]) return;
                      try {
                        const res = await apiRequest('/api/cards/request', {
                          method: 'POST',
                          body: { currencyAccountId: wallets[0].id, cardType: 'VIRTUAL' },
                        });
                        setToast({ type: 'info', message: res.message });
                        await loadTabData('cards');
                      } catch (err) {
                        setToast({
                          type: 'error',
                          message: err instanceof ApiError ? err.message : 'Unable to request virtual card.',
                        });
                      }
                    }}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white cursor-pointer"
                  >
                    + Request Virtual Card
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!wallets[0]) return;
                      try {
                        const res = await apiRequest('/api/cards/request', {
                          method: 'POST',
                          body: { currencyAccountId: wallets[0].id, cardType: 'PHYSICAL' },
                        });
                        setToast({ type: 'info', message: res.message });
                        await loadTabData('cards');
                      } catch (err) {
                        setToast({
                          type: 'error',
                          message: err instanceof ApiError ? err.message : 'Unable to request physical card.',
                        });
                      }
                    }}
                    className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                  >
                    + Request Physical Card
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {cardsData.cards.map((card) => (
                  <div key={card.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
                    <div className="rounded-xl bg-slate-900 text-white p-6 flex flex-col justify-between min-h-[170px]">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono">{card.card_type} · {card.currency}</span>
                        <span className="font-semibold">{card.card_brand}</span>
                      </div>
                      <p className="font-mono text-lg tracking-widest mt-6">•••• •••• •••• {card.last4}</p>
                      <div className="flex items-center justify-between text-xs mt-4 text-slate-300">
                        <span>{card.cardholder_name}</span>
                        <span className="font-mono">{String(card.expiry_month).padStart(2, '0')}/{card.expiry_year}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span>Status: <StatusText status={card.status} /></span>
                      <span className="font-mono text-slate-500">
                        Daily Limit: {formatMoney(card.daily_limit, card.currency)}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {card.status === 'ACTIVE' && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await apiRequest(`/api/cards/${card.id}/freeze`, { method: 'POST' });
                              await loadTabData('cards');
                            } catch (err) {
                              setToast({
                                type: 'error',
                                message: err instanceof ApiError ? err.message : 'Unable to freeze card.',
                              });
                            }
                          }}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                        >
                          Freeze Card
                        </button>
                      )}
                      {card.status === 'FROZEN' && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await apiRequest(`/api/cards/${card.id}/unfreeze`, { method: 'POST' });
                              await loadTabData('cards');
                            } catch (err) {
                              setToast({
                                type: 'error',
                                message: err instanceof ApiError ? err.message : 'Unable to unfreeze card.',
                              });
                            }
                          }}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-700 text-white cursor-pointer"
                        >
                          Unfreeze Card
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await apiRequest(`/api/cards/${card.id}/replace`, { method: 'POST' });
                            await loadTabData('cards');
                          } catch (err) {
                            setToast({
                              type: 'error',
                              message: err instanceof ApiError ? err.message : 'Unable to request card replacement.',
                            });
                          }
                        }}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                      >
                        Request Replacement
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 8: KYC & IDENTITY VERIFICATION */}
          {tab === 'kyc' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <form onSubmit={handleKycUpload} className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold">Identity Verification (KYC)</h2>
                  <StatusText status={kycData.kycStatus} />
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Uploaded documents are encrypted with AES-256-GCM and stored in private custody. Approval occurs strictly after authorized Compliance Officer review.
                </p>

                <div>
                  <label className="block text-xs mb-1">Document Type</label>
                  <select
                    value={kycForm.documentType}
                    onChange={(e) => setKycForm({ ...kycForm, documentType: e.target.value as any })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  >
                    <option value="PASSPORT">Passport</option>
                    <option value="GOVERNMENT_ID">Government-Issued ID</option>
                    <option value="PROOF_OF_ADDRESS">Proof of Residential Address</option>
                    <option value="ADDITIONAL_DOCUMENT">Additional Supporting Document</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs mb-1">Document Number</label>
                    <input
                      type="text"
                      value={kycForm.documentNumber}
                      onChange={(e) => setKycForm({ ...kycForm, documentNumber: e.target.value })}
                      className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1">Issuing Country (ISO)</label>
                    <input
                      type="text"
                      maxLength={2}
                      value={kycForm.issuingCountry}
                      onChange={(e) => setKycForm({ ...kycForm, issuingCountry: e.target.value.toUpperCase() })}
                      className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs mb-1">Document File (JPEG, PNG, PDF up to 5MB)</label>
                  <input
                    type="file"
                    required
                    accept="image/jpeg,image/png,application/pdf"
                    onChange={(e) => setKycFile(e.target.files?.[0] || null)}
                    className="w-full text-xs"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting || !kycFile}
                  className="px-4 py-2.5 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white cursor-pointer"
                >
                  {submitting ? 'Encrypting & Uploading...' : 'Upload Encrypted Document'}
                </button>
              </form>

              <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                <h2 className="text-base font-semibold pb-3 border-b border-slate-100 dark:border-slate-800">
                  Submitted Documents
                </h2>
                <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
                  {kycData.documents.length === 0 ? (
                    <EmptyState title="No documents uploaded" description="Upload your passport or ID and proof of address to begin verification." />
                  ) : (
                    kycData.documents.map((doc) => (
                      <div key={doc.uuid} className="py-3 flex items-center justify-between gap-4 text-xs">
                        <div>
                          <p className="font-semibold">{doc.document_type.replace(/_/g, ' ')}</p>
                          <p className="text-slate-500">
                            {doc.original_filename} · {Math.round(doc.file_size_bytes / 1024)} KB · {formatDateUtc(doc.created_at)}
                          </p>
                          {doc.reviewer_notes && (
                            <p className="mt-1 text-slate-600 dark:text-slate-300">Note: {doc.reviewer_notes}</p>
                          )}
                        </div>
                        <StatusText status={doc.review_status} />
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 8B: ME (CUSTOMER PROFILE & ACCOUNT DETAILS) */}
          {tab === 'profile' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-blue-700 text-white flex items-center justify-center font-display font-bold text-lg shrink-0">
                    {`${(profileData?.first_name || customer?.first_name || 'M')[0]}${(profileData?.last_name || customer?.last_name || 'B')[0]}`.toUpperCase()}
                  </div>
                  <div>
                    <h2 className="text-lg font-display font-bold text-slate-900 dark:text-white">
                      {profileData?.first_name || customer?.first_name} {profileData?.last_name || customer?.last_name}
                    </h2>
                    <p className="text-xs text-slate-500">{profileData?.email || customer?.email}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-medium text-slate-700 dark:text-slate-300">
                        {(profileData?.account_tier || customer?.account_tier || 'PERSONAL')} ACCOUNT
                      </span>
                      <StatusText status={profileData?.kyc_status || customer?.kyc_status} />
                      {profileData?.email_verified_at && (
                        <span className="text-emerald-700 dark:text-emerald-400 font-medium">Email Verified</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!profileEditing ? (
                    <button
                      type="button"
                      onClick={() => setProfileEditing(true)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setProfileEditing(false)}
                      className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => switchTab('security')}
                    className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                  >
                    Security Settings
                  </button>
                </div>
              </div>

              {profileEditing ? (
                <form
                  onSubmit={handleSaveProfile}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5"
                >
                  <div>
                    <h3 className="text-base font-semibold">Edit Personal Details</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Update your contact details, occupation, preferred currency, and residential address.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium mb-1">First Name</label>
                      <input
                        type="text"
                        required
                        disabled={profileData?.kyc_status === 'APPROVED'}
                        value={profileForm.firstName}
                        onChange={(e) => setProfileForm({ ...profileForm, firstName: e.target.value })}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Last Name</label>
                      <input
                        type="text"
                        required
                        disabled={profileData?.kyc_status === 'APPROVED'}
                        value={profileForm.lastName}
                        onChange={(e) => setProfileForm({ ...profileForm, lastName: e.target.value })}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Phone Number</label>
                      <input
                        type="tel"
                        required
                        value={profileForm.phone}
                        onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Occupation</label>
                      <input
                        type="text"
                        placeholder="e.g. Software Engineer, Consultant"
                        value={profileForm.occupation}
                        onChange={(e) => setProfileForm({ ...profileForm, occupation: e.target.value })}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Preferred Currency</label>
                      <select
                        value={profileForm.preferredCurrency}
                        onChange={(e) => setProfileForm({ ...profileForm, preferredCurrency: e.target.value })}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      >
                        {allCurrencyCodes.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Country (ISO-2)</label>
                      <input
                        type="text"
                        maxLength={2}
                        required
                        value={profileForm.country}
                        onChange={(e) => setProfileForm({ ...profileForm, country: e.target.value.toUpperCase() })}
                        className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium mb-1">Address Line 1</label>
                      <input
                        type="text"
                        required
                        value={profileForm.addressLine1}
                        onChange={(e) => setProfileForm({ ...profileForm, addressLine1: e.target.value })}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium mb-1">Address Line 2 (Optional)</label>
                      <input
                        type="text"
                        value={profileForm.addressLine2}
                        onChange={(e) => setProfileForm({ ...profileForm, addressLine2: e.target.value })}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">City</label>
                      <input
                        type="text"
                        required
                        value={profileForm.city}
                        onChange={(e) => setProfileForm({ ...profileForm, city: e.target.value })}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium mb-1">State / Region</label>
                        <input
                          type="text"
                          value={profileForm.stateRegion}
                          onChange={(e) => setProfileForm({ ...profileForm, stateRegion: e.target.value })}
                          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Postal Code</label>
                        <input
                          type="text"
                          value={profileForm.postalCode}
                          onChange={(e) => setProfileForm({ ...profileForm, postalCode: e.target.value })}
                          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                        />
                      </div>
                    </div>
                  </div>

                  {profileData?.kyc_status === 'APPROVED' && (
                    <p className="text-[11px] text-slate-500">
                      Legal name fields are locked after KYC approval. Contact compliance support to update verified identity names.
                    </p>
                  )}

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setProfileEditing(false)}
                      className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="px-5 py-2 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white cursor-pointer"
                    >
                      {submitting ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                      <h3 className="text-base font-semibold">Personal Information</h3>
                      <button
                        type="button"
                        onClick={() => setProfileEditing(true)}
                        className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        Edit
                      </button>
                    </div>
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                      <div>
                        <dt className="text-slate-500">Full Legal Name</dt>
                        <dd className="mt-0.5 font-semibold text-slate-900 dark:text-white">
                          {profileData?.first_name || customer?.first_name} {profileData?.last_name || customer?.last_name}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Email Address</dt>
                        <dd className="mt-0.5 font-medium break-all">{profileData?.email || customer?.email}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Phone Number</dt>
                        <dd className="mt-0.5 font-mono">{profileData?.phone || '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Date of Birth</dt>
                        <dd className="mt-0.5 font-mono">
                          {profileData?.date_of_birth ? String(profileData.date_of_birth).slice(0, 10) : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Nationality</dt>
                        <dd className="mt-0.5 font-mono">{profileData?.nationality || '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Occupation</dt>
                        <dd className="mt-0.5">{profileData?.occupation || 'Not specified'}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Preferred Currency</dt>
                        <dd className="mt-0.5 font-mono font-semibold">
                          {profileData?.preferred_currency || customer?.preferred_currency || 'USD'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Account Tier</dt>
                        <dd className="mt-0.5 font-medium">{profileData?.account_tier || customer?.account_tier || 'PERSONAL'}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                      <h3 className="text-base font-semibold">Residential Address</h3>
                      <button
                        type="button"
                        onClick={() => setProfileEditing(true)}
                        className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        Edit
                      </button>
                    </div>
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                      <div className="sm:col-span-2">
                        <dt className="text-slate-500">Street Address</dt>
                        <dd className="mt-0.5 font-medium">
                          {profileData?.address_line_1 || '—'}
                          {profileData?.address_line_2 ? `, ${profileData.address_line_2}` : ''}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">City</dt>
                        <dd className="mt-0.5 font-medium">{profileData?.city || '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">State / Region</dt>
                        <dd className="mt-0.5">{profileData?.state_region || '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Postal Code</dt>
                        <dd className="mt-0.5 font-mono">{profileData?.postal_code || '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Country</dt>
                        <dd className="mt-0.5 font-mono">{profileData?.country || '—'}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h3 className="text-base font-semibold">Banking Account Details</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Each account has its own unique 10-digit account number and ISO-13616 IBAN for receiving funds.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerateAccountNumber}
                    disabled={generatingAccount}
                    className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white cursor-pointer"
                  >
                    {generatingAccount ? 'Generating...' : '+ New Account Number'}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(dashboard?.bankAccounts || []).map((ba: any, idx: number) => (
                    <div
                      key={ba.id}
                      className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-3 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {idx === 0 ? 'Primary Checking Account' : `Receiving Account #${idx + 1}`}
                        </span>
                        <StatusText status={ba.status} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-[11px] text-slate-500">Account Holder</p>
                          <p className="font-medium text-slate-900 dark:text-white">
                            {profileData?.first_name || customer?.first_name} {profileData?.last_name || customer?.last_name}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] text-slate-500">Account Number</p>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-semibold text-slate-900 dark:text-white">{ba.account_number}</span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(ba.account_number, 'Account number')}
                              className="text-blue-700 dark:text-blue-400 cursor-pointer"
                              aria-label="Copy account number"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        <div>
                          <p className="text-[11px] text-slate-500">Sort / Routing Code</p>
                          <p className="font-mono">{ba.routing_number || '04-06-18'}</p>
                        </div>
                        <div>
                          <p className="text-[11px] text-slate-500">BIC / SWIFT</p>
                          <p className="font-mono">{ba.bic_swift || 'MRDNGB2L'}</p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-[11px] text-slate-500">IBAN</p>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono font-medium text-slate-900 dark:text-white break-all">
                              {formatIbanDisplay(ba.iban)}
                            </span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(ba.iban, 'IBAN')}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 dark:text-blue-400 shrink-0 cursor-pointer"
                            >
                              <Copy className="w-3 h-3" />
                              <span>Copy</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 9: SECURITY, 2FA, PIN & SESSIONS */}
          {tab === 'security' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                  <h2 className="text-base font-semibold">Two-Factor Authentication (TOTP)</h2>
                </div>
                <p className="text-xs text-slate-500">
                  Status: <StatusText status={customer?.two_factor_enabled ? 'ACTIVE' : 'NOT_STARTED'} />
                </p>

                {!customer?.two_factor_enabled && !twoFaSetup && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await apiRequest('/api/auth/2fa/setup', { method: 'POST' });
                        setTwoFaSetup(res);
                      } catch (err) {
                        setToast({
                          type: 'error',
                          message: err instanceof ApiError ? err.message : 'Unable to start 2FA setup.',
                        });
                      }
                    }}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white cursor-pointer"
                  >
                    Configure Authenticator App
                  </button>
                )}

                {twoFaSetup && (
                  <div className="space-y-3 p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <img src={twoFaSetup.qrDataUrl} alt="2FA QR Code" className="w-40 h-40 rounded border border-slate-200" />
                    <p className="text-xs font-mono break-all">Secret: {twoFaSetup.secret}</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        maxLength={6}
                        placeholder="6-digit code"
                        value={twoFaCode}
                        onChange={(e) => setTwoFaCode(e.target.value)}
                        className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await apiRequest('/api/auth/2fa/enable', { method: 'POST', body: { code: twoFaCode } });
                            setTwoFaSetup(null);
                            setToast({ type: 'success', message: 'Two-factor authentication enabled.' });
                            await loadDashboard();
                          } catch (err) {
                            setToast({
                              type: 'error',
                              message: err instanceof ApiError ? err.message : 'Invalid 2FA verification code.',
                            });
                          }
                        }}
                        className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white cursor-pointer"
                      >
                        Verify & Enable
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await apiRequest('/api/auth/pin', { method: 'POST', body: pinForm });
                    setToast({ type: 'success', message: 'Transaction PIN saved.' });
                    setPinForm({ pin: '', currentPassword: '' });
                  } catch (err) {
                    setToast({ type: 'error', message: err instanceof ApiError ? err.message : 'Failed to set PIN.' });
                  }
                }}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4"
              >
                <h2 className="text-base font-semibold">Transaction Authorization PIN</h2>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="password"
                    required
                    maxLength={6}
                    placeholder="New 4-6 digit PIN"
                    value={pinForm.pin}
                    onChange={(e) => setPinForm({ ...pinForm, pin: e.target.value })}
                    className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                  <input
                    type="password"
                    required
                    placeholder="Current Account Password"
                    value={pinForm.currentPassword}
                    onChange={(e) => setPinForm({ ...pinForm, currentPassword: e.target.value })}
                    className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <button type="submit" className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 cursor-pointer">
                  Save Transaction PIN
                </button>
              </form>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await apiRequest('/api/auth/change-password', { method: 'POST', body: pwForm });
                    setToast({ type: 'success', message: 'Password updated.' });
                    setPwForm({ currentPassword: '', newPassword: '' });
                  } catch (err) {
                    setToast({ type: 'error', message: err instanceof ApiError ? err.message : 'Failed to update password.' });
                  }
                }}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4"
              >
                <h2 className="text-base font-semibold">Change Account Password</h2>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="password"
                    required
                    placeholder="Current Password"
                    value={pwForm.currentPassword}
                    onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
                    className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                  <input
                    type="password"
                    required
                    minLength={10}
                    placeholder="New Password (min 10 chars)"
                    value={pwForm.newPassword}
                    onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
                    className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <button type="submit" className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white cursor-pointer">
                  Update Password
                </button>
              </form>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-3">
                <h2 className="text-base font-semibold">Active Devices & Sessions</h2>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sessionsData.sessions.map((s) => (
                    <div key={s.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div>
                        <p className="font-medium truncate max-w-xs">{s.device_name || 'Web Session'}</p>
                        <p className="font-mono text-slate-500">
                          IP: {s.ip_address || 'unknown'} · Last active {formatDateUtc(s.last_activity_at)}
                        </p>
                      </div>
                      {s.id === sessionsData.currentSessionId ? (
                        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Current</span>
                      ) : (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await apiRequest(`/api/auth/sessions/${s.id}`, { method: 'DELETE' });
                              await loadTabData('security');
                            } catch (err) {
                              setToast({
                                type: 'error',
                                message: err instanceof ApiError ? err.message : 'Unable to revoke session.',
                              });
                            }
                          }}
                          className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-rose-600 cursor-pointer"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Confirmation Dialog for Transfers */}
      <ConfirmDialog
        open={confirmTransferOpen}
        title="Confirm Transfer"
        description={`Send ${transferForm.amount} ${transferForm.recipientCurrency} to ${transferForm.recipientName} (${transferForm.recipientAccountNumber}) via ${transferForm.transferType} rail?`}
        confirmLabel="Authorize & Send"
        loading={submitting}
        onConfirm={handleTransferSubmit}
        onCancel={() => setConfirmTransferOpen(false)}
      />

      {/* Receive Money & Account Number Generator Modal */}
      {receiveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Receive Funds & Account Numbers</h3>
                <p className="text-xs text-slate-500">
                  Share any of these details with another person on Meridian International Bank for instant transfers.
                </p>
              </div>
              <button type="button" onClick={() => setReceiveModalOpen(false)} className="p-1 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              {(dashboard?.bankAccounts || []).map((ba: any, idx: number) => (
                <div
                  key={ba.id}
                  className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {idx === 0 ? 'Primary Receiving Account' : `Receiving Account #${idx + 1}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(ba.account_number, 'Account number')}
                      className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400 font-medium hover:underline cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copy Number</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700 dark:text-slate-300">
                    <p><span className="text-slate-500">Bank:</span> Meridian International Bank</p>
                    <p><span className="text-slate-500">Beneficiary:</span> {customer?.first_name} {customer?.last_name}</p>
                    <p className="font-mono"><span className="font-sans text-slate-500">Account:</span> {ba.account_number}</p>
                    <p className="font-mono"><span className="font-sans text-slate-500">Sort / Routing:</span> {ba.routing_number || '04-06-18'}</p>
                    <p className="font-mono"><span className="font-sans text-slate-500">BIC / SWIFT:</span> {ba.bic_swift || 'MRDNGB2L'}</p>
                    <p className="sm:col-span-2 font-mono break-all">
                      <span className="font-sans text-slate-500">IBAN:</span> {formatIbanDisplay(ba.iban)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={handleGenerateAccountNumber}
                disabled={generatingAccount}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white cursor-pointer"
              >
                {generatingAccount ? 'Generating...' : 'Generate New Account Number'}
              </button>
              {copiedMsg && <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">{copiedMsg}</span>}
            </div>
          </div>
        </div>
      )}

      {/* Printable & Downloadable Official Transaction Receipt Modal */}
      {receiptTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                  Meridian International Bank
                </p>
                <h3 className="text-base font-semibold">Official Transaction Receipt</h3>
                <p className="text-xs font-mono text-slate-500">{receiptTx.tx.reference}</p>
              </div>
              <button type="button" onClick={() => setReceiptTx(null)} className="no-print p-1 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-[11px] text-slate-500 uppercase">Amount</p>
                <p className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                  {formatMoney(receiptTx.tx.total_amount ?? receiptTx.tx.amount, receiptTx.tx.currency)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-slate-500 uppercase">Status</p>
                <StatusText status={receiptTx.tx.status} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-slate-500">Type</p>
                <p className="font-medium">{String(receiptTx.tx.transaction_type || '').replace(/_/g, ' ')}</p>
              </div>
              <div>
                <p className="text-slate-500">Fee</p>
                <p className="font-mono">{formatMoney(receiptTx.tx.fee_amount || '0', receiptTx.tx.currency)}</p>
              </div>
              <div>
                <p className="text-slate-500">Timestamp (UTC)</p>
                <p className="font-mono">{formatDateUtc(receiptTx.tx.posted_at || receiptTx.tx.created_at)}</p>
              </div>
              {receiptTx.tx.sender_name && (
                <div>
                  <p className="text-slate-500">Sender</p>
                  <p className="font-medium">{receiptTx.tx.sender_name}</p>
                  {receiptTx.tx.sender_account_number && (
                    <p className="font-mono text-[11px] text-slate-500">{receiptTx.tx.sender_account_number}</p>
                  )}
                </div>
              )}
              {receiptTx.tx.recipient_name && (
                <div>
                  <p className="text-slate-500">Recipient Name</p>
                  <p className="font-medium">{receiptTx.tx.recipient_name}</p>
                </div>
              )}
              {receiptTx.tx.recipient_account_number && (
                <div>
                  <p className="text-slate-500">Recipient Account</p>
                  <p className="font-mono">{receiptTx.tx.recipient_account_number}</p>
                </div>
              )}
              {receiptTx.tx.recipient_bank && (
                <div className="col-span-2">
                  <p className="text-slate-500">Recipient Bank</p>
                  <p className="font-medium">{receiptTx.tx.recipient_bank}</p>
                </div>
              )}
              <div className="col-span-2">
                <p className="text-slate-500">Description</p>
                <p>{receiptTx.tx.description}</p>
              </div>
            </div>

            {receiptTx.entries.length > 0 && (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                <p className="text-xs font-semibold mb-2">Customer Ledger Entries</p>
                <div className="space-y-1.5 text-xs font-mono">
                  {receiptTx.entries.map((e) => (
                    <div key={e.id} className="flex justify-between gap-2">
                      <span className="truncate">{e.entry_type} · {e.name}</span>
                      <span className="shrink-0">{formatMoney(e.amount, e.currency)} (Bal: {formatMoney(e.balance_after, e.currency)})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="no-print flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => copyToClipboard(receiptTx.tx.reference, 'Reference')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Ref</span>
              </button>
              <button
                type="button"
                onClick={() => downloadReceiptFile(receiptTx.tx, receiptTx.entries)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Receipt</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Receipt</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Card Navigation Dock */}
      <nav
        aria-label="Customer account mobile navigation"
        className="no-print lg:hidden fixed inset-x-3 bottom-3 z-50 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-xl shadow-slate-900/10 px-2 py-1.5"
      >
        <div className="grid grid-cols-5 gap-1">
          {[
            { id: 'overview' as TabId, label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
            { id: 'wallets' as TabId, label: 'Wallets', icon: <Wallet className="w-4 h-4" /> },
            { id: 'transfers' as TabId, label: 'Send', icon: <Send className="w-4 h-4" /> },
            { id: 'profile' as TabId, label: 'Me', icon: <UserCircle2 className="w-4 h-4" /> },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => switchTab(item.id)}
              className={`flex flex-col items-center justify-center gap-1 py-1.5 px-2 rounded-xl text-[11px] font-medium transition-colors cursor-pointer ${
                tab === item.id && !mobileMenu
                  ? 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setMobileMenu((v) => !v)}
            aria-label="Toggle navigation menu"
            className={`flex flex-col items-center justify-center gap-1 py-1.5 px-2 rounded-xl text-[11px] font-medium transition-colors cursor-pointer ${
              mobileMenu
                ? 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {mobileMenu ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            <span>Menu</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
