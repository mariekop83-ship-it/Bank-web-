import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  FileCheck2,
  History,
  Landmark,
  Loader2,
  LogOut,
  Menu,
  Settings,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react';
import {
  apiRequest,
  ApiError,
  formatDateUtc,
  formatMoney,
  generateIdempotencyKey,
  getAdminToken,
  setAdminToken,
} from '../utils/api';
import { useRouter } from '../utils/router';
import { AlertBanner, StatusText, ThemeToggle } from '../components/ui';

type AdminTab = 'overview' | 'customers' | 'kyc' | 'accounts' | 'transactions' | 'funding' | 'system' | 'audit';

export function AdminDashboard({
  dark,
  onToggleTheme,
}: {
  dark: boolean;
  onToggleTheme: () => void;
}) {
  const { navigate } = useRouter();
  const [adminUser, setAdminUser] = useState<any>(null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [bootstrapResult, setBootstrapResult] = useState<{
    email: string;
    totpSecret: string;
    qrDataUrl: string;
  } | null>(null);
  const [dbError, setDbError] = useState('');
  const [loading, setLoading] = useState(true);

  // Auth forms
  const [loginForm, setLoginForm] = useState({ email: '', password: '', totpCode: '' });
  const [needsMfa, setNeedsMfa] = useState(false);
  const [bootForm, setBootForm] = useState({ email: '', fullName: '', password: '', setupToken: '' });
  const [authError, setAuthError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Workspace state
  const [tab, setTab] = useState<AdminTab>('overview');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [overview, setOverview] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [kycRows, setKycRows] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [selectedLedger, setSelectedLedger] = useState<{ tx: any; entries: any[] } | null>(null);
  const [deposits, setDeposits] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [systemData, setSystemData] = useState<{ fees: any[]; currencies: any[]; settings: any[]; providers?: any }>({
    fees: [],
    currencies: [],
    settings: [],
  });
  const [auditData, setAuditData] = useState<{ auditLogs: any[]; securityEvents: any[] }>({
    auditLogs: [],
    securityEvents: [],
  });

  // Action modal state
  const [actionModal, setActionModal] = useState<{
    title: string;
    label: string;
    needsProviderRef?: boolean;
    onSubmit: (reason: string, providerRef?: string) => Promise<void>;
  } | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [actionProviderRef, setActionProviderRef] = useState('');

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setDbError('');
      try {
        const boot = await apiRequest('/api/admin/bootstrap-status', { authScope: 'none' });
        if (boot.databaseConfigured === false) {
          setDbError(
            'External MySQL database is not configured. Set MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, and MYSQL_DATABASE in your environment.'
          );
          return;
        }
        setNeedsBootstrap(Boolean(boot.needsBootstrap));
        if (!boot.needsBootstrap && getAdminToken()) {
          const me = await apiRequest('/api/admin/auth/me', { authScope: 'admin' });
          setAdminUser(me.admin);
        } else if (!boot.needsBootstrap) {
          try {
            const me = await apiRequest('/api/admin/auth/me', { authScope: 'admin' });
            setAdminUser(me.admin);
          } catch {
            // Not signed in yet
          }
        }
      } catch (err) {
        if (err instanceof ApiError && err.code === 'DB_NOT_CONFIGURED') {
          setDbError(err.message);
        } else {
          setDbError(err instanceof ApiError ? err.message : 'Unable to reach admin service.');
        }
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const loadWorkspaceTab = async (target: AdminTab) => {
    try {
      if (target === 'overview') {
        const d = await apiRequest('/api/admin/dashboard', { authScope: 'admin' });
        setOverview(d);
      } else if (target === 'customers') {
        const u = await apiRequest(`/api/admin/users?search=${encodeURIComponent(userSearch)}`, {
          authScope: 'admin',
        });
        setUsers(u.users || []);
      } else if (target === 'kyc') {
        const k = await apiRequest('/api/admin/kyc', { authScope: 'admin' });
        setKycRows(k.submissions || []);
      } else if (target === 'accounts') {
        const a = await apiRequest('/api/admin/accounts', { authScope: 'admin' });
        setAccounts(a.accounts || []);
      } else if (target === 'transactions') {
        const t = await apiRequest('/api/admin/transactions', { authScope: 'admin' });
        setTransactions(t.transactions || []);
      } else if (target === 'funding') {
        const [dep, wd] = await Promise.all([
          apiRequest('/api/admin/deposits', { authScope: 'admin' }),
          apiRequest('/api/admin/withdrawals', { authScope: 'admin' }),
        ]);
        setDeposits(dep.deposits || []);
        setWithdrawals(wd.withdrawals || []);
      } else if (target === 'system') {
        const s = await apiRequest('/api/admin/system', { authScope: 'admin' });
        setSystemData(s);
      } else if (target === 'audit') {
        const a = await apiRequest('/api/admin/audit-logs', { authScope: 'admin' });
        setAuditData(a);
      }
    } catch (err) {
      setToast({
        type: 'error',
        message: err instanceof ApiError ? err.message : 'Permission denied or failed to load data.',
      });
    }
  };

  useEffect(() => {
    if (adminUser) {
      loadWorkspaceTab(tab);
    }
  }, [adminUser, tab]);

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setAuthError('');
    try {
      const res = await apiRequest('/api/admin/bootstrap', {
        method: 'POST',
        authScope: 'none',
        body: bootForm,
      });
      setBootstrapResult(res);
      setNeedsBootstrap(false);
      setLoginForm((f) => ({ ...f, email: res.email }));
    } catch (err) {
      setAuthError(err instanceof ApiError ? err.message : 'Bootstrap failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setAuthError('');
    try {
      const res = await apiRequest('/api/admin/auth/login', {
        method: 'POST',
        authScope: 'none',
        body: {
          email: loginForm.email,
          password: loginForm.password,
          ...(loginForm.totpCode ? { totpCode: loginForm.totpCode } : {}),
        },
      });
      if (res.requiresTwoFactor) {
        setNeedsMfa(true);
        return;
      }
      if (res.token) setAdminToken(res.token);
      setAdminUser(res.admin);
    } catch (err) {
      setAuthError(err instanceof ApiError ? err.message : 'Invalid administrator credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdminLogout = async () => {
    try {
      await apiRequest('/api/admin/auth/logout', { method: 'POST', authScope: 'admin' });
    } catch {
      // Ignore
    }
    setAdminToken(null);
    setAdminUser(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-blue-700" />
      </div>
    );
  }

  if (dbError) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-lg w-full space-y-4">
          <AlertBanner type="error" title="External MySQL Required" message={dbError} />
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Configure <span className="font-mono">MYSQL_HOST</span>, <span className="font-mono">MYSQL_USER</span>,{' '}
            <span className="font-mono">MYSQL_PASSWORD</span>, and <span className="font-mono">MYSQL_DATABASE</span>, run{' '}
            <span className="font-mono">npm run migrate</span>, and reload this console.
          </p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 cursor-pointer"
          >
            Back to Public Website
          </button>
        </div>
      </div>
    );
  }

  // First-Run Bootstrap or Login Gate
  if (!adminUser) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-400">
              <ShieldAlert className="w-4 h-4" />
              <span>Administrator Console</span>
            </div>
            <ThemeToggle dark={dark} onToggle={onToggleTheme} />
          </div>

          {bootstrapResult && (
            <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 space-y-3 text-xs">
              <p className="font-semibold text-emerald-900 dark:text-emerald-200">
                Super Administrator Provisioned ({bootstrapResult.email})
              </p>
              <p className="text-slate-700 dark:text-slate-300">
                Scan this QR code in your Authenticator app before signing in:
              </p>
              <img src={bootstrapResult.qrDataUrl} alt="Admin MFA QR" className="w-40 h-40 rounded border" />
              <p className="font-mono break-all text-[11px]">Secret: {bootstrapResult.totpSecret}</p>
            </div>
          )}

          {needsBootstrap ? (
            <>
              <div>
                <h1 className="text-xl font-display font-bold text-slate-900 dark:text-white">
                  Claim Initial Super Administrator
                </h1>
                <p className="mt-1 text-xs text-slate-500">
                  No administrator accounts exist yet. Create the primary Super Administrator and bind MFA. This setup locks permanently once claimed.
                </p>
              </div>
              {authError && <AlertBanner type="error" message={authError} />}
              <form onSubmit={handleBootstrap} className="space-y-3.5">
                <input
                  type="email"
                  required
                  placeholder="Administrator Email"
                  value={bootForm.email}
                  onChange={(e) => setBootForm({ ...bootForm, email: e.target.value })}
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
                <input
                  type="text"
                  required
                  placeholder="Full Name"
                  value={bootForm.fullName}
                  onChange={(e) => setBootForm({ ...bootForm, fullName: e.target.value })}
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
                <input
                  type="password"
                  required
                  minLength={12}
                  placeholder="Strong Password (min 12 characters)"
                  value={bootForm.password}
                  onChange={(e) => setBootForm({ ...bootForm, password: e.target.value })}
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
                <input
                  type="text"
                  placeholder="Setup Token (if ADMIN_SETUP_TOKEN configured)"
                  value={bootForm.setupToken}
                  onChange={(e) => setBootForm({ ...bootForm, setupToken: e.target.value })}
                  className="w-full px-3.5 py-2.5 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 text-sm font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white cursor-pointer"
                >
                  {submitting ? 'Provisioning...' : 'Provision Super Administrator'}
                </button>
              </form>
            </>
          ) : (
            <>
              <div>
                <h1 className="text-xl font-display font-bold text-slate-900 dark:text-white">
                  Administrator Sign In
                </h1>
                <p className="mt-1 text-xs text-slate-500">
                  Separate RBAC administrative portal protected with MFA and immutable audit logging.
                </p>
              </div>
              {authError && <AlertBanner type="error" message={authError} />}
              <form onSubmit={handleAdminLogin} className="space-y-4">
                <input
                  type="email"
                  required
                  placeholder="Admin Email"
                  value={loginForm.email}
                  onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
                <input
                  type="password"
                  required
                  placeholder="Password"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
                {(needsMfa || bootstrapResult) && (
                  <input
                    type="text"
                    required
                    maxLength={6}
                    placeholder="6-Digit MFA Authenticator Code"
                    value={loginForm.totpCode}
                    onChange={(e) => setLoginForm({ ...loginForm, totpCode: e.target.value })}
                    className="w-full px-3.5 py-2.5 text-sm font-mono tracking-widest rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                )}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 text-sm font-semibold rounded-lg bg-slate-900 dark:bg-blue-700 text-white cursor-pointer"
                >
                  {submitting ? 'Authenticating...' : 'Sign In to Admin Console'}
                </button>
              </form>
            </>
          )}

          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-xs text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
          >
            Return to Public Website
          </button>
        </div>
      </div>
    );
  }

  const adminNav: Array<{ id: AdminTab; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Operations Overview', icon: <Activity className="w-4 h-4" /> },
    { id: 'customers', label: 'Customers', icon: <Users className="w-4 h-4" /> },
    { id: 'kyc', label: 'KYC Review Queue', icon: <FileCheck2 className="w-4 h-4" /> },
    { id: 'accounts', label: 'Accounts & Wallets', icon: <Landmark className="w-4 h-4" /> },
    { id: 'transactions', label: 'Ledger & Transactions', icon: <History className="w-4 h-4" /> },
    { id: 'funding', label: 'Deposits & Withdrawals', icon: <ArrowLeftRight className="w-4 h-4" /> },
    { id: 'system', label: 'Fees & System Config', icon: <Settings className="w-4 h-4" /> },
    { id: 'audit', label: 'Audit & Security Logs', icon: <ShieldAlert className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <aside className="hidden lg:flex lg:flex-col w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shrink-0">
        <div className="h-16 px-6 flex items-center border-b border-slate-200 dark:border-slate-800">
          <span className="font-display font-bold text-sm tracking-tight">Meridian Admin Console</span>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {adminNav.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg cursor-pointer ${
                tab === item.id ? 'bg-slate-900 dark:bg-blue-700 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-2 text-xs">
          <p className="font-semibold truncate">{adminUser.fullName}</p>
          <p className="text-slate-500 font-mono">{adminUser.roleCode}</p>
          <button
            type="button"
            onClick={handleAdminLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {mobileMenu && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-72 bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 p-4 flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
              <span className="font-display font-bold text-sm">Admin Console</span>
              <button type="button" onClick={() => setMobileMenu(false)} className="cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <nav className="flex-1 py-4 space-y-1">
              {adminNav.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { setTab(item.id); setMobileMenu(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg cursor-pointer ${
                    tab === item.id ? 'bg-blue-700 text-white' : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
          </div>
          <div className="flex-1 bg-black/50" onClick={() => setMobileMenu(false)} />
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 px-4 sm:px-8 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setMobileMenu(true)} className="lg:hidden p-2 rounded border border-slate-200 dark:border-slate-800 cursor-pointer">
              <Menu className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold">
              {adminNav.find((i) => i.id === tab)?.label}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-xs font-mono text-slate-500">{adminUser.roleCode}</span>
            <ThemeToggle dark={dark} onToggle={onToggleTheme} />
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto space-y-6">
          {toast && <AlertBanner type={toast.type} message={toast.message} onDismiss={() => setToast(null)} />}

          {/* OVERVIEW */}
          {tab === 'overview' && overview && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <p className="text-xs text-slate-500">Total Customers</p>
                  <p className="mt-2 text-2xl font-mono font-semibold">{overview.customers?.total_customers || 0}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Verified: {overview.customers?.verified_customers || 0} · Pending KYC: {overview.customers?.pending_kyc || 0}
                  </p>
                </div>
                <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <p className="text-xs text-slate-500">Suspended / Restricted</p>
                  <p className="mt-2 text-2xl font-mono font-semibold">{overview.customers?.suspended_accounts || 0}</p>
                  <p className="mt-1 text-xs text-slate-500">Compliance holds</p>
                </div>
                <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <p className="text-xs text-slate-500">Settled Transaction Volume</p>
                  <p className="mt-2 text-2xl font-mono font-semibold">{formatMoney(overview.transactions?.transaction_volume)}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {overview.transactions?.successful_transactions || 0} successful · {overview.transactions?.pending_transactions || 0} pending
                  </p>
                </div>
                <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <p className="text-xs text-slate-500">Deposit / Withdrawal / Fee Revenue</p>
                  <p className="mt-2 text-xl font-mono font-semibold">{formatMoney(overview.transactions?.fee_revenue)}</p>
                  <p className="mt-1 text-xs text-slate-500 font-mono">
                    Dep: {formatMoney(overview.deposits?.deposit_volume)} · Wdr: {formatMoney(overview.withdrawals?.withdrawal_volume)}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                <h2 className="text-base font-semibold pb-3 border-b border-slate-100 dark:border-slate-800">
                  Configured Partner & Integration Status
                </h2>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.entries(overview.providers || {}).map(([key, val]: [string, any]) => (
                    <div key={key} className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold capitalize">{key}</span>
                        <StatusText status={val.mode} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{val.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* CUSTOMERS */}
          {tab === 'customers' && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold">Customer Directory</h2>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Search email, name, account..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                  <button
                    type="button"
                    onClick={() => loadWorkspaceTab('customers')}
                    className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white cursor-pointer"
                  >
                    Search
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-2 pr-3">Customer</th>
                      <th className="py-2 pr-3">Account</th>
                      <th className="py-2 pr-3">KYC</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 text-right">Governance Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td className="py-3 pr-3">
                          <p className="font-semibold">{u.first_name} {u.last_name}</p>
                          <p className="text-slate-500">{u.email}</p>
                        </td>
                        <td className="py-3 pr-3 font-mono">{u.account_number}</td>
                        <td className="py-3 pr-3"><StatusText status={u.kyc_status} /></td>
                        <td className="py-3 pr-3"><StatusText status={u.status} /></td>
                        <td className="py-3 text-right space-x-2">
                          {u.status !== 'SUSPENDED' && (
                            <button
                              type="button"
                              onClick={() =>
                                setActionModal({
                                  title: `Suspend ${u.email}`,
                                  label: 'Compliance Reason for Suspension',
                                  onSubmit: async (reason) => {
                                    await apiRequest(`/api/admin/users/${u.id}/status`, {
                                      method: 'POST',
                                      authScope: 'admin',
                                      body: { status: 'SUSPENDED', reason },
                                    });
                                    await loadWorkspaceTab('customers');
                                  },
                                })
                              }
                              className="px-2.5 py-1 rounded border border-rose-300 text-rose-700 dark:text-rose-400 cursor-pointer"
                            >
                              Suspend
                            </button>
                          )}
                          {u.status !== 'ACTIVE' && (
                            <button
                              type="button"
                              onClick={() =>
                                setActionModal({
                                  title: `Reactivate ${u.email}`,
                                  label: 'Reason for Reactivation',
                                  onSubmit: async (reason) => {
                                    await apiRequest(`/api/admin/users/${u.id}/status`, {
                                      method: 'POST',
                                      authScope: 'admin',
                                      body: { status: 'ACTIVE', reason },
                                    });
                                    await loadWorkspaceTab('customers');
                                  },
                                })
                              }
                              className="px-2.5 py-1 rounded bg-emerald-700 text-white cursor-pointer"
                            >
                              Reactivate
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* KYC QUEUE */}
          {tab === 'kyc' && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
              <h2 className="text-base font-semibold">KYC Verification Queue</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-2 pr-3">Applicant</th>
                      <th className="py-2 pr-3">Document</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 text-right">Review Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {kycRows.map((row) => (
                      <tr key={row.doc_uuid}>
                        <td className="py-3 pr-3">
                          <p className="font-semibold">{row.first_name} {row.last_name}</p>
                          <p className="text-slate-500">{row.email} · {row.country}</p>
                        </td>
                        <td className="py-3 pr-3">
                          <p>{row.document_type} ({row.issuing_country || 'N/A'})</p>
                          <a
                            href={`/api/admin/kyc/documents/${row.doc_uuid}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-700 dark:text-blue-400 underline"
                          >
                            Inspect Encrypted File
                          </a>
                        </td>
                        <td className="py-3 pr-3"><StatusText status={row.kyc_status} /></td>
                        <td className="py-3 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() =>
                              setActionModal({
                                title: `Approve KYC for ${row.email}`,
                                label: 'Compliance Approval Note',
                                onSubmit: async (reason) => {
                                  await apiRequest(`/api/admin/kyc/${row.user_id}/review`, {
                                    method: 'POST',
                                    authScope: 'admin',
                                    body: { decision: 'APPROVED', notes: reason },
                                  });
                                  await loadWorkspaceTab('kyc');
                                },
                              })
                            }
                            className="px-2.5 py-1 rounded bg-emerald-700 text-white cursor-pointer"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setActionModal({
                                title: `Reject KYC for ${row.email}`,
                                label: 'Rejection Reason',
                                onSubmit: async (reason) => {
                                  await apiRequest(`/api/admin/kyc/${row.user_id}/review`, {
                                    method: 'POST',
                                    authScope: 'admin',
                                    body: { decision: 'REJECTED', notes: reason },
                                  });
                                  await loadWorkspaceTab('kyc');
                                },
                              })
                            }
                            className="px-2.5 py-1 rounded border border-rose-300 text-rose-700 cursor-pointer"
                          >
                            Reject
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ACCOUNTS & WALLETS */}
          {tab === 'accounts' && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
              <h2 className="text-base font-semibold pb-3 border-b border-slate-100 dark:border-slate-800">
                Customer Accounts & Currency Wallets
              </h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-2 pr-3">Customer</th>
                      <th className="py-2 pr-3">Account</th>
                      <th className="py-2 pr-3">Currency</th>
                      <th className="py-2 pr-3 text-right">Available</th>
                      <th className="py-2 pr-3 text-right">Pending</th>
                      <th className="py-2 text-right">Ledger</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {accounts.map((a) => (
                      <tr key={a.id}>
                        <td className="py-2.5 pr-3">{a.first_name} {a.last_name} ({a.email})</td>
                        <td className="py-2.5 pr-3 font-mono">{a.account_number}</td>
                        <td className="py-2.5 pr-3 font-mono font-semibold">{a.currency}</td>
                        <td className="py-2.5 pr-3 text-right font-mono">{formatMoney(a.available_balance, a.currency)}</td>
                        <td className="py-2.5 pr-3 text-right font-mono">{formatMoney(a.pending_balance, a.currency)}</td>
                        <td className="py-2.5 text-right font-mono font-semibold">{formatMoney(a.ledger_balance, a.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* LEDGER & TRANSACTIONS */}
          {tab === 'transactions' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                <h2 className="text-base font-semibold pb-3 border-b border-slate-100 dark:border-slate-800">
                  Double-Entry Transaction Explorer
                </h2>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                        <th className="py-2 pr-3">Reference</th>
                        <th className="py-2 pr-3">Initiator</th>
                        <th className="py-2 pr-3">Type</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2 pr-3 text-right">Amount</th>
                        <th className="py-2 text-right">Controls</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {transactions.map((tx) => (
                        <tr key={tx.id}>
                          <td className="py-2.5 pr-3 font-mono">{tx.reference}</td>
                          <td className="py-2.5 pr-3">{tx.initiator_email || 'System'}</td>
                          <td className="py-2.5 pr-3">{tx.transaction_type}</td>
                          <td className="py-2.5 pr-3"><StatusText status={tx.status} /></td>
                          <td className="py-2.5 pr-3 text-right font-mono">{formatMoney(tx.total_amount, tx.currency)}</td>
                          <td className="py-2.5 text-right space-x-2">
                            <button
                              type="button"
                              onClick={async () => {
                                const res = await apiRequest(`/api/admin/transactions/${tx.id}/ledger`, { authScope: 'admin' });
                                setSelectedLedger({ tx, entries: res.entries || [] });
                              }}
                              className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 cursor-pointer"
                            >
                              Ledger Legs
                            </button>
                            {tx.status === 'SUCCESSFUL' && tx.transaction_type !== 'REVERSAL' && (
                              <button
                                type="button"
                                onClick={() =>
                                  setActionModal({
                                    title: `Reverse ${tx.reference}`,
                                    label: 'Mandatory Audit Reason for Compensating Reversal',
                                    onSubmit: async (reason) => {
                                      await apiRequest(`/api/admin/transactions/${tx.id}/reverse`, {
                                        method: 'POST',
                                        authScope: 'admin',
                                        body: { reason, idempotencyKey: generateIdempotencyKey('rev') },
                                      });
                                      await loadWorkspaceTab('transactions');
                                    },
                                  })
                                }
                                className="px-2.5 py-1 rounded border border-rose-300 text-rose-700 cursor-pointer"
                              >
                                Reverse
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {selectedLedger && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                    <h3 className="text-sm font-semibold font-mono">
                      Ledger Entries for {selectedLedger.tx.reference}
                    </h3>
                    <button type="button" onClick={() => setSelectedLedger(null)} className="text-xs underline cursor-pointer">
                      Close
                    </button>
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                          <th className="py-2 pr-3">Account Code</th>
                          <th className="py-2 pr-3">Class</th>
                          <th className="py-2 pr-3">Side</th>
                          <th className="py-2 pr-3 text-right">Amount</th>
                          <th className="py-2 text-right">Balance After</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {selectedLedger.entries.map((e) => (
                          <tr key={e.id}>
                            <td className="py-2 pr-3">{e.account_code}</td>
                            <td className="py-2 pr-3">{e.account_class}</td>
                            <td className="py-2 pr-3">{e.entry_type}</td>
                            <td className="py-2 pr-3 text-right">{formatMoney(e.amount, e.currency)}</td>
                            <td className="py-2 text-right">{formatMoney(e.balance_after, e.currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* DEPOSITS & WITHDRAWALS */}
          {tab === 'funding' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-3">
                <h2 className="text-base font-semibold">Deposit Reconciliation</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                        <th className="py-2 pr-2">Ref / Customer</th>
                        <th className="py-2 pr-2">Amount</th>
                        <th className="py-2 pr-2">Status</th>
                        <th className="py-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {deposits.map((d) => (
                        <tr key={d.id}>
                          <td className="py-2.5 pr-2">
                            <p className="font-mono">{d.reference}</p>
                            <p className="text-slate-500">{d.customer_email}</p>
                          </td>
                          <td className="py-2.5 pr-2 font-mono">{formatMoney(d.amount, d.currency)}</td>
                          <td className="py-2.5 pr-2"><StatusText status={d.status} /></td>
                          <td className="py-2.5 text-right space-x-1">
                            {d.status === 'PENDING' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setActionModal({
                                      title: `Confirm Deposit ${d.reference}`,
                                      label: 'Reconciliation Note',
                                      needsProviderRef: true,
                                      onSubmit: async (reason, providerRef) => {
                                        await apiRequest(`/api/admin/deposits/${d.id}/confirm`, {
                                          method: 'POST',
                                          authScope: 'admin',
                                          body: { providerReference: providerRef || '', reason },
                                        });
                                        await loadWorkspaceTab('funding');
                                      },
                                    })
                                  }
                                  className="px-2 py-1 rounded bg-emerald-700 text-white cursor-pointer"
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setActionModal({
                                      title: `Reject Deposit ${d.reference}`,
                                      label: 'Rejection Reason',
                                      onSubmit: async (reason) => {
                                        await apiRequest(`/api/admin/deposits/${d.id}/reject`, {
                                          method: 'POST',
                                          authScope: 'admin',
                                          body: { reason },
                                        });
                                        await loadWorkspaceTab('funding');
                                      },
                                    })
                                  }
                                  className="px-2 py-1 rounded border border-rose-300 text-rose-700 cursor-pointer"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-3">
                <h2 className="text-base font-semibold">Withdrawal Approvals</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                        <th className="py-2 pr-2">Ref / Customer</th>
                        <th className="py-2 pr-2">Amount</th>
                        <th className="py-2 pr-2">Status</th>
                        <th className="py-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {withdrawals.map((w) => (
                        <tr key={w.id}>
                          <td className="py-2.5 pr-2">
                            <p className="font-mono">{w.reference}</p>
                            <p className="text-slate-500">{w.customer_email}</p>
                          </td>
                          <td className="py-2.5 pr-2 font-mono">{formatMoney(w.amount, w.currency)}</td>
                          <td className="py-2.5 pr-2"><StatusText status={w.status} /></td>
                          <td className="py-2.5 text-right space-x-1">
                            {w.status === 'PENDING' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setActionModal({
                                      title: `Approve & Settle ${w.reference}`,
                                      label: 'Approval Note',
                                      needsProviderRef: true,
                                      onSubmit: async (reason, providerRef) => {
                                        await apiRequest(`/api/admin/withdrawals/${w.id}/approve`, {
                                          method: 'POST',
                                          authScope: 'admin',
                                          body: { providerReference: providerRef || '', reason },
                                        });
                                        await loadWorkspaceTab('funding');
                                      },
                                    })
                                  }
                                  className="px-2 py-1 rounded bg-blue-700 text-white cursor-pointer"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setActionModal({
                                      title: `Reject Withdrawal ${w.reference}`,
                                      label: 'Rejection Reason',
                                      onSubmit: async (reason) => {
                                        await apiRequest(`/api/admin/withdrawals/${w.id}/reject`, {
                                          method: 'POST',
                                          authScope: 'admin',
                                          body: { reason },
                                        });
                                        await loadWorkspaceTab('funding');
                                      },
                                    })
                                  }
                                  className="px-2 py-1 rounded border border-rose-300 text-rose-700 cursor-pointer"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* SYSTEM & FEES */}
          {tab === 'system' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                <h2 className="text-base font-semibold pb-3 border-b border-slate-100 dark:border-slate-800">
                  Configured Transaction Fees
                </h2>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                        <th className="py-2 pr-3">Fee Code</th>
                        <th className="py-2 pr-3">Type</th>
                        <th className="py-2 pr-3">Currency</th>
                        <th className="py-2 pr-3 text-right">Flat</th>
                        <th className="py-2 pr-3 text-right">Percent</th>
                        <th className="py-2 text-right">Active</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {systemData.fees.map((f) => (
                        <tr key={f.id}>
                          <td className="py-2.5 pr-3">{f.fee_code}</td>
                          <td className="py-2.5 pr-3">{f.transaction_type}</td>
                          <td className="py-2.5 pr-3">{f.currency}</td>
                          <td className="py-2.5 pr-3 text-right">{f.flat_fee}</td>
                          <td className="py-2.5 pr-3 text-right">{f.percent_fee}</td>
                          <td className="py-2.5 text-right">{f.is_active ? 'YES' : 'NO'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                <h2 className="text-base font-semibold pb-3 border-b border-slate-100 dark:border-slate-800">
                  System Settings
                </h2>
                <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {systemData.settings.map((s) => (
                    <div key={s.setting_key} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <p className="font-mono font-semibold">{s.setting_key}</p>
                        <p className="text-slate-500">{s.description}</p>
                      </div>
                      <span className="font-mono text-slate-800 dark:text-slate-200">{s.setting_value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* AUDIT & SECURITY LOGS */}
          {tab === 'audit' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                <h2 className="text-base font-semibold pb-3 border-b border-slate-100 dark:border-slate-800">
                  Immutable Administrative Audit Logs
                </h2>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                        <th className="py-2 pr-3">Action</th>
                        <th className="py-2 pr-3">Admin</th>
                        <th className="py-2 pr-3">Target</th>
                        <th className="py-2 pr-3">Reason</th>
                        <th className="py-2 text-right">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {auditData.auditLogs.map((log) => (
                        <tr key={log.uuid}>
                          <td className="py-2.5 pr-3 font-mono font-semibold">{log.action}</td>
                          <td className="py-2.5 pr-3">{log.admin_email || 'System CLI'}</td>
                          <td className="py-2.5 pr-3 font-mono">{log.target_type}#{log.target_id}</td>
                          <td className="py-2.5 pr-3">{log.reason || '—'}</td>
                          <td className="py-2.5 text-right font-mono text-slate-500">{formatDateUtc(log.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                <h2 className="text-base font-semibold pb-3 border-b border-slate-100 dark:border-slate-800">
                  Security Event Stream
                </h2>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                        <th className="py-2 pr-3">Event</th>
                        <th className="py-2 pr-3">Actor</th>
                        <th className="py-2 pr-3">Severity</th>
                        <th className="py-2 pr-3">IP</th>
                        <th className="py-2 text-right">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {auditData.securityEvents.map((ev) => (
                        <tr key={ev.uuid}>
                          <td className="py-2.5 pr-3 font-mono">{ev.event_type}</td>
                          <td className="py-2.5 pr-3">{ev.actor_type}#{ev.actor_id ?? 'N/A'}</td>
                          <td className="py-2.5 pr-3"><StatusText status={ev.severity} /></td>
                          <td className="py-2.5 pr-3 font-mono">{ev.ip_address || '—'}</td>
                          <td className="py-2.5 text-right font-mono text-slate-500">{formatDateUtc(ev.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Controlled Admin Action Reason Modal */}
      {actionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSubmitting(true);
              try {
                await actionModal.onSubmit(actionReason, actionProviderRef);
                setActionModal(null);
                setActionReason('');
                setActionProviderRef('');
                setToast({ type: 'success', message: 'Action recorded and logged.' });
              } catch (err) {
                setToast({ type: 'error', message: err instanceof ApiError ? err.message : 'Action failed.' });
              } finally {
                setSubmitting(false);
              }
            }}
            className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4"
          >
            <h3 className="text-base font-semibold">{actionModal.title}</h3>
            {actionModal.needsProviderRef && (
              <div>
                <label className="block text-xs font-medium mb-1">Verified Provider Settlement Reference</label>
                <input
                  type="text"
                  required
                  minLength={4}
                  value={actionProviderRef}
                  onChange={(e) => setActionProviderRef(e.target.value)}
                  placeholder="e.g. WIRE-99284712"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1">{actionModal.label}</label>
              <textarea
                required
                minLength={5}
                rows={3}
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="px-4 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white cursor-pointer"
              >
                {submitting ? 'Processing...' : 'Confirm & Record Audit'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
