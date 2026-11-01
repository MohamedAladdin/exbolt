import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { WALLPAPER_IDS } from './chat-wallpaper';

/**
 * Contrast guard for the inbox chat palette.
 *
 * The complaint that started this ("التباين مش كويس في لوحة الدردشة") was not a
 * missing token — it was a *choice*: bubbles were painted with `--primary`
 * (an accent meant to be noticed) and their timestamp with
 * `primary-foreground/70`, which composites to 3.8:1 on emerald — below AA for
 * 10px type. Fixing it once is easy; the value of this file is that it cannot
 * silently regress, in any accent, in either mode, without a test going red.
 *
 * It reads the real `globals.css` rather than a copy of the numbers, so this
 * test fails if someone edits a token instead of only if they edit a fixture.
 */

const CSS_PATH = join(process.cwd(), 'src/app/globals.css');
const CSS = readFileSync(CSS_PATH, 'utf8');

interface CssBlock {
  selectors: string[];
  decls: Record<string, string>;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseBlocks(source: string): CssBlock[] {
  const blocks: CssBlock[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const selectors = match[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const decls: Record<string, string> = {};
    for (const decl of stripComments(match[2]).split(';')) {
      const idx = decl.indexOf(':');
      if (idx === -1) continue;
      const name = decl.slice(0, idx).trim();
      if (!name.startsWith('--')) continue;
      decls[name] = decl.slice(idx + 1).trim();
    }
    blocks.push({ selectors, decls });
  }
  return blocks;
}

// Comments are stripped before parsing: a `/* … */` header above a rule
// otherwise ends up glued to the selector list and the rule is invisible to
// every lookup here (which is exactly how `plain` slipped past the first run
// of this file).
const BLOCKS = parseBlocks(stripComments(CSS));

function blockFor(selector: string): CssBlock {
  const found = BLOCKS.find((b) => b.selectors.includes(selector));
  if (!found) throw new Error(`no CSS block for ${selector}`);
  return found;
}

function readVar(selector: string, name: string): string {
  const value = blockFor(selector).decls[name];
  if (!value) throw new Error(`${selector} does not declare ${name}`);
  return value;
}

/** Every accent block (they are the ones that declare `--chat-h`). */
const ACCENTS = BLOCKS.filter((b) => '--chat-h' in b.decls).map((b) => ({
  selector: b.selectors.find((s) => s.startsWith('html[data-theme="'))!,
  hue: Number(b.decls['--chat-h']),
}));

interface Oklch {
  l: number;
  c: number;
  h: number;
}

function parseOklch(value: string, accentHue: number): Oklch {
  const match =
    /oklch\(\s*([\d.]+)\s+([\d.]+)\s+(var\(--chat-h,\s*[\d.]+\)|[\d.]+)\s*\)/.exec(
      value
    );
  if (!match) throw new Error(`not an oklch() token: ${value}`);
  const hue = match[3].startsWith('var(') ? accentHue : Number(match[3]);
  return { l: Number(match[1]), c: Number(match[2]), h: hue };
}

/** OKLCH → linear sRGB, clamped to the displayable gamut. */
function toLinearRgb({ l: L, c: C, h: H }: Oklch): [number, number, number] {
  const rad = (H * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
}

/** WCAG relative luminance. */
function luminance(color: Oklch): number {
  const [r, g, b] = toLinearRgb(color);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1:1 … 21:1. */
function contrast(a: Oklch, b: Oklch): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const MODES = ['html[data-mode="dark"]', 'html[data-mode="light"]'] as const;

/** AA for body text (and for the 10px meta line: small text, 4.5 floor). */
const TEXT_MIN = 4.5;
/** AA for non-text graphics (status ticks, the failed-send glyph). */
const GLYPH_MIN = 3;

describe('chat bubble contrast (all accents × both modes)', () => {
  it('finds every accent block', () => {
    expect(ACCENTS.map((a) => a.selector)).toEqual([
      'html[data-theme="violet"]',
      'html[data-theme="emerald"]',
      'html[data-theme="cobalt"]',
      'html[data-theme="amber"]',
      'html[data-theme="rose"]',
    ]);
  });

  for (const mode of MODES) {
    for (const accent of ACCENTS) {
      const label = `${accent.selector.replace('html[data-theme="', '').replace('"]', '')} · ${mode.replace('html[data-mode="', '').replace('"]', '')}`;

      it(`body text reads on both bubbles (${label})`, () => {
        const out = parseOklch(readVar(mode, '--chat-out'), accent.hue);
        const outFg = parseOklch(
          readVar(mode, '--chat-out-foreground'),
          accent.hue
        );
        const inbound = parseOklch(readVar(mode, '--chat-in'), accent.hue);
        const inFg = parseOklch(
          readVar(mode, '--chat-in-foreground'),
          accent.hue
        );

        expect(contrast(out, outFg)).toBeGreaterThanOrEqual(TEXT_MIN);
        expect(contrast(inbound, inFg)).toBeGreaterThanOrEqual(TEXT_MIN);
      });

      it(`timestamps and badges read on both bubbles (${label})`, () => {
        const out = parseOklch(readVar(mode, '--chat-out'), accent.hue);
        const outMeta = parseOklch(
          readVar(mode, '--chat-out-meta'),
          accent.hue
        );
        const inbound = parseOklch(readVar(mode, '--chat-in'), accent.hue);
        const inMeta = parseOklch(readVar(mode, '--chat-in-meta'), accent.hue);

        // These are the 10–11px lines (time, forwarded, edited, footer). The
        // old `primary-foreground/70` scored 3.81:1 here — the actual defect.
        expect(contrast(out, outMeta)).toBeGreaterThanOrEqual(TEXT_MIN);
        expect(contrast(inbound, inMeta)).toBeGreaterThanOrEqual(TEXT_MIN);
      });

      it(`status glyphs stay distinguishable (${label})`, () => {
        const out = parseOklch(readVar(mode, '--chat-out'), accent.hue);
        const tick = parseOklch(readVar(mode, '--chat-tick'), accent.hue);
        const danger = parseOklch(readVar(mode, '--chat-danger'), accent.hue);

        expect(contrast(out, tick)).toBeGreaterThanOrEqual(GLYPH_MIN);
        expect(contrast(out, danger)).toBeGreaterThanOrEqual(GLYPH_MIN);
      });

      it(`each bubble separates from the canvas (${label})`, () => {
        const canvas = parseOklch(readVar(mode, '--chat-canvas'), accent.hue);
        const out = parseOklch(readVar(mode, '--chat-out'), accent.hue);
        const inbound = parseOklch(readVar(mode, '--chat-in'), accent.hue);

        // Not a WCAG rule (a bubble is not text) — a smoke test that the fill
        // sits on the correct side of the canvas. A pale-lavender bubble on a
        // pale-lavender canvas is the failure mode this pins down.
        if (mode === 'html[data-mode="light"]') {
          expect(out.l).toBeLessThan(canvas.l);
          expect(inbound.l).toBeGreaterThan(canvas.l);
        } else {
          expect(out.l).toBeGreaterThan(canvas.l);
          expect(inbound.l).toBeGreaterThan(canvas.l);
        }
      });
    }
  }
});

describe('chat wallpaper CSS coverage', () => {
  it('declares a canvas override per preset in both modes', () => {
    for (const id of WALLPAPER_IDS) {
      // `doodle` is the default canvas plus the SVG tile; every other preset
      // repaints `--chat-canvas` for its own mode.
      if (id === 'doodle') continue;
      for (const mode of ['dark', 'light'] as const) {
        const selector = `html[data-mode="${mode}"] .chat-surface[data-chat-wallpaper="${id}"]`;
        const block = BLOCKS.find((b) => b.selectors.includes(selector));
        expect(block, `missing ${selector}`).toBeTruthy();
        expect(block!.decls['--chat-canvas']).toMatch(/^oklch\(/);
      }
    }
  });

  it('paints the doodle tile only for the doodle preset', () => {
    expect(CSS).toContain('.chat-surface[data-chat-wallpaper="doodle"]');
    expect(CSS).toMatch(/background-image:\s*url\("\/inbox-doodle\.svg"\)/);
  });
});
