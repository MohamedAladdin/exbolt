import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'حذف البيانات · ExBolt',
  description: 'خطوات طلب حذف بياناتك من ExBolt، وما يتم حذفه وما قد يُحتفظ به قانونًا.',
};

const CONTACT = 'info@excal.uk';

const AR = {
  title: 'حذف بياناتك',
  intro:
    'لو عايز تمسح بياناتك من ExBolt، اختار الطريقة الأنسب لك. كل الطلبات بتتنفذ خلال ٣٠ يوم من التحقق من ملكية الحساب.',
  stepsH: 'الطريقة الأولى: من داخل الحساب',
  steps: [
    'ادخل على حسابك في ExBolt.',
    'روح Settings → Channels وافصل أي قناة مربوطة (واتساب / ماسنجر / إنستجرام) — ده بيمسح رموز الوصول فورًا.',
    'روح Settings → Profile واطلب حذف الحساب، أو ابعت إيميل من بريد الحساب.',
  ],
  mailH: 'الطريقة الثانية: إيميل',
  mail: [
    `ابعت من نفس البريد المسجل في الحساب إلى ${CONTACT} واكتب في العنوان: «طلب حذف بيانات».`,
    'اذكر اسم الشركة أو رقم الحساب لو تعرفه، وقولّي لو عايز تحذف الحساب بالكامل ولا الرسائل والجهات بس.',
    'هنرد عليك للتأكيد، وبعد التحقق بنبدأ الحذف.',
  ],
  deleteH: 'اللي بيتمسح',
  del: [
    'بيانات الحساب: الملف الشخصي، الأعضاء، الإعدادات، والباقة.',
    'المحادثات والرسائل والوسائط وجهات الاتصال.',
    'رموز الوصول للقنوات المربوطة.',
    'سجلات الويب هوك والأتمتة الخاصة بالحساب.',
  ],
  keepH: 'اللي ممكن نحتفظ بيه',
  keep: [
    'الفواتير وسجلات الدفع — القانون بيلزمنا نحتفظ بيها لمدة محددة.',
    'سجلات تدقيق الأمان لفترة محدودة، من غير محتوى الرسائل.',
    'النسخ الاحتياطية: بتتمسح تلقائيًا خلال ٧ أيام.',
  ],
  metaH: 'لو البيانات جاية من فيسبوك',
  meta: [
    'لو كنت داخل بحساب فيسبوك، ممكن كمان تمسح بيانات التطبيق من إعداداتك في فيسبوك: Settings & Privacy → Settings → Apps and Websites → ExBolt → Remove.',
    'ده بيلغي وصول التطبيق، وبنكمل إحنا حذف النسخة اللي عندنا بنفس الخطوات فوق.',
  ],
};

const EN = {
  title: 'Delete your data',
  intro:
    'If you want your ExBolt data erased, pick whichever route suits you. Every request is completed within 30 days of verifying account ownership.',
  stepsH: 'Option 1 — from inside the account',
  steps: [
    'Sign in to your ExBolt account.',
    'Go to Settings → Channels and disconnect any connected channel (WhatsApp / Messenger / Instagram). This deletes the access tokens immediately.',
    'Go to Settings → Profile and request account deletion, or email us from the account address.',
  ],
  mailH: 'Option 2 — by email',
  mail: [
    `Email ${CONTACT} from the address registered on the account with the subject “Data deletion request”.`,
    'Tell us the company name or account id if you have it, and whether you want the whole account deleted or only messages and contacts.',
    'We reply to confirm, and once ownership is verified the deletion starts.',
  ],
  deleteH: 'What gets deleted',
  del: [
    'Account data: profile, members, settings and plan.',
    'Conversations, messages, media and contacts.',
    'Access tokens for connected channels.',
    'Webhook and automation records for the account.',
  ],
  keepH: 'What we may keep',
  keep: [
    'Invoices and payment records we are legally required to retain.',
    'Security audit logs for a limited period, without message content.',
    'Backups: erased automatically within 7 days.',
  ],
  metaH: 'If the data came from Facebook',
  meta: [
    'If you signed in with Facebook, you can also remove the app from your Facebook settings: Settings & Privacy → Settings → Apps and Websites → ExBolt → Remove.',
    'That revokes the app’s access; we still delete our copy using the steps above.',
  ],
};

export default async function DataDeletionPage() {
  const locale = (await cookies()).get('exbolt_locale')?.value === 'en' ? 'en' : 'ar';
  const c = locale === 'ar' ? AR : EN;
  const L = (h: string, items: string[]) => (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{h}</h2>
      <ul className="mt-2 list-disc space-y-1 ps-5 text-[15px] leading-7 text-neutral-700">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </section>
  );

  return (
    <main dir={locale === 'ar' ? 'rtl' : 'ltr'} className="min-h-screen bg-white text-neutral-900">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-sm font-medium text-neutral-500">ExBolt</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{c.title}</h1>
        <p className="mt-3 text-[15px] leading-7 text-neutral-700">{c.intro}</p>
        {L(c.stepsH, c.steps)}
        {L(c.mailH, c.mail)}
        {L(c.deleteH, c.del)}
        {L(c.keepH, c.keep)}
        {L(c.metaH, c.meta)}
        <div className="mt-12 flex flex-wrap gap-4 border-t border-neutral-200 pt-6 text-sm">
          <Link className="text-neutral-600 underline underline-offset-4" href="/privacy">
            {locale === 'ar' ? 'سياسة الخصوصية' : 'Privacy policy'}
          </Link>
          <a className="text-neutral-600 underline underline-offset-4" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
        </div>
      </div>
    </main>
  );
}
