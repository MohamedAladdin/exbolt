import { getLocale } from 'next-intl/server';

import { listInquiries } from '@/lib/admin/queries';
import { guardAdminPage } from '@/lib/admin/guard-page';
import { adminT } from '@/lib/admin/copy';
import { InquiriesTable } from '@/components/admin/inquiries-table';

export const dynamic = 'force-dynamic';

export default async function AdminInquiriesPage() {
  await guardAdminPage();
  const locale = await getLocale();
  const t = adminT(locale);
  const rows = await listInquiries();

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-foreground text-xl font-semibold">
          {t('inquiries.title')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('inquiries.subtitle')}
        </p>
      </header>
      <InquiriesTable rows={rows} />
    </div>
  );
}
