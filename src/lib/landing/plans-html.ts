// ============================================================
// Landing — the plan cards, rendered from the database.
//
// The marketing page is static HTML (`public/landing/*.html`, served by a
// rewrite), which meant every price, feature or limit change was a hand edit in
// two files plus a deploy — and the plan cards drifted from `plans` the moment
// anyone touched packaging in the DB. This module renders the same markup
// (same classes, same icon) from `getLandingContent`, and the route in
// `/api/landing/[locale]` splices it into the static page at request time.
//
// The static markup stays the source of *design*: if a card needs a new element,
// it goes here once and both locales get it.
// ============================================================

import { escapeHtml } from '@/lib/billing/invoice-document';
import type { LandingLocale, LandingPlan } from './content';

const CHECK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 12.5 5 5L20 6.5"/></svg>';

const COPY = {
  ar: {
    monthly: '/ شهري',
    annualSuffix: (price: string) => `$${price} / سنوي — شهرين مجانًا`,
    start: (name: string) => `ابدأ بـ ${name}`,
    talk: (name: string) => `كلّمنا عن ${name}`,
  },
  en: {
    monthly: '/ month',
    annualSuffix: (price: string) => `$${price} / year — two months free`,
    start: (name: string) => `Start with ${name}`,
    talk: (name: string) => `Talk to us about ${name}`,
  },
} as const;

function list(items: string[], className: string): string {
  if (items.length === 0) return '';
  return `<ul class="${className}">${items
    .map((item) => `<li>${CHECK_ICON}${escapeHtml(item)}</li>`)
    .join('')}</ul>`;
}

export function renderPlanCard(plan: LandingPlan, locale: LandingLocale): string {
  const copy = COPY[locale];
  // Raw digits, no thousands separator: the card's own script reads these
  // attributes back and swaps them, and "1,419" is not a number there.
  const monthly = String(Math.round(plan.priceMonthly));
  const annual = plan.priceAnnual === null ? null : String(Math.round(plan.priceAnnual));

  const attrs = [
    `class="price-card${plan.featured ? ' featured' : ''}"`,
    plan.featured ? `data-badge="${escapeHtml(plan.badge)}"` : '',
    `data-code="${escapeHtml(plan.code)}"`,
  ]
    .filter(Boolean)
    .join(' ');

  // The two cards differ only in emphasis and CTA; a single renderer keeps the
  // "featured" treatment from being re-invented per plan.
  const ctaLabel =
    plan.code === 'scale' ? copy.talk(plan.name) : copy.start(plan.name);
  const cta = `<a class="btn ${plan.code === 'scale' ? 'btn-ghost' : plan.featured ? 'btn-primary' : 'btn-ghost'}" href="#contact" data-plan="${escapeHtml(plan.code)}">${escapeHtml(ctaLabel)}</a>`;

  return `<article ${attrs}>
          <div class="price-name">${escapeHtml(plan.name)}</div>
          ${plan.subtitle ? `<div class="price-name-ar">${escapeHtml(plan.subtitle)}</div>` : ''}
          <div class="price-line">
            <span class="price-amount" data-m="${monthly}" data-a="${annual ?? monthly}">${monthly}</span>
            <span class="price-period" data-m="${copy.monthly}" data-a="${copy.monthly}">${copy.monthly}</span>
          </div>
          ${annual ? `<div class="price-annual">${escapeHtml(copy.annualSuffix(annual))}</div>` : ''}
          <p class="price-desc">${escapeHtml(plan.description)}</p>
          ${list(plan.limits, 'price-limits')}
          ${list(plan.features, 'price-features')}
          ${cta}
        </article>`;
}

export function renderPricingGrid(plans: LandingPlan[], locale: LandingLocale): string {
  return plans.map((plan) => renderPlanCard(plan, locale)).join('');
}

/**
 * Splice the rendered cards into a static page.
 *
 * Anchored on the existing markup: the grid opens with `class="pricing-grid`
 * and the block right before the `pricing-note` paragraph is its end. If either
 * anchor is missing (someone redesigns the section), the page is returned
 * untouched rather than half-replaced.
 */
export function injectPlanCards(
  html: string,
  cards: string,
): { html: string; injected: boolean } {
  const open = html.indexOf('<div class="pricing-grid');
  if (open === -1) return { html, injected: false };

  const note = html.indexOf('<p class="pricing-note"', open);
  const searchEnd = note === -1 ? html.length : note;
  const close = html.lastIndexOf('</div>', searchEnd);
  if (close === -1 || close <= open) return { html, injected: false };

  // Keep the grid's own attributes (they carry the reveal animation + spacing).
  const openTagEnd = html.indexOf('>', open);
  const openTag = html.slice(open, openTagEnd + 1);

  return {
    html: `${html.slice(0, open)}${openTag}${cards}${html.slice(close)}`,
    injected: true,
  };
}
