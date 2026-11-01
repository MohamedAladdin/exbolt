import { describe, expect, it } from 'vitest';

import type { LandingPlan } from './content';
import { injectPlanCards, renderPlanCard, renderPricingGrid } from './plans-html';

const PLAN: LandingPlan = {
  code: 'growth',
  name: 'Growth',
  subtitle: 'النمو',
  description: 'لفريق مبيعات ودعم شغال على أكتر من قناة.',
  priceMonthly: 129,
  priceAnnual: 1419,
  featured: true,
  badge: 'الأكثر اختيارًا',
  limits: ['4 قنوات', 'تقارير سنة كاملة', '50 تقرير محفوظ'],
  features: ['كل مزايا Core', 'تقارير مخصصة: مقارنة بالفترة السابقة، جدولة بالإيميل، تنبيهات، تحليل AI'],
};

describe('renderPlanCard', () => {
  it('renders the same structure the static page expects', () => {
    const html = renderPlanCard(PLAN, 'ar');
    expect(html).toContain('class="price-card featured"');
    expect(html).toContain('data-code="growth"');
    expect(html).toContain('data-m="129"');
    expect(html).toContain('data-a="1419"');
    // attributes carry raw digits so the card script can read them
    expect(html).not.toContain('data-a="1,419"');
    expect(html).toContain('href="#contact" data-plan="growth"');
    expect(html).toContain('ابدأ بـ Growth');
  });

  it('prints the report limits and capabilities as bullets', () => {
    const html = renderPlanCard(PLAN, 'ar');
    expect(html).toContain('تقارير سنة كاملة');
    expect(html).toContain('50 تقرير محفوظ');
    expect(html).toContain('جدولة بالإيميل');
  });

  it('gives the top plan a "talk to us" CTA and English copy', () => {
    const html = renderPlanCard({ ...PLAN, code: 'scale', name: 'Scale', featured: false }, 'en');
    expect(html).toContain('Talk to us about Scale');
    expect(html).toContain('/ month');
    expect(html).toContain('two months free');
  });

  it('escapes a plan name/description that came from the admin panel', () => {
    const html = renderPlanCard({ ...PLAN, name: '<img src=x>', description: 'a & b' }, 'en');
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).toContain('a &amp; b');
  });
});

describe('injectPlanCards', () => {
  const page = `<!doctype html><body>
    <div class="pricing-grid reveal" style="margin-top:42px">
      <article class="price-card" data-code="core">old</article>
    </div>
    <p class="pricing-note">note</p>
  </body>`;

  it('replaces the grid contents and keeps its attributes', () => {
    const { html, injected } = injectPlanCards(page, '<article>new</article>');
    expect(injected).toBe(true);
    expect(html).toContain('<div class="pricing-grid reveal" style="margin-top:42px"><article>new</article></div>');
    expect(html).not.toContain('data-code="core"');
    expect(html).toContain('<p class="pricing-note">note</p>');
  });

  it('returns the page untouched when the anchors moved', () => {
    const moved = '<html><body><section class="plans">x</section></body></html>';
    expect(injectPlanCards(moved, 'cards')).toEqual({ html: moved, injected: false });
  });

  it('renders one card per plan in order', () => {
    const grid = renderPricingGrid([PLAN, { ...PLAN, code: 'scale', name: 'Scale', subtitle: null }], 'ar');
    expect(grid.indexOf('Growth')).toBeLessThan(grid.indexOf('Scale'));
    expect(grid.match(/<article /g)).toHaveLength(2);
  });
});
