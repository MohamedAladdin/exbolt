import { getLocale } from 'next-intl/server';

import { listAccounts } from '@/lib/admin/queries';
import { guardAdminPage } from '@/lib/admin/guard-page';
import { adminT } from '@/lib/admin/copy';
import { AccountsTable } from '@/components/admin/accounts-table';

export const dynamic = 'force-dynamic';

export default async function AdminAccountsPage() {
  await guardAdminPage();
  const locale = await getLocale();
  const t = adminT(locale);
  const rows = await listAccounts();

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-foreground text-xl font-semibold">
          {t('accounts.title')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('accounts.subtitle')}
        </p>
      </header>
      <AccountsTable rows={rows} />
    </div>
  );
}
