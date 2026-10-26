import { getLocale } from 'next-intl/server';

import { getSettings, listInvoices, listPlans } from '@/lib/admin/queries';
import { guardAdminPage } from '@/lib/admin/guard-page';
import { adminT } from '@/lib/admin/copy';
import { isEmailConfigured } from '@/lib/admin/email';
import { AdminCard } from '@/components/admin/ui';
import {
  BillingInvoices,
  ReminderRunner,
} from '@/components/admin/billing-client';
import { PlansEditor } from '@/components/admin/plans-editor';

export const dynamic = 'force-dynamic';

export default async function AdminBillingPage() {
  await guardAdminPage();
  const locale = await getLocale();
  const t = adminT(locale);

  const [invoices, plans, settings] = await Promise.all([
    listInvoices(),
    listPlans(),
    getSettings(),
  ]);
  const smtp = isEmailConfigured();

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-foreground text-xl font-semibold">
          {t('billing.title')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('billing.subtitle')}
        </p>
      </header>

      <div
        className={
          smtp
            ? 'rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-2 text-xs text-emerald-600 dark:text-emerald-400'
            : 'rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-xs text-amber-700 dark:text-amber-400'
        }
      >
        {smtp ? t('billing.smtpOn') : t('billing.smtpOff')}
      </div>

      <AdminCard title={t('billing.reminders.title')}>
        <ReminderRunner
          days={settings.reminderDaysBefore}
          grace={settings.graceDays}
        />
      </AdminCard>

      <AdminCard title={t('billing.invoices.title')}>
        <BillingInvoices rows={invoices} />
      </AdminCard>

      <AdminCard
        title={t('billing.plans.title')}
        description={t('billing.plans.desc')}
      >
        <PlansEditor plans={plans} />
      </AdminCard>
    </div>
  );
}
