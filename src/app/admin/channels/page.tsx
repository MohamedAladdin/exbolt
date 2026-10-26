import { getLocale } from 'next-intl/server';

import { listChannels } from '@/lib/admin/queries';
import { guardAdminPage } from '@/lib/admin/guard-page';
import { adminT } from '@/lib/admin/copy';
import { ChannelsTable } from '@/components/admin/channels-table';

export const dynamic = 'force-dynamic';

export default async function AdminChannelsPage() {
  await guardAdminPage();
  const locale = await getLocale();
  const t = adminT(locale);
  const rows = await listChannels();

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-foreground text-xl font-semibold">
          {t('channels.title')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('channels.subtitle')}
        </p>
      </header>
      <ChannelsTable rows={rows} />
    </div>
  );
}
