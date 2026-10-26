import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AdminShell } from '@/components/admin/admin-shell';
import { guardAdminPage } from '@/lib/admin/guard-page';

export const metadata: Metadata = {
  title: 'ExBolt · Control',
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const admin = await guardAdminPage();
  return <AdminShell email={admin.email}>{children}</AdminShell>;
}
