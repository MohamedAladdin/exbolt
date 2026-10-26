'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { ShieldAlert } from 'lucide-react';
import { EntitlementsProvider } from '@/hooks/use-entitlements';
import { BrandTitle } from '@/components/layout/brand-title';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { AccountAccessAlert } from '@/components/layout/account-access-alert';
import { PresenceHeartbeat } from '@/components/presence/presence-heartbeat';
import { BrowserNotificationsListener } from '@/components/notifications/browser-notifications-listener';

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading, account, signOut } = useAuth();
  const router = useRouter();
  const t = useTranslations('DashboardShell');
  const blocked = useTranslations('AccountBlocked');

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="border-primary h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
          <p className="text-muted-foreground text-sm">{t('loading')}</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  // Tenant lifecycle lock (migration 065). Reads still resolve for a
  // suspended tenant — that is deliberate, so we can explain *why* the
  // product stopped instead of showing an empty app. Writes are refused
  // server-side by `getCurrentAccount()` regardless of what renders here.
  if (account?.status && account.status !== 'active') {
    const status = account.status as 'suspended' | 'archived' | 'banned';
    return (
      <div className="bg-background flex min-h-screen items-center justify-center p-6">
        <div className="border-border bg-card w-full max-w-md rounded-xl border p-6 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
            <ShieldAlert className="size-6" />
          </div>
          <h1 className="text-foreground text-lg font-semibold">
            {blocked('title')}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            {blocked(status)}
          </p>
          <button
            type="button"
            onClick={signOut}
            className="border-border text-foreground hover:bg-muted mt-6 inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm font-medium transition-colors"
          >
            {blocked('signOut')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <EntitlementsProvider>
      <BrandTitle />
      <div className="bg-background flex h-screen overflow-hidden">
        {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
        <PresenceHeartbeat />
        {/* Desktop alerts for new customer messages (opt-in via Settings →
          Your profile). Headless — renders nothing. */}
        <BrowserNotificationsListener />
        <Sidebar open={sidebarOpen} onClose={closeSidebar} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header onOpenSidebar={() => setSidebarOpen(true)} />
          {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
          <main className="flex-1 overflow-y-auto p-4 sm:p-6">
            {/* Above every page: writes are being rejected and here's why.
              Renders nothing unless the account/role failed to resolve. */}
            <AccountAccessAlert />
            {children}
          </main>
        </div>
      </div>
    </EntitlementsProvider>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
