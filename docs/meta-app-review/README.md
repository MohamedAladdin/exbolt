# Meta App Review — ExBolt (App ID 2150346905908192)

Everything below is for the **ExBolt** Meta app. Submission language is English
(Meta reviews in English); the operating steps are in Arabic because that is the
dashboard language on this account.

Files in this folder:

| File | What it is |
|---|---|
| `permission-justifications.md` | Ready-to-paste English text for each permission |
| `screencast-script.md` | Shot list + English narration for the review video |
| `business-verification.md` | What Business Verification needs, and in what order |
| `README.md` (this file) | The order of operations and the exact dashboard steps |

---

## 0. What the review is actually deciding

While the app is in **Development Mode**, Meta delivers Page/Instagram webhooks
and grants permissions **only to people who hold a role on the app**
(admin / developer / tester). Proven on this deployment on 2026-10-27:

- A message from a non-role account reached the Page inbox (Meta's own
  `/conversations` shows it) but produced **no POST** to our webhook.
- The same message from an app admin produced `200` on
  `/api/webhooks/meta` and a new `messenger` conversation within seconds.

So the goal of App Review is **Advanced Access** for the messaging permissions.
Publishing to Live mode alone does not lift the role restriction.

## 1. What already exists (do not redo)

- `https://bolt.excal.uk/privacy` → 200, Arabic + English
- `https://bolt.excal.uk/data-deletion` → 200
- Webhook endpoint `https://bolt.excal.uk/api/webhooks/meta`, app-level
  subscriptions active for `page`, `instagram` and `whatsapp_business_account`
- Embedded Signup configuration `1464402625665159`
- Self-service connect flow live on the `feat/meta-connect` branch

## 2. Order of operations

1. **App Settings → Basic** (10 min): icon, category, privacy URL, data-deletion
   URL, app domains, contact email. Without the two URLs the Publish screen
   stays blocked.
2. **Business Verification** (2–10 business days, his documents): start it
   *first* because the review clock cannot finish before it.
3. **Screencast** (15 min): record the flow with the script, upload unlisted to
   YouTube/Drive, copy the link.
4. **App Review → Permissions and features** (20 min): request each permission,
   paste its justification, attach the screencast link.
5. **Publish** after approvals.

## 3. الخطوات في اللوحة (بالعربي)

### ٣.١ إعدادات التطبيق الأساسية
`developers.facebook.com` → تطبيق **ExBolt** → **«إعدادات» → «أساسي»**:

| الخانة | القيمة |
|---|---|
| **Privacy Policy URL** | `https://bolt.excal.uk/privacy` |
| **User data deletion** | `https://bolt.excal.uk/data-deletion` |
| **App Domains** | `bolt.excal.uk` |
| **Category** | Business and pages (أو Productivity) |
| **App Icon** | 1024×1024 PNG |
| **Contact email** | `info@excal.uk` |

اضغط **«حفظ التغييرات»**.

### ٣.٢ التحقق من النشاط التجاري
`business.facebook.com` → **إعدادات النشاط التجاري** → **«مركز الأمان»** →
**«التحقق من النشاط التجاري»** → ابدأ التحقق، وارفع:
- السجل التجاري (أو البطاقة الضريبية)
- اسم الشركة القانوني وعنوانها ورقم الهاتف
- دومين `excal.uk` (ملكية الدومين تُثبت تلقائيًا عبر بريد على نفس الدومين)

### ٣.٣ التصوير (السكريبت في `screencast-script.md`)
- سجّل الشاشة كاملة **مع شريط العنوان** (المُراجع لازم يشوف `bolt.excal.uk`)
- اللغة: إنجليزي في التعليق الصوتي، والواجهة عربي أو إنجليزي مش مهم
- المدة: ٣–٥ دقايق
- ارفعه **Unlisted** على يوتيوب أو Google Drive وحط اللينك في الطلب

### ٣.٤ طلب الصلاحيات
**«المراجعة» → «الأذونات والميزات»** (App Review → Permissions and features):
لكل صلاحية من الجدول تحت → **«طلب الوصول المتقدم»** → الصق النص من
`permission-justifications.md` → حط رابط الفيديو → إرسال.

| الصلاحية | الاستخدام عندنا |
|---|---|
| `pages_show_list` | عرض صفحات العميل ليختار اللي يربطها |
| `pages_messaging` | استقبال والرد على رسائل ماسنجر |
| `pages_manage_metadata` | اشتراك الصفحة في الويب هوك |
| `instagram_basic` | هوية حساب إنستجرام المرتبط |
| `instagram_manage_messages` | استقبال والرد على رسائل إنستجرام |
| `business_management` | ربط الأصول بالمساحة الصحيحة |
| `whatsapp_business_management` | الـEmbedded Signup وإدارة الرقم |
| `whatsapp_business_messaging` | إرسال واستقبال واتساب |

### ٣.٥ بعد الموافقة
- **«نشر»** التطبيق من نفس صفحة النشر
- أي صلاحية تُرفض: تُراجع الملاحظة، تصلح الفيديو/النص، تعيد التقديم — الرفض مش نهائي

## 4. Before submitting — run these (from any machine)

```bash
for p in /privacy /data-deletion /login; do
  printf '%-16s ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "https://bolt.excal.uk$p"
done
curl -s "https://graph.facebook.com/v23.0/2150346905908192/subscriptions?access_token=<APP_ID>|<APP_SECRET>" | head -c 400
```
Expect `200` for the three pages and three active subscriptions
(`page`, `instagram`, `whatsapp_business_account`).
