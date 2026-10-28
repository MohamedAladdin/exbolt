/**
 * Copy for the super-admin panel.
 *
 * The panel is an internal ops console, so its strings live here instead
 * of in `messages/*.json`: they ship with the code that uses them, and a
 * half-translated admin screen can never block the tenant app's i18n
 * parity test. Same two locales as the product (ar / en).
 */

type Entry = { ar: string; en: string };

const D: Record<string, Entry> = {
  // ---------- shell ----------
  appName: { ar: 'ExBolt · لوحة التحكم', en: 'ExBolt · Control Panel' },
  adminBadge: { ar: 'سوبر أدمن', en: 'Super admin' },
  console: { ar: 'منصة التحكم', en: 'Platform console' },
  backToApp: { ar: 'الرجوع للتطبيق', en: 'Back to app' },
  signOut: { ar: 'تسجيل الخروج', en: 'Sign out' },
  openMenu: { ar: 'فتح القائمة', en: 'Open menu' },
  closeMenu: { ar: 'إغلاق القائمة', en: 'Close menu' },
  'nav.overview': { ar: 'نظرة عامة', en: 'Overview' },
  'nav.accounts': { ar: 'الحسابات', en: 'Accounts' },
  'nav.billing': { ar: 'الاشتراكات والفواتير', en: 'Billing & invoices' },
  'nav.channels': { ar: 'القنوات والاتصالات', en: 'Channels' },
  'nav.audit': { ar: 'سجل العمليات', en: 'Audit log' },
  'nav.settings': { ar: 'إعدادات المنصة', en: 'Platform settings' },

  // ---------- common ----------
  save: { ar: 'حفظ', en: 'Save' },
  saving: { ar: 'بيحفظ…', en: 'Saving…' },
  cancel: { ar: 'إلغاء', en: 'Cancel' },
  apply: { ar: 'تطبيق', en: 'Apply' },
  working: { ar: 'لحظة…', en: 'Working…' },
  empty: { ar: 'مفيش بيانات', en: 'Nothing here yet' },
  none: { ar: '—', en: '—' },
  all: { ar: 'الكل', en: 'All' },
  search: { ar: 'بحث', en: 'Search' },
  status: { ar: 'الحالة', en: 'Status' },
  actions: { ar: 'إجراءات', en: 'Actions' },
  amount: { ar: 'المبلغ', en: 'Amount' },
  date: { ar: 'التاريخ', en: 'Date' },
  dueDate: { ar: 'ميعاد السداد', en: 'Due date' },
  created: { ar: 'تاريخ الإنشاء', en: 'Created' },
  viewAll: { ar: 'عرض الكل', en: 'View all' },
  saved: { ar: 'تم الحفظ', en: 'Saved' },
  done: { ar: 'تم', en: 'Done' },
  optional: { ar: 'اختياري', en: 'optional' },
  close: { ar: 'إغلاق', en: 'Close' },
  localeNote: { ar: 'العربية', en: 'English' },

  // ---------- overview ----------
  'overview.title': { ar: 'نظرة عامة على المنصة', en: 'Platform overview' },
  'overview.subtitle': {
    ar: 'الأرقام اللي بتتغير كل يوم: الإيراد، الحسابات، واللي محتاج تدخل.',
    en: 'The numbers that move daily: revenue, tenants, and what needs a decision.',
  },
  'kpi.mrr': { ar: 'الإيراد الشهري المتكرر', en: 'MRR' },
  'kpi.activeAccounts': { ar: 'حسابات نشطة', en: 'Active tenants' },
  'kpi.trialsSoon': {
    ar: 'تجارب بتنتهي خلال ٧ أيام',
    en: 'Trials ending in 7d',
  },
  'kpi.overdue': { ar: 'فواتير متأخرة', en: 'Overdue invoices' },
  'kpi.signups': { ar: 'تسجيلات جديدة', en: 'New sign-ups' },
  'kpi.pastDue': { ar: 'اشتراكات متأخرة', en: 'Past-due subs' },
  'kpi.tokens': { ar: 'توكنات بتنتهي قريب', en: 'Tokens expiring soon' },
  'kpi.of': { ar: 'من {total} حساب', en: 'of {total} tenants' },
  'overview.registration': { ar: 'باب التسجيل', en: 'Registration' },
  'overview.registrationOn': { ar: 'مفتوح', en: 'Open' },
  'overview.registrationOff': { ar: 'مقفول', en: 'Closed' },
  'overview.registrationHint': {
    ar: 'لو مقفول، مفيش حساب جديد يتعمل — حتى لو حد نادى Supabase مباشرة.',
    en: 'When closed, no new account can be created — even by calling Supabase directly.',
  },
  'overview.turnOn': { ar: 'افتح التسجيل', en: 'Open registration' },
  'overview.turnOff': { ar: 'اقفل التسجيل', en: 'Close registration' },
  'overview.recent': { ar: 'أحدث الحسابات', en: 'Newest tenants' },
  'overview.attention': { ar: 'محتاج تدخل', en: 'Needs attention' },
  'overview.noAttention': {
    ar: 'مفيش حاجة متأخرة. تمام.',
    en: 'Nothing overdue. All clear.',
  },
  'attention.pastDue': {
    ar: '{count} اشتراك متأخر الدفع',
    en: '{count} past-due subscription(s)',
  },
  'attention.overdue': {
    ar: '{count} فاتورة متأخرة بقيمة {amount}',
    en: '{count} overdue invoice(s) worth {amount}',
  },
  'attention.trials': {
    ar: '{count} تجربة بتنتهي الأسبوع ده',
    en: '{count} trial(s) ending this week',
  },
  'attention.tokens': {
    ar: '{count} توكن قناة على وش الانتهاء',
    en: '{count} channel token(s) expiring',
  },
  'attention.suspended': {
    ar: '{count} حساب موقوف/محظور',
    en: '{count} suspended or blocked tenant(s)',
  },

  // ---------- accounts ----------
  'accounts.title': { ar: 'الحسابات', en: 'Accounts' },
  'accounts.subtitle': {
    ar: 'كل مستأجر على المنصة: الحالة، الخطة، والاستهلاك.',
    en: 'Every tenant on the platform: status, plan and usage.',
  },
  'accounts.search': {
    ar: 'ابحث بالاسم أو الإيميل…',
    en: 'Search by name or email…',
  },
  'accounts.empty': { ar: 'مفيش حسابات مطابقة', en: 'No matching tenants' },
  'accounts.count': { ar: '{count} حساب', en: '{count} tenant(s)' },
  'col.account': { ar: 'الحساب', en: 'Tenant' },
  'col.owner': { ar: 'المالك', en: 'Owner' },
  'col.plan': { ar: 'الخطة', en: 'Plan' },
  'col.members': { ar: 'أعضاء', en: 'Seats' },
  'col.channels': { ar: 'قنوات', en: 'Channels' },
  'col.messages30': { ar: 'رسائل ٣٠ يوم', en: 'Msgs 30d' },
  'col.lastActivity': { ar: 'آخر نشاط', en: 'Last activity' },

  // ---------- status / subscription vocab ----------
  'status.active': { ar: 'نشط', en: 'Active' },
  'status.suspended': { ar: 'موقوف', en: 'Suspended' },
  'status.archived': { ar: 'مؤرشف', en: 'Archived' },
  'status.banned': { ar: 'محظور', en: 'Blocked' },
  'sub.trial': { ar: 'تجربة', en: 'Trial' },
  'sub.active': { ar: 'مدفوع', en: 'Active' },
  'sub.past_due': { ar: 'متأخر', en: 'Past due' },
  'sub.canceled': { ar: 'ملغي', en: 'Canceled' },
  'sub.suspended': { ar: 'متوقف', en: 'Suspended' },
  'sub.none': { ar: 'بدون اشتراك', en: 'No subscription' },
  'plan.none': { ar: 'بدون خطة', en: 'No plan' },

  // ---------- account detail ----------
  'detail.back': { ar: 'كل الحسابات', en: 'All accounts' },
  'detail.owner': { ar: 'المالك', en: 'Owner' },
  'detail.accountId': { ar: 'معرّف الحساب', en: 'Account ID' },
  'control.title': { ar: 'التحكم في الحساب', en: 'Account controls' },
  'control.desc': {
    ar: 'الوقف/الحظر بيقفل كل مسارات الـ API فورًا. الأرشيف بيخفي الحساب مع الاحتفاظ بالبيانات.',
    en: 'Suspend and block shut every API route immediately. Archive hides the tenant and keeps the data.',
  },
  'control.status': { ar: 'حالة الحساب', en: 'Account status' },
  'control.reason': {
    ar: 'سبب التغيير (هيوصل للعميل)',
    en: 'Reason (shown to the customer)',
  },
  'control.applyStatus': { ar: 'تغيير الحالة', en: 'Change status' },
  'control.plan': { ar: 'الخطة', en: 'Plan' },
  'control.planStatus': { ar: 'حالة الاشتراك', en: 'Subscription status' },
  'control.interval': { ar: 'دورة الفوترة', en: 'Billing interval' },
  'control.monthly': { ar: 'شهري', en: 'Monthly' },
  'control.annual': { ar: 'سنوي', en: 'Annual' },
  'control.periodEnd': { ar: 'نهاية الفترة', en: 'Period end' },
  'control.trialEnd': { ar: 'نهاية التجربة', en: 'Trial ends' },
  'control.applyPlan': { ar: 'تحديث الاشتراك', en: 'Update subscription' },
  'control.notes': { ar: 'ملاحظات داخلية', en: 'Internal notes' },
  'control.notesPlaceholder': {
    ar: 'اتفاق، خصم، سبب استثناء…',
    en: 'Deal terms, discount, exception reason…',
  },
  'control.saveNotes': { ar: 'حفظ الملاحظات', en: 'Save notes' },
  'control.reactivate': { ar: 'تفعيل الحساب', en: 'Reactivate account' },
  'statusHint.active': {
    ar: 'الحساب شغال طبيعي.',
    en: 'The tenant is fully operational.',
  },
  'statusHint.suspended': {
    ar: 'الحساب مقفول مؤقتًا — البيانات محفوظة والرجوع ممكن.',
    en: 'Locked temporarily — data kept, reversible.',
  },
  'statusHint.archived': {
    ar: 'مخفي ومقفول، البيانات محفوظة.',
    en: 'Hidden and locked, data retained.',
  },
  'statusHint.banned': {
    ar: 'حظر نهائي — الوصول متوقف بالكامل.',
    en: 'Permanent block — access disabled.',
  },
  'usage.title': { ar: 'الاستهلاك', en: 'Usage' },
  'usage.contacts': { ar: 'جهات اتصال', en: 'Contacts' },
  'usage.conversations': { ar: 'محادثات', en: 'Conversations' },
  'usage.messages30': { ar: 'رسائل ٣٠ يوم', en: 'Messages 30d' },

  // ---------- grants ----------
  'grants.title': { ar: 'المنح والهدايا', en: 'Grants & gifts' },
  'grants.desc': {
    ar: 'ميزة أو حد زيادة، أو تمديد تجربة/خصم/رصيد — بصلاحية وتاريخ انتهاء.',
    en: 'Extra feature or limit, or a trial extension / discount / credit — with an expiry.',
  },
  'grants.empty': { ar: 'مفيش منح', en: 'No grants' },
  'grants.add': { ar: 'إضافة منحة', en: 'Add grant' },
  'grants.kind': { ar: 'النوع', en: 'Kind' },
  'grants.key': { ar: 'الميزة / الحد', en: 'Feature / limit' },
  'grants.value': { ar: 'القيمة', en: 'Value' },
  'grants.reason': { ar: 'السبب', en: 'Reason' },
  'grants.expires': { ar: 'تنتهي في', en: 'Expires' },
  'grants.revoke': { ar: 'إلغاء', en: 'Revoke' },
  'grants.revoked': { ar: 'ملغاة', en: 'Revoked' },
  'grants.expired': { ar: 'منتهية', en: 'Expired' },
  'grants.permanent': { ar: 'بدون انتهاء', en: 'No expiry' },
  'grant.kind.feature': { ar: 'ميزة', en: 'Feature' },
  'grant.kind.limit': { ar: 'حد رقمي', en: 'Limit' },
  'grant.kind.plan_upgrade': { ar: 'ترقية خطة', en: 'Plan upgrade' },
  'grant.kind.trial_extension': { ar: 'تمديد تجربة', en: 'Trial extension' },
  'grant.kind.discount': { ar: 'خصم', en: 'Discount' },
  'grant.kind.credit': { ar: 'رصيد', en: 'Credit' },

  // ---------- members ----------
  'members.title': { ar: 'المستخدمون', en: 'Users' },
  'members.empty': { ar: 'مفيش مستخدمين', en: 'No users' },
  'members.role': { ar: 'الدور', en: 'Role' },
  'members.block': { ar: 'حظر', en: 'Block' },
  'members.unblock': { ar: 'رفع الحظر', en: 'Unblock' },
  'members.blocked': { ar: 'محظور', en: 'Blocked' },
  'members.blockReason': { ar: 'سبب الحظر', en: 'Block reason' },

  // ---------- invoices ----------
  'invoices.title': { ar: 'الفواتير', en: 'Invoices' },
  'invoices.empty': { ar: 'مفيش فواتير', en: 'No invoices' },
  'invoices.create': { ar: 'فاتورة جديدة', en: 'New invoice' },
  'invoices.number': { ar: 'الرقم', en: 'Number' },
  'invoices.send': { ar: 'إرسال', en: 'Send' },
  'invoices.markPaid': { ar: 'تم السداد', en: 'Mark paid' },
  'invoices.void': { ar: 'إلغاء الفاتورة', en: 'Void' },
  'invoices.reminders': { ar: 'تذكيرات', en: 'Reminders' },
  'invoices.reminded': {
    ar: 'اتبعت {count} تذكير',
    en: '{count} reminder(s) sent',
  },
  'invoices.to': { ar: 'إلى', en: 'To' },
  'invoice.status.draft': { ar: 'مسودة', en: 'Draft' },
  'invoice.status.sent': { ar: 'مرسلة', en: 'Sent' },
  'invoice.status.paid': { ar: 'مدفوعة', en: 'Paid' },
  'invoice.status.overdue': { ar: 'متأخرة', en: 'Overdue' },
  'invoice.status.void': { ar: 'ملغاة', en: 'Void' },
  'invoice.new.title': { ar: 'إنشاء فاتورة', en: 'Create invoice' },
  'invoice.new.description': { ar: 'البند', en: 'Description' },
  'invoice.new.qty': { ar: 'الكمية', en: 'Qty' },
  'invoice.new.unitPrice': { ar: 'سعر الوحدة', en: 'Unit price' },
  'invoice.new.addLine': { ar: 'بند إضافي', en: 'Add line' },
  'invoice.new.tax': { ar: 'ضريبة', en: 'Tax' },
  'invoice.new.notes': { ar: 'ملاحظات', en: 'Notes' },
  'invoice.new.create': { ar: 'إنشاء مسودة', en: 'Create draft' },
  'invoice.new.total': { ar: 'الإجمالي', en: 'Total' },
  'invoice.new.toEmail': { ar: 'إيميل العميل', en: 'Customer email' },
  'invoice.new.periodStart': { ar: 'بداية الخدمة', en: 'Service from' },
  'invoice.new.periodEnd': { ar: 'نهاية الخدمة', en: 'Service to' },

  // ---------- email ----------
  'email.title': { ar: 'مراسلة العميل', en: 'Email the customer' },
  'email.desc': {
    ar: 'إيميل واحد لصاحب الحساب — بيتسجل في سجل الإيميلات بنتيجة الإرسال.',
    en: 'One email to the account owner — logged with its delivery outcome.',
  },
  'email.subject': { ar: 'الموضوع', en: 'Subject' },
  'email.body': { ar: 'النص', en: 'Message' },
  'email.to': { ar: 'إلى', en: 'To' },
  'email.send': { ar: 'إرسال', en: 'Send' },
  'email.sent': { ar: 'اتبعت', en: 'Sent' },
  'email.dryRun': {
    ar: 'SMTP مش مضبوط — الإيميل اتسجل كـ dry run ولم يتبعت.',
    en: 'SMTP is not configured — the email was logged as a dry run, not sent.',
  },
  'email.failed': { ar: 'فشل الإرسال', en: 'Sending failed' },

  // ---------- audit ----------
  'audit.title': { ar: 'سجل العمليات', en: 'Audit log' },
  'audit.subtitle': {
    ar: 'كل إجراء إداري، مين عمله وفيمن — بدون استثناء.',
    en: 'Every privileged action, who did it and to whom — no exceptions.',
  },
  'audit.empty': { ar: 'مفيش عمليات مسجلة', en: 'No actions recorded yet' },
  'audit.actor': { ar: 'المستخدم', en: 'Actor' },
  'audit.action': { ar: 'الإجراء', en: 'Action' },
  'audit.target': { ar: 'الهدف', en: 'Target' },
  'audit.when': { ar: 'الوقت', en: 'When' },
  'audit.details': { ar: 'تفاصيل', en: 'Details' },

  // ---------- channels ----------
  'channels.title': { ar: 'القنوات والاتصالات', en: 'Channels & connections' },
  'channels.subtitle': {
    ar: 'واتساب وفيسبوك وإنستجرام لكل حساب — وحالة التوكن قبل ما ينتهي.',
    en: 'WhatsApp, Messenger and Instagram per tenant — with token health before it expires.',
  },
  'channels.empty': { ar: 'مفيش قنوات متصلة', en: 'No connected channels' },
  'channels.channel': { ar: 'القناة', en: 'Channel' },
  'channels.external': { ar: 'المعرّف', en: 'External ID' },
  'channels.tokenExpires': { ar: 'انتهاء التوكن', en: 'Token expiry' },
  'channels.lastError': { ar: 'آخر خطأ', en: 'Last error' },
  'channels.enable': { ar: 'تفعيل', en: 'Enable' },
  'channels.disable': { ar: 'تعطيل', en: 'Disable' },
  'channels.revoke': { ar: 'فصل التوكن', en: 'Revoke token' },
  'channels.confirmRevoke': {
    ar: 'هيتم حذف التوكن نهائيًا والحساب هيحتاج يعيد الربط. متأكد؟',
    en: 'The stored token is deleted and the tenant must reconnect. Are you sure?',
  },
  'channels.active': { ar: 'متصلة', en: 'Connected' },
  'channels.inactive': { ar: 'مفصولة', en: 'Disconnected' },
  'channel.whatsapp': { ar: 'واتساب', en: 'WhatsApp' },
  'channel.messenger': { ar: 'ماسنجر', en: 'Messenger' },
  'channel.instagram': { ar: 'إنستجرام', en: 'Instagram' },

  // ---------- billing page ----------
  'billing.title': { ar: 'الاشتراكات والفواتير', en: 'Billing & invoices' },
  'billing.subtitle': {
    ar: 'الخطط، الفواتير، والتذكيرات — كل حاجة مالية في مكان واحد.',
    en: 'Plans, invoices and reminders — every money-facing thing in one place.',
  },
  'billing.smtpOn': {
    ar: 'SMTP مضبوط — الإيميلات بتتبعت فعلًا.',
    en: 'SMTP configured — emails are actually sent.',
  },
  'billing.smtpOff': {
    ar: 'SMTP مش مضبوط — أي إيميل بيتسجل dry run ومش بيتبعت. اضبط SMTP_HOST/SMTP_USER/SMTP_PASS على السيرفر.',
    en: 'SMTP is not configured — every email is logged as a dry run and not sent. Set SMTP_HOST/SMTP_USER/SMTP_PASS on the server.',
  },
  'billing.reminders.title': { ar: 'تذكيرات الدفع', en: 'Payment reminders' },
  'billing.reminders.desc': {
    ar: 'قبل الاستحقاق بـ{days} يوم، ويوم الاستحقاق، ثم كل ٣ أيام لحد {grace} يوم، وبعدها تنبيه أخير.',
    en: '{days} days before due, on the due date, then every 3 days until {grace} days, then a final notice.',
  },
  'billing.reminders.run': {
    ar: 'تشغيل التذكيرات دلوقتي',
    en: 'Run reminders now',
  },
  'billing.reminders.result': {
    ar: 'اتبعت {sent} · dry run {dry} · فشل {failed}',
    en: 'sent {sent} · dry run {dry} · failed {failed}',
  },
  'billing.invoices.title': { ar: 'كل الفواتير', en: 'All invoices' },
  'billing.plans.title': { ar: 'كتالوج الخطط', en: 'Plan catalogue' },
  'billing.plans.desc': {
    ar: 'السعر والميزات والحدود بيتقروا من الداتابيز — التعديل هنا بيسري فورًا بدون deploy.',
    en: 'Price, features and limits are read from the database — edits here apply instantly, no deploy.',
  },
  'plan.monthly': { ar: 'شهري', en: 'Monthly' },
  'plan.annual': { ar: 'سنوي', en: 'Annual' },
  'plan.features': { ar: 'الميزات', en: 'Features' },
  'plan.limits': { ar: 'الحدود', en: 'Limits' },
  'plan.subscribers': { ar: '{count} مشترك', en: '{count} subscriber(s)' },
  'plan.active': { ar: 'معروضة', en: 'Published' },
  'plan.save': { ar: 'حفظ الخطة', en: 'Save plan' },
  'plan.limitUnlimited': { ar: 'بلا حد', en: 'unlimited' },

  // ---------- settings ----------
  'settings.title': { ar: 'إعدادات المنصة', en: 'Platform settings' },
  'settings.subtitle': {
    ar: 'التسجيل، الهوية البريدية، سياسة التذكير، والأدمنز.',
    en: 'Registration, mail identity, reminder policy, and admins.',
  },
  'settings.registration.title': { ar: 'التسجيل', en: 'Registration' },
  'settings.registration.desc': {
    ar: 'مفتوح = أي حد يسجّل. بدعوة = الإيميلات المسموحة فقط. مقفول = مفيش تسجيل جديد.',
    en: 'Open = anyone. Invite-only = allow-listed emails only. Closed = no new sign-ups.',
  },
  'settings.signupEnabled': { ar: 'السماح بالتسجيل', en: 'Allow sign-ups' },
  'settings.mode': { ar: 'الوضع', en: 'Mode' },
  'settings.mode.open': { ar: 'مفتوح', en: 'Open' },
  'settings.mode.invite_only': { ar: 'بدعوة فقط', en: 'Invite only' },
  'settings.mode.closed': { ar: 'مقفول', en: 'Closed' },
  'settings.closedMessage': {
    ar: 'رسالة تظهر للزائر',
    en: 'Message shown to visitors',
  },
  'settings.maintenance.title': { ar: 'وضع الصيانة', en: 'Maintenance mode' },
  'settings.maintenance.enabled': {
    ar: 'تفعيل لافتة الصيانة',
    en: 'Show maintenance notice',
  },
  'settings.maintenance.message': { ar: 'نص اللافتة', en: 'Notice text' },
  'settings.mail.title': { ar: 'هوية المراسلة', en: 'Mail identity' },
  'settings.mail.fromName': { ar: 'اسم المرسل', en: 'From name' },
  'settings.mail.fromEmail': { ar: 'إيميل المرسل', en: 'From email' },
  'settings.mail.replyTo': { ar: 'Reply-To', en: 'Reply-To' },
  'settings.mail.support': { ar: 'إيميل الدعم', en: 'Support email' },
  'settings.mail.hint': {
    ar: 'الإرسال الفعلي بيتم عبر SMTP — الإعدادات هنا بتحدد الشكل والعنوان بس.',
    en: 'Delivery goes through SMTP; these settings only control the identity and reply address.',
  },
  'settings.policy.title': {
    ar: 'سياسة التذكير والفوترة',
    en: 'Reminder & billing policy',
  },
  'settings.policy.daysBefore': {
    ar: 'تذكير قبل الاستحقاق (أيام)',
    en: 'Remind before due (days)',
  },
  'settings.policy.grace': {
    ar: 'فترة السماح بعد الاستحقاق (أيام)',
    en: 'Grace after due (days)',
  },
  'settings.policy.currency': { ar: 'العملة', en: 'Currency' },
  'settings.admins.title': { ar: 'أدمنز المنصة', en: 'Platform admins' },
  'settings.admins.desc': {
    ar: 'الأشخاص اللي بيقدروا يفتحوا اللوحة. لازم يكون عندهم حساب مسجّل بالفعل.',
    en: 'People allowed to open this panel. They must already have a signed-up account.',
  },
  'settings.admins.email': { ar: 'إيميل المستخدم', en: 'User email' },
  'settings.admins.note': { ar: 'ملاحظة', en: 'Note' },
  'settings.admins.add': { ar: 'إضافة أدمن', en: 'Add admin' },
  'settings.admins.remove': { ar: 'إزالة', en: 'Remove' },
  'settings.admins.you': { ar: 'أنت', en: 'you' },
  'settings.allowlist.title': {
    ar: 'قائمة المسموح لهم بالتسجيل',
    en: 'Signup allowlist',
  },
  'settings.allowlist.desc': {
    ar: 'بتشتغل لما التسجيل يبقى بدعوة أو مقفول — كل إيميل هنا بيفتح حساب مرة واحدة.',
    en: 'Used while registration is invite-only or closed — each email here opens exactly one account.',
  },
  'settings.allowlist.email': { ar: 'الإيميل', en: 'Email' },
  'settings.allowlist.add': { ar: 'إضافة', en: 'Add' },
  'settings.allowlist.used': { ar: 'مستخدم', en: 'Used' },
  'settings.allowlist.pending': { ar: 'متاح', en: 'Available' },
  'settings.allowlist.empty': { ar: 'القائمة فاضية', en: 'The list is empty' },

  // ---------- errors ----------
  'err.invalid_email': { ar: 'إيميل غير صالح', en: 'Invalid email' },
  'err.invalid_subject': { ar: 'الموضوع مطلوب', en: 'Subject is required' },
  'err.invalid_body': { ar: 'النص مطلوب', en: 'Message is required' },
  'err.invalid_account_not_found': {
    ar: 'الحساب غير موجود',
    en: 'Account not found',
  },
  'err.invalid_plan_not_found': {
    ar: 'الخطة غير موجودة',
    en: 'Plan not found',
  },
  'err.invalid_plan_code': {
    ar: 'كود الخطة غير صالح',
    en: 'Invalid plan code',
  },
  'err.invalid_grant_kind': {
    ar: 'نوع المنحة غير صالح',
    en: 'Invalid grant kind',
  },
  'err.invalid_grant_value': {
    ar: 'قيمة المنحة غير صالحة',
    en: 'Invalid grant value',
  },
  'err.invalid_grant_key_required': {
    ar: 'اختار الميزة أو الحد',
    en: 'Pick a feature or limit',
  },
  'err.invalid_user_not_found': {
    ar: 'المستخدم غير موجود — لازم يكون مسجّل قبل كده',
    en: 'User not found — they must sign up first',
  },
  'err.invalid_last_admin': {
    ar: 'مش ممكن إزالة آخر أدمن',
    en: 'Cannot remove the last admin',
  },
  'err.invalid_cannot_remove_self': {
    ar: 'مش ممكن تشيل نفسك',
    en: 'You cannot remove yourself',
  },
  'err.invalid_user_not_in_account': {
    ar: 'المستخدم مش تابع للحساب ده',
    en: 'That user is not in this account',
  },
  'err.invalid_invoice_not_found': {
    ar: 'الفاتورة غير موجودة',
    en: 'Invoice not found',
  },
  'err.invalid_invoice_missing_email': {
    ar: 'مفيش إيميل للفاتورة',
    en: 'The invoice has no email address',
  },
  'err.invalid_signup_mode': {
    ar: 'وضع التسجيل غير صالح',
    en: 'Invalid signup mode',
  },
  'err.forbidden': { ar: 'مالكش صلاحية', en: 'Not allowed' },
  'err.unauthorized': { ar: 'لازم تسجيل دخول', en: 'Please sign in' },
  'err.smtp_not_configured': {
    ar: 'SMTP مش مضبوط',
    en: 'SMTP is not configured',
  },
  'err.unknown': { ar: 'حصل خطأ غير متوقع', en: 'Something went wrong' },

  // ---------- inquiries ----------
  'nav.inquiries': { ar: 'طلبات الموقع', en: 'Website enquiries' },
  'inquiries.title': { ar: 'طلبات الموقع', en: 'Website enquiries' },
  'inquiries.subtitle': {
    ar: 'كل طلب جاي من لاندينج ExBolt — راجعه وحدّد حالته.',
    en: 'Every lead from the ExBolt landing page — review it and set its status.',
  },
  'inquiries.search': { ar: 'بحث بالاسم أو الإيميل أو الشركة', en: 'Search name, email or company' },
  'inquiries.empty': { ar: 'مفيش طلبات لسه', en: 'No enquiries yet' },
  'inquiries.message': { ar: 'الرسالة', en: 'Message' },
  'inquiries.notes': { ar: 'ملاحظات داخلية', en: 'Internal notes' },
  'inquiries.saveNotes': { ar: 'حفظ الملاحظات', en: 'Save notes' },
  'inquiries.saved': { ar: 'تم الحفظ', en: 'Saved' },
  'inquiries.contact': { ar: 'بيانات التواصل', en: 'Contact' },
  'inquiries.details': { ar: 'التفاصيل', en: 'Details' },
  'inquiries.hide': { ar: 'إخفاء', en: 'Hide' },
  'inquiries.plan': { ar: 'الباقة', en: 'Plan' },
  'inquiries.team': { ar: 'حجم الفريق', en: 'Team size' },
  'inquiries.source': { ar: 'المصدر', en: 'Source' },
  'inquiries.newCount': { ar: 'جديد', en: 'New' },
  'inquiries.open': { ar: 'قيد المتابعة', en: 'In progress' },
  'inquiries.wonCount': { ar: 'تم البيع', en: 'Won' },
  'inquiries.total': { ar: 'إجمالي الطلبات', en: 'Total enquiries' },
  'inquiry.status.new': { ar: 'جديد', en: 'New' },
  'inquiry.status.contacted': { ar: 'تم التواصل', en: 'Contacted' },
  'inquiry.status.qualified': { ar: 'مؤهل', en: 'Qualified' },
  'inquiry.status.won': { ar: 'تم البيع', en: 'Won' },
  'inquiry.status.lost': { ar: 'خسارة', en: 'Lost' },
  'inquiry.status.archived': { ar: 'مؤرشف', en: 'Archived' },

  // ---------- landing page settings ----------
  'nav.landing': { ar: 'اللاندينج والباقات', en: 'Landing & pricing' },
  'landing.title': { ar: 'اللاندينج والباقات', en: 'Landing page & pricing' },
  'landing.subtitle': {
    ar: 'كل اللي العميل بيشوفه في صفحة ExBolt: بيانات التواصل، الأسعار، حدود كل باقة، والمزايا المعروضة.',
    en: 'Everything a visitor sees on the ExBolt page: contact details, prices, plan limits and the features shown.',
  },
  'landing.contactTitle': { ar: 'بيانات التواصل', en: 'Contact details' },
  'landing.contactHint': {
    ar: 'بتظهر في صفحة التواصل والفوتر ورسالة النجاح. الإيميل هو اللي بيستقبل ردود الفريق.',
    en: 'Shown in the contact block, the footer and the success message. This email is what the team replies from.',
  },
  'landing.salesEmail': { ar: 'إيميل المبيعات', en: 'Sales email' },
  'landing.salesPhone': { ar: 'رقم الهاتف', en: 'Phone number' },
  'landing.whatsapp': { ar: 'رقم واتساب', en: 'WhatsApp number' },
  'landing.responseAr': { ar: 'وعد الرد (عربي)', en: 'Response promise (Arabic)' },
  'landing.responseEn': { ar: 'وعد الرد (إنجليزي)', en: 'Response promise (English)' },
  'landing.plansTitle': { ar: 'الباقات المعروضة', en: 'Published plans' },
  'landing.plansHint': {
    ar: 'الأسعار والحدود والمزايا كلها بتتحدّث في اللاندينج فورًا. المزايا اللي مش مفعّلة في الاشتراكات مش هتظهر.',
    en: 'Prices, limits and feature bullets update the landing page immediately. Features disabled in the plan entitlements are hidden.',
  },
  'landing.nameAr': { ar: 'الاسم بالعربي', en: 'Arabic name' },
  'landing.descAr': { ar: 'الوصف بالعربي', en: 'Arabic description' },
  'landing.descEn': { ar: 'الوصف بالإنجليزي', en: 'English description' },
  'landing.monthly': { ar: 'السعر الشهري (USD)', en: 'Monthly price (USD)' },
  'landing.annual': { ar: 'السعر السنوي (USD)', en: 'Annual price (USD)' },
  'landing.featured': { ar: 'الباقة المميزة', en: 'Featured plan' },
  'landing.active': { ar: 'معروضة على اللاندينج', en: 'Show on landing' },
  'landing.limits': { ar: 'حدود الباقة', en: 'Plan limits' },
  'landing.channels': { ar: 'القنوات', en: 'Channels' },
  'landing.users': { ar: 'المستخدمون', en: 'Users' },
  'landing.messages': { ar: 'رسائل الحملات / شهر', en: 'Campaign messages / month' },
  'landing.agents': { ar: 'وكلاء AI', en: 'AI agents' },
  'landing.unlimited': { ar: 'فاضي = بلا حد', en: 'blank = unlimited' },
  'landing.features': { ar: 'المزايا المعروضة', en: 'Feature bullets' },
  'landing.featuresHint': {
    ar: 'اختار اللي يظهر في كارت الباقة. الترتيب ثابت.',
    en: 'Pick what appears on the plan card. Order is fixed.',
  },
  'landing.selected': { ar: '{count} مختارة', en: '{count} selected' },
  'landing.save': { ar: 'حفظ إعدادات اللاندينج', en: 'Save landing settings' },
  'landing.saving': { ar: 'بيحفظ…', en: 'Saving…' },
  'landing.saved': { ar: 'تم حفظ اللاندينج', en: 'Landing settings saved' },
  'landing.billingLink': { ar: 'تعديل الاشتراكات والفواتير', en: 'Billing & subscriptions' },

  // ---------- tenant plan requests ----------
  'nav.requests': { ar: 'طلبات العملاء', en: 'Customer requests' },
  'requests.title': { ar: 'طلبات العملاء', en: 'Customer requests' },
  'requests.subtitle': {
    ar: 'طلبات تجديد أو تغيير الباقة الجاية من صفحة الباقة عند العميل. راجعها وحدّد حالتها.',
    en: 'Renewal and plan-change requests submitted from the tenant plan page. Review and triage them here.',
  },
  'requests.search': { ar: 'بحث بالحساب أو الإيميل', en: 'Search account or email' },
  'requests.empty': { ar: 'مفيش طلبات لسه', en: 'No requests yet' },
  'requests.account': { ar: 'الحساب', en: 'Account' },
  'requests.requester': { ar: 'مقدّم الطلب', en: 'Requested by' },
  'requests.type': { ar: 'النوع', en: 'Type' },
  'requests.plan': { ar: 'الباقة', en: 'Plan' },
  'requests.interval': { ar: 'الفوترة', en: 'Billing' },
  'requests.message': { ar: 'رسالة العميل', en: 'Customer message' },
  'requests.notes': { ar: 'ملاحظات داخلية', en: 'Internal notes' },
  'requests.saveNotes': { ar: 'حفظ الملاحظات', en: 'Save notes' },
  'requests.saved': { ar: 'تم الحفظ', en: 'Saved' },
  'requests.details': { ar: 'التفاصيل', en: 'Details' },
  'requests.hide': { ar: 'إخفاء', en: 'Hide' },
  'request.kind.renewal': { ar: 'تجديد', en: 'Renewal' },
  'request.kind.change_plan': { ar: 'تغيير باقة', en: 'Plan change' },
  'request.status.new': { ar: 'جديد', en: 'New' },
  'request.status.in_review': { ar: 'تحت المراجعة', en: 'In review' },
  'request.status.done': { ar: 'اتنفذ', en: 'Done' },
  'request.status.declined': { ar: 'مرفوض', en: 'Declined' },
};

export type AdminLocale = 'ar' | 'en';

export function toAdminLocale(locale: string | undefined | null): AdminLocale {
  return locale === 'ar' ? 'ar' : 'en';
}

export function adminT(locale: string | undefined | null) {
  const lang = toAdminLocale(locale);
  return (key: string, vars?: Record<string, string | number>): string => {
    const entry = D[key];
    let out = entry ? entry[lang] : key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        out = out.split(`{${name}}`).join(String(value));
      }
    }
    return out;
  };
}

/** Human-readable error for a request failure, in the panel's language. */
export function adminErrorText(
  locale: string | undefined | null,
  err: unknown
): string {
  const t = adminT(locale);
  const code = err instanceof Error ? err.message : 'unknown';
  return D[`err.${code}`] ? t(`err.${code}`) : t('err.unknown');
}
