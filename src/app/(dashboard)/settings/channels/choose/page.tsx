import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Aperture, MessagesSquare } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  isMessagingChannel,
  type MessagingChannel,
} from '@/lib/channels/types';
import { decrypt } from '@/lib/whatsapp/encryption';
import { META_PAGES_COOKIE, listPages, type MetaPage } from '@/lib/oauth/meta';

/**
 * /settings/channels/choose
 *
 * Shown only when the authorizing user administers more than one Facebook
 * Page. The callback leaves a sealed (AES-GCM) user token in an httpOnly
 * cookie instead of the Page list: Page tokens are credentials and there is
 * no reason for them to reach the browser. This server component re-reads
 * them from Graph and submits the chosen Page to POST
 * /api/oauth/meta/connect, which stores it encrypted.
 *
 * A plain form POST — no client JS, nothing secret in the URL.
 */

export const dynamic = 'force-dynamic';

const BACK = '/settings?tab=channels';

function Shell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="animate-in fade-in-50 mx-auto max-w-2xl duration-200">
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">{title}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {description}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">{children}</CardContent>
      </Card>
    </section>
  );
}

export default async function ChooseChannelPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string }>;
}) {
  const t = await getTranslations('Settings.channels.choose');
  const params = await searchParams;
  const channel: MessagingChannel | null = isMessagingChannel(params.channel)
    ? params.channel
    : null;

  if (!channel) redirect(`${BACK}&error=generic`);

  const Icon = channel === 'instagram' ? Aperture : MessagesSquare;

  const sealed = (await cookies()).get(META_PAGES_COOKIE)?.value ?? '';
  if (!sealed) {
    return (
      <Shell title={t('expiredTitle')} description={t('expiredDesc')}>
        <Button size="sm" render={<Link href={BACK} />}>
          {t('backToSettings')}
        </Button>
      </Shell>
    );
  }

  let pages: MetaPage[];
  try {
    pages = await listPages(decrypt(sealed));
  } catch {
    return (
      <Shell title={t('expiredTitle')} description={t('expiredDesc')}>
        <Button size="sm" render={<Link href={BACK} />}>
          {t('backToSettings')}
        </Button>
      </Shell>
    );
  }

  const candidates =
    channel === 'instagram'
      ? pages.filter((page) => page.instagram_business_account?.id)
      : pages;

  if (candidates.length === 0) {
    return (
      <Shell title={t('noneTitle')} description={t('noneDesc')}>
        <Button size="sm" render={<Link href={BACK} />}>
          {t('backToSettings')}
        </Button>
      </Shell>
    );
  }

  return (
    <Shell title={t('title')} description={t('description')}>
      {candidates.map((page) => {
        const ig = page.instagram_business_account;
        return (
          <form
            key={page.id}
            action="/api/oauth/meta/connect"
            method="post"
            className="border-border bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2.5"
          >
            <input type="hidden" name="channel" value={channel} />
            <input type="hidden" name="page_id" value={page.id} />
            <div className="min-w-0">
              <p className="text-foreground flex items-center gap-2 text-sm font-medium">
                <Icon className="text-primary size-3.5 shrink-0" />
                <span className="truncate">{page.name}</span>
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs" dir="ltr">
                {ig?.username ? `@${ig.username} · ${ig.id}` : page.id}
              </p>
            </div>
            <Button type="submit" size="sm">
              {t('choose')}
            </Button>
          </form>
        );
      })}

      <div className="pt-1">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          render={<Link href={BACK} />}
        >
          {t('cancel')}
        </Button>
      </div>
    </Shell>
  );
}
