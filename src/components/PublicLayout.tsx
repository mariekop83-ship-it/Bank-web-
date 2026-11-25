import React, { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useRouter } from '../utils/router';
import { ThemeToggle } from './ui';

export interface PublicBrandConfig {
  brandName: string;
  shortName: string;
  supportEmail: string;
  domain: string;
  legalDisclosures: {
    regulatoryNotice: string;
    depositNotice: string;
    fxNotice: string;
  };
}

export function PublicLayout({
  children,
  brand,
  dark,
  onToggleTheme,
}: {
  children: React.ReactNode;
  brand: PublicBrandConfig;
  dark: boolean;
  onToggleTheme: () => void;
}) {
  const { path, navigate } = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navLinkClass = (target: string) =>
    `text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
      path === target
        ? 'text-slate-900 dark:text-white underline underline-offset-8 decoration-blue-700 decoration-2'
        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
    }`;

  const go = (target: string) => {
    setMobileOpen(false);
    navigate(target);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Strictly 3-zone Top Bar Contract */}
      <header className="sticky top-0 z-40 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => go('/')}
            className="text-lg font-display font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            {brand.shortName}
          </button>

          <nav className="hidden md:flex items-center gap-7">
            <button type="button" onClick={() => go('/personal')} className={navLinkClass('/personal')}>
              Personal
            </button>
            <button type="button" onClick={() => go('/business')} className={navLinkClass('/business')}>
              Business
            </button>
            <button
              type="button"
              onClick={() => go('/international-transfers')}
              className={navLinkClass('/international-transfers')}
            >
              Transfers
            </button>
            <button type="button" onClick={() => go('/security')} className={navLinkClass('/security')}>
              Security
            </button>
            <button type="button" onClick={() => go('/help-center')} className={navLinkClass('/help-center')}>
              Support
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => go('/login')}
              className="hidden sm:inline-flex items-center justify-center px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Client Portal
            </button>
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle navigation menu"
              className="md:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="md:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-4 space-y-2">
            {[
              ['/', 'Home'],
              ['/personal', 'Personal Banking'],
              ['/business', 'Business Banking'],
              ['/international-transfers', 'International Transfers'],
              ['/multi-currency', 'Multi-Currency Accounts'],
              ['/cards', 'Cards'],
              ['/security', 'Security'],
              ['/about', 'About Us'],
              ['/help-center', 'Help Center'],
              ['/faq', 'FAQ'],
              ['/contact', 'Contact Us'],
              ['/login', 'Client Login'],
              ['/register', 'Open Account'],
            ].map(([href, label]) => (
              <button
                key={href}
                type="button"
                onClick={() => go(href)}
                className="block w-full text-left px-3 py-2.5 text-sm font-medium rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900 cursor-pointer"
              >
                {label}
              </button>
            ))}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <span className="text-xs text-slate-500">Appearance</span>
              <ThemeToggle dark={dark} onToggle={onToggleTheme} />
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 pb-12 border-b border-slate-200 dark:border-slate-800">
            <div className="col-span-2 md:col-span-1">
              <p className="text-base font-display font-bold text-slate-900 dark:text-white">{brand.brandName}</p>
              <p className="mt-2 text-xs leading-relaxed">
                Multi-currency account architecture, double-entry financial ledger, and cross-border payment rails.
              </p>
              <div className="mt-4">
                <ThemeToggle dark={dark} onToggle={onToggleTheme} />
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-900 dark:text-white mb-3">Banking</p>
              <ul className="space-y-2 text-xs">
                <li><button type="button" onClick={() => go('/personal')} className="hover:text-slate-900 dark:hover:text-white cursor-pointer">Personal Banking</button></li>
                <li><button type="button" onClick={() => go('/business')} className="hover:text-slate-900 dark:hover:text-white cursor-pointer">Business Banking</button></li>
                <li><button type="button" onClick={() => go('/multi-currency')} className="hover:text-slate-900 dark:hover:text-white cursor-pointer">Multi-Currency Accounts</button></li>
                <li><button type="button" onClick={() => go('/international-transfers')} className="hover:text-slate-900 dark:hover:text-white cursor-pointer">International Transfers</button></li>
                <li><button type="button" onClick={() => go('/cards')} className="hover:text-slate-900 dark:hover:text-white cursor-pointer">Cards</button></li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-900 dark:text-white mb-3">Institution</p>
              <ul className="space-y-2 text-xs">
                <li><button type="button" onClick={() => go('/about')} className="hover:text-slate-900 dark:hover:text-white cursor-pointer">About Us</button></li>
                <li><button type="button" onClick={() => go('/security')} className="hover:text-slate-900 dark:hover:text-white cursor-pointer">Security Architecture</button></li>
                <li><button type="button" onClick={() => go('/help-center')} className="hover:text-slate-900 dark:hover:text-white cursor-pointer">Help Center</button></li>
                <li><button type="button" onClick={() => go('/faq')} className="hover:text-slate-900 dark:hover:text-white cursor-pointer">Frequently Asked Questions</button></li>
                <li><button type="button" onClick={() => go('/contact')} className="hover:text-slate-900 dark:hover:text-white cursor-pointer">Contact Us</button></li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-900 dark:text-white mb-3">Client Access</p>
              <ul className="space-y-2 text-xs">
                <li><button type="button" onClick={() => go('/login')} className="hover:text-slate-900 dark:hover:text-white cursor-pointer">Client Login</button></li>
                <li><button type="button" onClick={() => go('/register')} className="hover:text-slate-900 dark:hover:text-white cursor-pointer">Open Account</button></li>
                <li><button type="button" onClick={() => go('/forgot-password')} className="hover:text-slate-900 dark:hover:text-white cursor-pointer">Password Recovery</button></li>
                <li><button type="button" onClick={() => go('/admin')} className="hover:text-slate-900 dark:hover:text-white cursor-pointer">Administrator Console</button></li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-900 dark:text-white mb-3">Legal & Privacy</p>
              <ul className="space-y-2 text-xs">
                <li><button type="button" onClick={() => go('/privacy-policy')} className="hover:text-slate-900 dark:hover:text-white cursor-pointer">Privacy Policy</button></li>
                <li><button type="button" onClick={() => go('/terms')} className="hover:text-slate-900 dark:hover:text-white cursor-pointer">Terms & Conditions</button></li>
                <li><button type="button" onClick={() => go('/cookie-policy')} className="hover:text-slate-900 dark:hover:text-white cursor-pointer">Cookie Policy</button></li>
              </ul>
            </div>
          </div>

          <div className="pt-8 space-y-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            <p>{brand.legalDisclosures.regulatoryNotice}</p>
            <p>{brand.legalDisclosures.depositNotice}</p>
            <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-slate-600 dark:text-slate-400">
              <span>© {new Date().getUTCFullYear()} {brand.brandName}. All rights reserved.</span>
              <span>Client Support: {brand.supportEmail}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
