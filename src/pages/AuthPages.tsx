import React, { useEffect, useState } from 'react';
import { Loader2, Shield } from 'lucide-react';
import { apiRequest, ApiError, setCustomerToken } from '../utils/api';
import { useRouter } from '../utils/router';
import { AlertBanner } from '../components/ui';

export function LoginPage({
  onLoginSuccess,
}: {
  onLoginSuccess: (user: any) => void;
}) {
  const { navigate } = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [needs2FA, setNeeds2FA] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await apiRequest('/api/auth/login', {
        method: 'POST',
        authScope: 'none',
        body: {
          email,
          password,
          ...(needs2FA ? { totpCode } : {}),
          deviceName: navigator.userAgent.slice(0, 120),
        },
      });
      if (res.requiresTwoFactor) {
        setNeeds2FA(true);
        return;
      }
      if (res.token) {
        setCustomerToken(res.token);
      }
      onLoginSuccess(res.user);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8">
        <div className="flex items-center gap-2 text-xs font-medium text-blue-700 dark:text-blue-400">
          <Shield className="w-4 h-4" />
          <span>Customer Account</span>
        </div>
        <h1 className="mt-2 text-2xl font-display font-bold text-slate-900 dark:text-white">
          Sign in to your account
        </h1>
        <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
          Protected with bcrypt authentication, device tracking, and optional 2FA.
        </p>

        {error && (
          <div className="mt-5">
            <AlertBanner type="error" message={error} />
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={needs2FA}
              className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Password</label>
              <button
                type="button"
                onClick={() => navigate('/forgot-password')}
                className="text-xs text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Forgot password?
              </button>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={needs2FA}
              className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
            />
          </div>

          {needs2FA && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Authenticator 6-Digit Code
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder="000000"
                className="w-full px-3.5 py-2.5 text-sm font-mono tracking-widest rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white transition-colors cursor-pointer"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{needs2FA ? 'Verify Code & Sign In' : 'Sign In'}</span>
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 flex items-center justify-between">
          <span>New to Meridian Bank?</span>
          <button
            type="button"
            onClick={() => navigate('/register')}
            className="font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
          >
            Open an account
          </button>
        </div>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const { navigate } = useRouter();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    country: 'GB',
    dateOfBirth: '',
    addressLine1: '',
    city: '',
    postalCode: '',
    accountTier: 'PERSONAL',
    preferredCurrency: 'USD',
    password: '',
    confirmPassword: '',
    termsAccepted: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdInfo, setCreatedInfo] = useState<{ accountNumber: string; verificationUrl?: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await apiRequest('/api/auth/register', {
        method: 'POST',
        authScope: 'none',
        body: form,
      });
      setCreatedInfo({
        accountNumber: res.accountNumber,
        verificationUrl: res.verificationUrl,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        const detailMsg = err.details?.[0]?.message;
        setError(detailMsg ? `${err.message} (${detailMsg})` : err.message);
      } else {
        setError('Registration failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (createdInfo) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 space-y-5">
          <AlertBanner
            type="success"
            title="Account Provisioned"
            message={`Your account number ${createdInfo.accountNumber} and initial multi-currency ledger wallets have been created.`}
          />
          {createdInfo.verificationUrl && (
            <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs space-y-2">
              <p className="font-semibold text-slate-800 dark:text-slate-200">
                Development Email Verification Link:
              </p>
              <button
                type="button"
                onClick={() => navigate(new URL(createdInfo.verificationUrl!).pathname + new URL(createdInfo.verificationUrl!).search)}
                className="text-blue-700 dark:text-blue-400 underline break-all text-left cursor-pointer"
              >
                {createdInfo.verificationUrl}
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white cursor-pointer"
          >
            Proceed to Customer Account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-14">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8">
        <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white">
          Open an International Account
        </h1>
        <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
          Complete customer onboarding details to initialize your multi-currency double-entry ledger wallets.
        </p>

        {error && (
          <div className="mt-5">
            <AlertBanner type="error" message={error} />
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">First Name</label>
              <input
                type="text"
                required
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Last Name</label>
              <input
                type="text"
                required
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email Address</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Phone Number</label>
              <input
                type="tel"
                required
                placeholder="+44 20 7946 0192"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Country (ISO-2)</label>
              <select
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              >
                <option value="US">United States (US)</option>
                <option value="GB">United Kingdom (GB)</option>
                <option value="DE">Germany (DE)</option>
                <option value="FR">France (FR)</option>
                <option value="NG">Nigeria (NG)</option>
                <option value="CA">Canada (CA)</option>
                <option value="AU">Australia (AU)</option>
                <option value="CH">Switzerland (CH)</option>
                <option value="JP">Japan (JP)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Date of Birth</label>
              <input
                type="date"
                required
                value={form.dateOfBirth}
                onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Account Tier</label>
              <select
                value={form.accountTier}
                onChange={(e) => setForm({ ...form, accountTier: e.target.value })}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              >
                <option value="PERSONAL">Personal Banking</option>
                <option value="BUSINESS">Business Treasury</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Residential Address</label>
              <input
                type="text"
                required
                value={form.addressLine1}
                onChange={(e) => setForm({ ...form, addressLine1: e.target.value })}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">City</label>
              <input
                type="text"
                required
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Postal Code</label>
              <input
                type="text"
                value={form.postalCode}
                onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Primary Currency</label>
              <select
                value={form.preferredCurrency}
                onChange={(e) => setForm({ ...form, preferredCurrency: e.target.value })}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              >
                {['USD', 'EUR', 'GBP', 'NGN', 'CAD', 'AUD', 'CHF', 'JPY'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Password (min 10 chars, upper, lower, number)
              </label>
              <input
                type="password"
                required
                minLength={10}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Confirm Password</label>
              <input
                type="password"
                required
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <label className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              required
              checked={form.termsAccepted}
              onChange={(e) => setForm({ ...form, termsAccepted: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              I accept the{' '}
              <button type="button" onClick={() => navigate('/terms')} className="text-blue-700 dark:text-blue-400 underline">
                Terms & Conditions
              </button>{' '}
              and{' '}
              <button type="button" onClick={() => navigate('/privacy-policy')} className="text-blue-700 dark:text-blue-400 underline">
                Privacy Policy
              </button>
              .
            </span>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white cursor-pointer"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>Create Banking Account</span>
          </button>
        </form>
      </div>
    </div>
  );
}

export function ForgotResetVerifyPage({ mode }: { mode: 'forgot' | 'reset' | 'verify' }) {
  const { query, navigate } = useRouter();
  const [email, setEmail] = useState('');
  const [token, setToken] = useState(() => query.get('token') || '');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string; resetUrl?: string } | null>(null);

  useEffect(() => {
    if (mode === 'verify' && token) {
      setLoading(true);
      apiRequest('/api/auth/verify-email', {
        method: 'POST',
        authScope: 'none',
        body: { token },
      })
        .then((res) => setStatus({ type: 'success', msg: res.message }))
        .catch((err) => setStatus({ type: 'error', msg: err instanceof ApiError ? err.message : 'Verification failed.' }))
        .finally(() => setLoading(false));
    }
  }, [mode, token]);

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiRequest('/api/auth/forgot-password', {
        method: 'POST',
        authScope: 'none',
        body: { email },
      });
      setStatus({ type: 'success', msg: res.message, resetUrl: res.resetUrl });
    } catch (err) {
      setStatus({ type: 'error', msg: err instanceof ApiError ? err.message : 'Request failed.' });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiRequest('/api/auth/reset-password', {
        method: 'POST',
        authScope: 'none',
        body: { token, newPassword },
      });
      setStatus({ type: 'success', msg: res.message });
    } catch (err) {
      setStatus({ type: 'error', msg: err instanceof ApiError ? err.message : 'Reset failed.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 space-y-5">
        <h1 className="text-xl font-display font-bold text-slate-900 dark:text-white">
          {mode === 'forgot' && 'Password Recovery'}
          {mode === 'reset' && 'Set New Password'}
          {mode === 'verify' && 'Email Verification'}
        </h1>

        {status && <AlertBanner type={status.type} message={status.msg} />}
        {status?.resetUrl && (
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => navigate(new URL(status.resetUrl!).pathname + new URL(status.resetUrl!).search)}
              className="text-blue-700 dark:text-blue-400 underline break-all text-left cursor-pointer"
            >
              Open Reset Link
            </button>
          </div>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handleForgot} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Account Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white cursor-pointer"
            >
              {loading ? 'Sending...' : 'Send Recovery Instructions'}
            </button>
          </form>
        )}

        {mode === 'reset' && (
          <form onSubmit={handleReset} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Reset Token</label>
              <input
                type="text"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">New Password (min 10 chars)</label>
              <input
                type="password"
                required
                minLength={10}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white cursor-pointer"
            >
              {loading ? 'Updating...' : 'Reset Password'}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => navigate('/login')}
          className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
        >
          Back to Customer Account
        </button>
      </div>
    </div>
  );
}
