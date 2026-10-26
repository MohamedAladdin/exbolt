import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

import { LOCALE_COOKIE, resolveLocale, type Locale } from './config';

/**
 * Resolve the message catalogue for this request.
 *
 * Locale precedence: user cookie → `NEXT_PUBLIC_APP_LOCALE` (deployment
 * default) → English. The cookie is what makes the language switchable at
 * runtime from Settings (see `src/app/api/locale/route.ts`); the previous
 * build-time-only resolution could not do that.
 *
 * The catalogues are statically imported below on purpose: a template-literal
 * dynamic import (`import(\`../../messages/${locale}.json\`)`) is not
 * statically analysable by Turbopack in a server bundle, so a locale whose
 * path only exists at runtime can fail to resolve in production while
 * working in dev.
 */
const LOADERS: Record<Locale, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import('../../messages/en.json'),
  ar: () => import('../../messages/ar.json'),
};

export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = resolveLocale(
    store.get(LOCALE_COOKIE)?.value,
    process.env.NEXT_PUBLIC_APP_LOCALE,
  );

  const messages = (await LOADERS[locale]()).default;

  return {
    locale,
    messages,
  };
});
