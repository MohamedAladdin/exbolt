'use client';

import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Mail } from 'lucide-react';

import { adminPatch } from '@/lib/admin/client';
import { adminErrorText, adminT } from '@/lib/admin/copy';

const inputClass =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none';

export function EmailPanel({
  accountId,
  defaultTo,
  defaultName,
}: {
  accountId: string;
  defaultTo: string;
  defaultName: string;
}) {
  const locale = useLocale();
  const t = adminT(locale);
  const router = useRouter();

  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      const result = await adminPatch<{ status?: string }>(
        `/api/admin/accounts/${accountId}`,
        {
          action: 'email',
          to,
          subject,
          body,
          toName: defaultName,
        }
      );
      if (result.status === 'sent') toast.success(t('email.sent'));
      else if (result.status === 'dry_run') toast.warning(t('email.dryRun'));
      else toast.error(t('email.failed'));
      setSubject('');
      setBody('');
      router.refresh();
    } catch (err) {
      toast.error(adminErrorText(locale, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-border bg-card rounded-xl border">
      <header className="border-border border-b px-4 py-3">
        <h2 className="text-foreground flex items-center gap-2 text-sm font-semibold">
          <Mail className="text-muted-foreground size-4" />
          {t('email.title')}
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {t('email.desc')}
        </p>
      </header>
      <div className="flex flex-col gap-2 p-4">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
            {t('email.to')}
          </span>
          <input
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className={inputClass}
            type="email"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
            {t('email.subject')}
          </span>
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
            {t('email.body')}
          </span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={5}
            className="border-border bg-background text-foreground focus:border-foreground/30 w-full resize-y rounded-md border p-2 text-sm focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={send}
          disabled={
            busy || !to.includes('@') || !subject.trim() || !body.trim()
          }
          className="bg-foreground text-background inline-flex h-8 items-center justify-center self-start rounded-md px-3 text-xs font-medium hover:opacity-90 disabled:opacity-40"
        >
          {busy ? t('working') : t('email.send')}
        </button>
      </div>
    </section>
  );
}
