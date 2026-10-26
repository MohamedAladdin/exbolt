'use client';

import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Ban, ShieldCheck } from 'lucide-react';

import type { MemberRow } from '@/lib/admin/queries';
import { adminPatch } from '@/lib/admin/client';
import { adminErrorText, adminT } from '@/lib/admin/copy';
import {
  Chip,
  DataTable,
  EmptyRow,
  TD,
  TH,
  THead,
} from '@/components/admin/ui';

export function MembersPanel({
  accountId,
  members,
}: {
  accountId: string;
  members: MemberRow[];
}) {
  const locale = useLocale();
  const t = adminT(locale);
  const router = useRouter();
  const [blocking, setBlocking] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (userId: string, blocked: boolean, why?: string) => {
    setBusy(true);
    try {
      await adminPatch(`/api/admin/accounts/${accountId}`, {
        action: 'member_block',
        userId,
        blocked,
        reason: why ?? null,
      });
      toast.success(t('done'));
      setBlocking(null);
      setReason('');
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
        <h2 className="text-foreground text-sm font-semibold">
          {t('members.title')}
        </h2>
      </header>
      <div className="p-4">
        <DataTable>
          <THead>
            <TH>{t('col.owner')}</TH>
            <TH>{t('members.role')}</TH>
            <TH>{t('status')}</TH>
            <TH className="text-end">{t('actions')}</TH>
          </THead>
          <tbody>
            {members.length === 0 ? (
              <EmptyRow colSpan={4}>{t('members.empty')}</EmptyRow>
            ) : (
              members.map((member) => (
                <tr
                  key={member.userId}
                  className="border-border/60 border-b align-top last:border-0"
                >
                  <TD>
                    <span className="text-foreground block text-sm font-medium">
                      {member.fullName || '—'}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {member.email}
                    </span>
                  </TD>
                  <TD>
                    <Chip tone={member.role === 'owner' ? 'warn' : 'neutral'}>
                      {member.role}
                    </Chip>
                  </TD>
                  <TD>
                    {member.blockedAt ? (
                      <div className="flex flex-col gap-1">
                        <Chip tone="bad">{t('members.blocked')}</Chip>
                        {member.blockedReason ? (
                          <span className="text-muted-foreground text-[11px]">
                            {member.blockedReason}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <Chip tone="ok">{t('status.active')}</Chip>
                    )}
                  </TD>
                  <TD className="text-end">
                    {member.blockedAt ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => act(member.userId, false)}
                        className="border-border text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] disabled:opacity-50"
                      >
                        <ShieldCheck className="size-3" />
                        {t('members.unblock')}
                      </button>
                    ) : blocking === member.userId ? (
                      <div className="flex flex-col items-end gap-1">
                        <input
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                          placeholder={t('members.blockReason')}
                          className="border-border bg-background text-foreground h-7 w-44 rounded-md border px-2 text-[11px]"
                        />
                        <div className="flex gap-1">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => act(member.userId, true, reason)}
                            className="rounded-md bg-red-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-600 disabled:opacity-50"
                          >
                            {t('members.block')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setBlocking(null)}
                            className="border-border text-muted-foreground hover:bg-muted rounded-md border px-2 py-1 text-[11px]"
                          >
                            {t('cancel')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setBlocking(member.userId)}
                        className="border-border text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]"
                      >
                        <Ban className="size-3" />
                        {t('members.block')}
                      </button>
                    )}
                  </TD>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      </div>
    </section>
  );
}
