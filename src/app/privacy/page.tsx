import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'سياسة الخصوصية · ExBolt',
  description:
    'كيف تجمع ExBolt بياناتك وتستخدمها وتحميها، وحقوقك في الوصول إليها وحذفها.',
};

const CONTACT = 'info@excal.uk';

type Block = { h: string; p: string[] };

const AR: Block[] = [
  {
    h: 'مين إحنا',
    p: [
      'ExBolt منتج تابع لـ EXCAL LABS. بنقدّم منصة محادثات وإدارة علاقات عملاء بتربط حسابات واتساب بزنس وماسنجر وإنستجرام الخاصة بالعميل.',
      `لأي استفسار عن الخصوصية: ${CONTACT}`,
    ],
  },
  {
    h: 'البيانات اللي بنعالجها',
    p: [
      'بيانات الحساب: الاسم، البريد الإلكتروني، اسم الشركة، ودور المستخدم داخل الحساب.',
      'بيانات القنوات المربوطة: معرّفات حسابات واتساب بزنس والصفحات وحسابات إنستجرام، وأرقام الهواتف، ورموز الوصول (Tokens). الرموز بتتخزن مشفّرة (AES-256-GCM) ومش بتظهر في الواجهة بعد الحفظ.',
      'بيانات المحادثات: الرسائل الواردة والصادرة، جهات الاتصال، الوسائط، وحالات التسليم والقراءة — وكلها بتيجي من واجهات Meta بموافقة صاحب الحساب.',
      'بيانات تشغيلية: سجلات الأخطاء والاستخدام اللازمة لتشغيل الخدمة وتأمينها، وبيانات الفواتير لو كان الحساب مدفوع.',
    ],
  },
  {
    h: 'ليه بنعالجها',
    p: [
      'لتقديم الخدمة نفسها: استقبال وإرسال الرسائل، عرض المحادثات وجهات الاتصال، تشغيل الأتمتة والبث الجماعي.',
      'للتأمين: كشف الاستخدام غير المصرح به ومنع إساءة الاستخدام.',
      'للدعم: الرد على طلباتك وحل المشكلات.',
      'للالتزام القانوني: الفواتير والسجلات المطلوبة نظامًا.',
    ],
  },
  {
    h: 'الأساس القانوني',
    p: [
      'بنعالج البيانات لتنفيذ العقد معك (تقديم الخدمة)، ولمصالحنا المشروعة في تأمين الخدمة وتحسينها، وللالتزامات القانونية. وللرسائل التسويقية بنعتمد على موافقتك ويمكنك سحبها في أي وقت.',
    ],
  },
  {
    h: 'مين بيشوف البيانات',
    p: [
      'Meta Platforms: لتبادل الرسائل مع واتساب وماسنجر وإنستجرام عبر واجهاتها الرسمية.',
      'مزوّد البريد (Amazon SES): لإرسال رسائل النظام مثل تفعيل الحساب واستعادة كلمة المرور.',
      'مزوّد الدفع: عند تفعيل الاشتراك المدفوع.',
      'مزوّد الاستضافة: السيرفر اللي عليه نسخة الخدمة والنسخ الاحتياطية.',
      'إحنا مش بنبيع بياناتك ولا بنشاركها لأغراض إعلانية.',
    ],
  },
  {
    h: 'التخزين والمدة',
    p: [
      'كل عميل ليه نسخة معزولة من قاعدة البيانات، والوصول ليها محكوم على مستوى الصفوف (RLS) — يعني حسابك مش قادر يشوف بيانات حساب تاني.',
      'بنحتفظ بالبيانات طول ما الحساب نشط. بعد طلب الحذف بنمسحها خلال ٣٠ يوم، ما عدا السجلات اللي القانون بيلزمنا نحتفظ بيها (زي الفواتير).',
      'النسخ الاحتياطية بتتحفظ ٧ أيام وبعدها بتتمسح تلقائيًا.',
    ],
  },
  {
    h: 'حقوقك',
    p: [
      'لك حق الوصول لبياناتك وتصحيحها وحذفها، وحق الاعتراض على معالجة معينة، وحق الحصول على نسخة من بياناتك.',
      `لتنفيذ أي حق من دول راسلنا على ${CONTACT} من نفس بريد الحساب، وهنرد خلال ٣٠ يوم.`,
      'ولو حابب تحذف بياناتك من عندنا، فيه صفحة مخصصة بالخطوات: /data-deletion',
    ],
  },
  {
    h: 'الأمان',
    p: [
      'الاتصال مشفّر بـ HTTPS، ورموز الوصول مشفّرة في قاعدة البيانات، والصلاحيات محدودة بأقل قدر لازم، وكل وصول للوحة السوبر أدمن مسجّل في سجل تدقيق.',
    ],
  },
  {
    h: 'الأطفال',
    p: ['الخدمة مش موجهة لمن هم أقل من ١٨ سنة، ومش بنجمع بياناتهم عن قصد.'],
  },
  {
    h: 'التغييرات',
    p: [
      'لو غيّرنا السياسة هنحدّث تاريخ آخر تعديل في أعلى الصفحة، والتغييرات الجوهرية هنبلّغك بيها قبل ما تسري.',
    ],
  },
];

