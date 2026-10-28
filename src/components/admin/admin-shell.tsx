'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useState, type ReactNode } from 'react';
import {
  ArrowLeftRight,
  ClipboardList,
  CreditCard,
  Globe2,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Plug,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { adminT } from '@/lib/admin/copy';

const NAV = [
  { href: '/admin', key: 'nav.overview', icon: LayoutDashboard },
  { href: '/admin/inquiries', key: 'nav.inquiries', icon: Inbox },
  { href: '/admin/requests', key: 'nav.requests', icon: ClipboardList },
  { href: '/admin/landing', key: 'nav.landing', icon: Globe2 },
  { href: '/admin/accounts', key: 'nav.accounts', icon: Users },
  { href: '/admin/billing', key: 'nav.billing', icon: CreditCard },
  { href: '/admin/channels', key: 'nav.channels', icon: Plug },
  { href: '/admin/audit', key: 'nav.audit', icon: ScrollText },
  { href: '/admin/settings', key: 'nav.settings', icon: Settings },
] as const;

export function AdminShell({
  email,
  pendingRequests = 0,
  children,
}: {
  email: string;
  pendingRequests?: number;
  children: ReactNode;
}) {
  const locale = useLocale();
  const t = adminT(locale);
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const signOut = async () => {
    await createClient().auth.signOut();
    router.push('/login');
  };

  const nav = (
    <>
      <div className="border-border flex h-14 items-center gap-2 border-b px-4">
        <div className="bg-foreground text-background flex size-8 items-center justify-center rounded-lg">
          <ShieldCheck className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="text-foreground truncate text-sm font-semibold">
            {t('appName')}
          </div>
          <div className="text-muted-foreground truncate text-[10px] tracking-wider uppercase">
            {t('adminBadge')}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:bg-muted ms-auto flex size-8 items-center justify-center rounded-md lg:hidden"
          aria-label={t('closeMenu')}
        >
          <X className="size-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active =
              item.href === '/admin'
                ? pathname === '/admin'
                : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <item.icon className="size-4" />
                  <span className="flex-1">{t(item.key)}</span>
                  {item.href === '/admin/requests' && pendingRequests > 0 ? (
                    <span className="bg-primary text-primary-foreground ms-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums">
                      {pendingRequests}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-border border-t p-3">
        <p
          className="text-muted-foreground mb-2 truncate px-1 text-[11px]"
          title={email}
        >
          {email}
        </p>
        <Link
          href="/dashboard"
          className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors"
        >
          <ArrowLeftRight className="size-3.5" />
          {t('backToApp')}
        </Link>
        <button
          type="button"
          onClick={signOut}
          className="text-muted-foreground hover:bg-muted hover:text-foreground flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors"
        >
          <LogOut className="size-3.5" />
          {t('signOut')}
        </button>
      </div>
    </>
  );

  return (
    <div className="bg-background flex min-h-screen">
      <aside className="border-border bg-card sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-e lg:flex">
        {nav}
      </aside>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label={t('closeMenu')}
            className="bg-background/80 absolute inset-0 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <aside className="border-border bg-card relative flex h-full w-64 flex-col border-e">
            {nav}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border bg-background/90 sticky top-0 z-20 flex h-14 items-center gap-3 border-b px-4 backdrop-blur">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-muted-foreground hover:bg-muted flex size-9 items-center justify-center rounded-md lg:hidden"
            aria-label={t('openMenu')}
          >
            <Menu className="size-5" />
          </button>
          <span className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
            {t('console')}
          </span>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
