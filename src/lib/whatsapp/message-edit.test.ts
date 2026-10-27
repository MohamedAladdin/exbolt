import { describe, expect, it } from 'vitest';

import {
  EDIT_TEXT_MAX,
  buildCorrectionText,
  editModeFor,
  isEdited,
  normalizeEditText,
} from './message-edit';

const base = {
  sender_type: 'agent' as const,
  status: 'delivered' as const,
  content_type: 'text' as const,
};

describe('editModeFor', () => {
  it('replaces a failed text send in place — nothing was delivered', () => {
    expect(editModeFor({ ...base, status: 'failed' })).toBe('in_place');
  });

  it('corrects anything the customer already received', () => {
    expect(editModeFor(base)).toBe('correction');
    expect(editModeFor({ ...base, status: 'sent' })).toBe('correction');
    expect(editModeFor({ ...base, status: 'read' })).toBe('correction');
  });

  it('correction is the only path for a failed media send', () => {
    expect(
      editModeFor({ ...base, status: 'failed', content_type: 'image' })
    ).toBe('correction');
  });

  it('refuses to touch an inbound message', () => {
    expect(editModeFor({ ...base, sender_type: 'customer' })).toBe('blocked');
  });
});

describe('normalizeEditText', () => {
  it('trims and keeps the body', () => {
    expect(normalizeEditText('  hello  ')).toEqual({ text: 'hello' });
  });

  it('rejects empty and whitespace-only input', () => {
    expect(normalizeEditText('   ')).toEqual({ text: null, reason: 'empty' });
    expect(normalizeEditText(undefined)).toEqual({ text: null, reason: 'empty' });
  });

  it('enforces the 4096-char cap', () => {
    expect(normalizeEditText('x'.repeat(EDIT_TEXT_MAX)).text).toHaveLength(
      EDIT_TEXT_MAX
    );
    expect(normalizeEditText('x'.repeat(EDIT_TEXT_MAX + 1))).toEqual({
      text: null,
      reason: 'too_long',
    });
  });
});

describe('buildCorrectionText', () => {
  it('prefixes in Arabic for the Arabic UI', () => {
    expect(buildCorrectionText('السعر 200', 'ar')).toBe(
      'تصحيح لما سبق: السعر 200'
    );
  });

  it('prefixes in English otherwise', () => {
    expect(buildCorrectionText('price is 200', 'en')).toBe(
      'Correction: price is 200'
    );
  });

  it('never exceeds the Meta text cap', () => {
    expect(buildCorrectionText('x'.repeat(5000), 'en')).toHaveLength(
      EDIT_TEXT_MAX
    );
  });
});

describe('isEdited', () => {
  it('is true when either marker is present', () => {
    expect(isEdited({})).toBe(false);
    expect(isEdited({ edited_at: null })).toBe(false);
    expect(isEdited({ edited_at: '2026-01-01T00:00:00Z' })).toBe(true);
    expect(isEdited({ correction_message_id: 'abc' })).toBe(true);
  });
});
