/**
 * Status vocabulary → colour. One file so a status never means two
 * different colours on two screens.
 */

import { adminT } from '@/lib/admin/copy';
import { Chip } from './ui';

const ACCOUNT_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'neutral'> = {
  active: 'ok',
  suspended: 'warn',
  archived: 'neutral',
  banned: 'bad',
};

const SUB_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral'> = {
  active: 'ok',
  trial: 'info',
  past_due: 'warn',
  canceled: 'bad',
  suspended: 'bad',
};

const INVOICE_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral'> =
  {
    draft: 'neutral',
    sent: 'info',
    paid: 'ok',
    overdue: 'bad',
    void: 'neutral',
  };

export function AccountStatusChip({
  status,
  locale,
}: {
  status: string;
  locale: string;
}) {
  const t = adminT(locale);
  return (
    <Chip tone={ACCOUNT_TONE[status] ?? 'neutral'}>
      {t(`status.${status}`)}
    </Chip>
  );
}

export function SubStatusChip({
  status,
  locale,
}: {
  status: string | null;
  locale: string;
}) {
  const t = adminT(locale);
  if (!status) return <Chip tone="neutral">{t('sub.none')}</Chip>;
  return <Chip tone={SUB_TONE[status] ?? 'neutral'}>{t(`sub.${status}`)}</Chip>;
}

export function InvoiceStatusChip({
  status,
  locale,
}: {
  status: string;
  locale: string;
}) {
  const t = adminT(locale);
  return (
    <Chip tone={INVOICE_TONE[status] ?? 'neutral'}>
      {t(`invoice.status.${status}`)}
    </Chip>
  );
}
