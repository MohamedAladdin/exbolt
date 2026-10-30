import { describe, expect, it } from 'vitest';

import { errorSlug } from './error-labels';

describe('errorSlug', () => {
  it('maps the codes seen in the failed-messages list', () => {
    expect(errorSlug(131047)).toBe('reengagement');
    expect(errorSlug(131026)).toBe('undeliverable');
    expect(errorSlug(132000)).toBe('templateParams');
    expect(errorSlug(132015)).toBe('templatePaused');
    expect(errorSlug(130429)).toBe('rateLimited');
    expect(errorSlug(190)).toBe('tokenExpired');
  });

  it('accepts the code as a string from PostgREST', () => {
    expect(errorSlug('131047')).toBe('reengagement');
  });

  it('falls back to Meta’s English title when the code is missing', () => {
    expect(errorSlug(null, 'Re-engagement message')).toBe('reengagement');
    expect(errorSlug(undefined, 'Message undeliverable')).toBe('undeliverable');
    expect(errorSlug(null, 'Template is paused due to low quality')).toBe(
      'templatePaused',
    );
  });

  it('prefers the numeric code over contradictory text', () => {
    expect(errorSlug(131047, 'Undeliverable')).toBe('reengagement');
  });

  it('returns null for an unknown failure so the UI keeps Meta’s wording', () => {
    expect(errorSlug(999999, 'Something new')).toBeNull();
    expect(errorSlug(null, null, undefined)).toBeNull();
  });
});
