/**
 * Shared vocabulary for the landing-page plan cards. Kept free of server
 * imports so both the public read model and the admin editor can use it.
 */

export const MARKETING_FEATURES = [
  'inbox',
  'contacts',
  'pipelines',
  'broadcasts',
  'automations',
  'ai_suggest',
  'ai_agent',
  'ai_knowledge',
  'flows',
  'reports',
  'reports_advanced',
  'exports',
  'multi_channel',
  'integrations',
  'api',
  'webhooks',
  'team_roles',
  'branches',
  'audit_log',
  'support_priority',
  'training',
] as const;

export type MarketingFeature = (typeof MARKETING_FEATURES)[number];

export const FEATURE_LABELS: Record<string, { ar: string; en: string }> = {
  inbox: { ar: 'صندوق وارد موحّد', en: 'Shared inbox' },
  contacts: { ar: 'جهات اتصال ووسوم', en: 'Contacts and tags' },
  pipelines: { ar: 'مسارات بيع', en: 'Sales pipelines' },
  broadcasts: { ar: 'حملات واتساب', en: 'WhatsApp campaigns' },
  automations: { ar: 'أتمتة', en: 'Automation' },
  ai_suggest: { ar: 'ردود AI مقترحة', en: 'AI reply suggestions' },
  ai_agent: { ar: 'وكلاء AI', en: 'AI agents' },
  ai_knowledge: { ar: 'قاعدة معرفة', en: 'Knowledge base' },
  flows: { ar: 'تدفقات بصرية', en: 'Visual flows' },
  reports: { ar: 'تقارير أساسية', en: 'Core reporting' },
  reports_advanced: { ar: 'تقارير متقدمة', en: 'Advanced reporting' },
  exports: { ar: 'تصدير البيانات', en: 'Data export' },
  multi_channel: { ar: 'ماسنجر وإنستجرام', en: 'Messenger and Instagram' },
  integrations: { ar: 'تكاملات', en: 'Integrations' },
  api: { ar: 'API', en: 'API access' },
  webhooks: { ar: 'Webhooks', en: 'Webhooks' },
  team_roles: { ar: 'أدوار الفريق', en: 'Team roles' },
  branches: { ar: 'إدارة الفروع', en: 'Branch management' },
  audit_log: { ar: 'سجل تدقيق', en: 'Audit log' },
  support_priority: { ar: 'أولوية دعم', en: 'Priority support' },
  training: { ar: 'تدريب للفريق', en: 'Team training' },
};

/** Labels that are not entitlement codes (services, not product switches). */
export const MARKETING_ONLY = new Set(['support_priority', 'training']);