const EN: Block[] = [
  {
    h: 'Who we are',
    p: [
      'ExBolt is a product of EXCAL LABS: a shared inbox and CRM that connects a customer’s own WhatsApp Business, Messenger and Instagram accounts.',
      `Privacy questions: ${CONTACT}`,
    ],
  },
  {
    h: 'Data we process',
    p: [
      'Account data: name, email, company name and the role of each user in the account.',
      'Connected channel data: WhatsApp Business account, Page and Instagram identifiers, phone numbers and access tokens. Tokens are stored encrypted (AES-256-GCM) and are never shown again after saving.',
      'Conversation data: inbound and outbound messages, contacts, media and delivery/read status — all received from Meta’s APIs with the account owner’s consent.',
      'Operational data: error and usage logs needed to run and secure the service, plus billing records for paid accounts.',
    ],
  },
  {
    h: 'Why we process it',
    p: [
      'To provide the service: receive and send messages, show conversations and contacts, run automations and broadcasts.',
      'To keep it secure: detect unauthorised use and abuse.',
      'To support you: answer requests and fix problems.',
      'To meet legal obligations: invoices and records we are required to keep.',
    ],
  },
  {
    h: 'Legal bases',
    p: [
      'We process data to perform our contract with you, for our legitimate interest in securing and improving the service, and to meet legal obligations. Marketing messages rely on your consent, which you can withdraw at any time.',
    ],
  },
  {
    h: 'Who can see it',
    p: [
      'Meta Platforms — to exchange messages over the official WhatsApp, Messenger and Instagram APIs.',
      'Our email provider (Amazon SES) — for system mail such as verification and password reset.',
      'Our payment provider — when a paid subscription is active.',
      'Our hosting provider — the server that runs the instance and its backups.',
      'We never sell your data or share it for advertising.',
    ],
  },
  {
    h: 'Storage and retention',
    p: [
      'Every customer has an isolated database, with row-level security: one account cannot read another account’s rows.',
      'We keep data while the account is active. After a deletion request we erase it within 30 days, except records we must keep by law (for example invoices).',
      'Backups are kept for 7 days and then deleted automatically.',
    ],
  },
  {
    h: 'Your rights',
    p: [
      'You can access, correct or delete your data, object to certain processing, and receive a copy of it.',
      `Email ${CONTACT} from the account address and we will respond within 30 days.`,
      'Step-by-step deletion instructions: /data-deletion',
    ],
  },
  {
    h: 'Security',
    p: [
      'Traffic is encrypted with HTTPS, access tokens are encrypted at rest, permissions are least-privilege, and every super-admin action is written to an audit log.',
    ],
  },
  {
    h: 'Children',
    p: ['The service is not directed at anyone under 18 and we do not knowingly collect their data.'],
  },
  {
    h: 'Changes',
    p: [
      'If this policy changes we update the “last updated” date above, and we tell you before material changes take effect.',
    ],
  },
];

export default async function PrivacyPage() {
  const locale = (await cookies()).get('exbolt_locale')?.value === 'en' ? 'en' : 'ar';
  const blocks = locale === 'ar' ? AR : EN;

  return (
    <main dir={locale === 'ar' ? 'rtl' : 'ltr'} className="min-h-screen bg-white text-neutral-900">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-sm font-medium text-neutral-500">ExBolt</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {locale === 'ar' ? 'سياسة الخصوصية' : 'Privacy Policy'}
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          {locale === 'ar' ? 'آخر تحديث: ٢٧ أكتوبر ٢٠٢٦' : 'Last updated: 27 October 2026'}
        </p>

        <div className="mt-10 space-y-8">
          {blocks.map((block) => (
            <section key={block.h}>
              <h2 className="text-lg font-semibold">{block.h}</h2>
              {block.p.map((line) => (
                <p key={line} className="mt-2 text-[15px] leading-7 text-neutral-700">
                  {line}
                </p>
              ))}
            </section>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap gap-4 border-t border-neutral-200 pt-6 text-sm">
          <Link className="text-neutral-600 underline underline-offset-4" href="/data-deletion">
            {locale === 'ar' ? 'حذف البيانات' : 'Data deletion'}
          </Link>
          <a className="text-neutral-600 underline underline-offset-4" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
        </div>
      </div>
    </main>
  );
}
