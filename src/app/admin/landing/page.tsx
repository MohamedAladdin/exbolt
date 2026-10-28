import { getLandingSettings, listPlans } from '@/lib/admin/queries';
import { guardAdminPage } from '@/lib/admin/guard-page';
import { LandingEditor } from '@/components/admin/landing-editor';

export const dynamic = 'force-dynamic';

export default async function AdminLandingPage() {
  await guardAdminPage();
  const [settings, plans] = await Promise.all([getLandingSettings(), listPlans()]);

  return <LandingEditor settings={settings} plans={plans} />;
}
