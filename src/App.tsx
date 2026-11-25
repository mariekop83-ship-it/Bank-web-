import React, { useEffect, useState } from 'react';
import { PublicLayout } from './components/PublicLayout';
import { AdminDashboard } from './pages/AdminDashboard';
import { ForgotResetVerifyPage, LoginPage, RegisterPage } from './pages/AuthPages';
import { CustomerDashboard } from './pages/CustomerDashboard';
import { ContentPage, HomePage, type PublicAppConfig } from './pages/PublicPages';
import { apiRequest } from './utils/api';
import { RouterProvider, useRouter } from './utils/router';

const DEFAULT_CONFIG: PublicAppConfig = {
  brand: {
    brandName: 'Meridian International Bank',
    shortName: 'Meridian Bank',
    supportEmail: 'support@meridianbank.example',
    domain: 'meridianbank.example',
    legalDisclosures: {
      regulatoryNotice:
        'Meridian International Bank is a financial technology platform architecture. Account issuance, payment clearing, card issuance, and custody services operate exclusively through authorized, licensed banking and payment partners when configured.',
      depositNotice:
        'Balances displayed inside this platform reflect internal double-entry ledger records. Deposit insurance or statutory protection applies only where explicitly provided by a configured, regulated partner institution.',
      fxNotice:
        'Currency conversions execute strictly against authorized external exchange-rate feeds configured in environment variables.',
    },
  },
  currencies: [
    { code: 'USD', name: 'US Dollar', symbol: '$', minorUnits: 2, isSupported: true, partnerAvailable: false, partnerName: null },
    { code: 'EUR', name: 'Euro', symbol: '€', minorUnits: 2, isSupported: true, partnerAvailable: false, partnerName: null },
    { code: 'GBP', name: 'British Pound', symbol: '£', minorUnits: 2, isSupported: true, partnerAvailable: false, partnerName: null },
    { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', minorUnits: 2, isSupported: true, partnerAvailable: false, partnerName: null },
    { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', minorUnits: 2, isSupported: true, partnerAvailable: false, partnerName: null },
    { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', minorUnits: 2, isSupported: true, partnerAvailable: false, partnerName: null },
    { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', minorUnits: 2, isSupported: true, partnerAvailable: false, partnerName: null },
    { code: 'JPY', name: 'Japanese Yen', symbol: '¥', minorUnits: 0, isSupported: true, partnerAvailable: false, partnerName: null },
  ],
  providers: {},
  publicSettings: {},
};

function AppShell() {
  const { path } = useRouter();
  const [dark, setDark] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mb_theme') === 'dark';
    } catch {
      return false;
    }
  });
  const [config, setConfig] = useState<PublicAppConfig>(DEFAULT_CONFIG);
  const [, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('mb_theme', dark ? 'dark' : 'light');
    } catch {
      // Ignore storage errors
    }
  }, [dark]);

  useEffect(() => {
    apiRequest<PublicAppConfig>('/api/public/config', { authScope: 'none' })
      .then((data) => {
        if (data?.brand) setConfig(data);
      })
      .catch(() => {
        // Keep configurable defaults
      });
  }, []);

  const toggleTheme = () => setDark((d) => !d);

  if (path.startsWith('/dashboard')) {
    return <CustomerDashboard dark={dark} onToggleTheme={toggleTheme} />;
  }

  if (path.startsWith('/admin')) {
    return <AdminDashboard dark={dark} onToggleTheme={toggleTheme} />;
  }

  const renderPublicRoute = () => {
    if (path === '/' || path === '') {
      return <HomePage config={config} />;
    }
    if (path === '/login') {
      return <LoginPage onLoginSuccess={(u) => setCurrentUser(u)} />;
    }
    if (path === '/register') {
      return <RegisterPage />;
    }
    if (path === '/forgot-password') {
      return <ForgotResetVerifyPage mode="forgot" />;
    }
    if (path === '/reset-password') {
      return <ForgotResetVerifyPage mode="reset" />;
    }
    if (path === '/verify-email') {
      return <ForgotResetVerifyPage mode="verify" />;
    }
    return <ContentPage pageKey={path} config={config} />;
  };

  return (
    <PublicLayout brand={config.brand} dark={dark} onToggleTheme={toggleTheme}>
      {renderPublicRoute()}
    </PublicLayout>
  );
}

export default function App() {
  return (
    <RouterProvider>
      <AppShell />
    </RouterProvider>
  );
}
