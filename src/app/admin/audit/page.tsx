import Link from 'next/link';
import { getLocale } from 'next-intl/server';

import { listAudit } from '@/lib/admin/queries';
import { guardAdminPage } from '@/lib/admin/guard-page';
import { adminT } from '@/lib/admin/copy';
import { formatDateTime } from '@/lib/admin/format';
import { DataTable, EmptyRow, TD, TH, THead } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function AdminAuditPage() {
  await guardAdminPage();
  const locale = await getLocale();
  const t = adminT(locale);
  const rows = await listAudit(200);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-foreground text-xl font-semibold">
          {t('audit.title')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('audit.subtitle')}
        </p>
      </header>

      <div className="border-border bg-card rounded-xl border p-4">
        <DataTable>
          <THead>
            <TH>{t('audit.action')}</TH>
            <TH>{t('audit.target')}</TH>
            <TH>{t('audit.actor')}</TH>
            <TH className="text-end">{t('audit.when')}</TH>
          </THead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={4}>{t('audit.empty')}</EmptyRow>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-border/60 border-b align-top last:border-0"
                >
                  <TD>
                    <span className="text-foreground font-mono text-[11px]">
                      {row.action}
                    </span>
                    {Object.keys(row.details).length > 0 ? (
                      <span
                        className="text-muted-foreground mt-0.5 block max-w-md truncate text-[11px]"
                        title={JSON.stringify(row.details)}
                        dir="ltr"
                      >
                        {JSON.stringify(row.details)}
                      </span>
                    ) : null}
                  </TD>
                  <TD>
                    {row.targetType === 'account' && row.targetId ? (
                      <Link
                        href={`/admin/accounts/${row.targetId}`}
                        className="text-foreground text-xs hover:underline"
                      >
                        {row.targetLabel ?? row.targetId}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        {row.targetLabel ?? '—'}
                      </span>
                    )}
                  </TD>
                  <TD className="text-muted-foreground text-xs">
                    {row.actorEmail ?? '—'}
                  </TD>
                  <TD className="text-muted-foreground text-end text-xs">
                    {formatDateTime(row.createdAt)}
                  </TD>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      </div>
    </div>
  );
}
