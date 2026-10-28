import { getLocale } from 'next-intl/server';

import { listAccountRequests } from '@/lib/admin/queries';
import { guardAdminPage } from '@/lib/admin/guard-page';
import { adminT } from '@/lib/admin/copy';
import { RequestsTable } from '@/components/admin/requests-table';

export const dynamic = 'force-dynamic';

export default async function AdminRequestsPage() {
  await guardAdminPage();
  const locale = await getLocale();
  const t = adminT(locale);
  const rows = await listAccountRequests();

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-foreground text-xl font-semibold">{t('requests.title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('requests.subtitle')}</p>
      </header>
      <RequestsTable rows={rows} />
    </div>
  );
}
