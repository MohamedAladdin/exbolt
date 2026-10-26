import { getLocale } from 'next-intl/server';

import { getSettings, listAdmins, listAllowlist } from '@/lib/admin/queries';
import { guardAdminPage } from '@/lib/admin/guard-page';
import { adminT } from '@/lib/admin/copy';
import { AdminCard } from '@/components/admin/ui';
import {
  AdminsPanel,
  AllowlistPanel,
  SettingsForm,
} from '@/components/admin/settings-client';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  const admin = await guardAdminPage();
  const locale = await getLocale();
  const t = adminT(locale);

  const [settings, admins, allowlist] = await Promise.all([
    getSettings(),
    listAdmins(),
    listAllowlist(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-foreground text-xl font-semibold">
          {t('settings.title')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('settings.subtitle')}
        </p>
      </header>

      <SettingsForm settings={settings} />

      <AdminCard
        title={t('settings.admins.title')}
        description={t('settings.admins.desc')}
      >
        <AdminsPanel admins={admins} currentEmail={admin.email} />
      </AdminCard>

      <AdminCard
        title={t('settings.allowlist.title')}
        description={t('settings.allowlist.desc')}
      >
        <AllowlistPanel rows={allowlist} />
      </AdminCard>
    </div>
  );
}
