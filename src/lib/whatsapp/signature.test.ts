import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  DEFAULT_SIGNATURE_TEMPLATE,
  MAX_SIGNATURE_TEMPLATE_LENGTH,
  MAX_TEXT_LENGTH,
  appendSignature,
  renderSignature,
  signOutgoingText,
} from './signature';

// ---------------------------------------------------------------
// The two pure pieces: what the template renders to, and how it is
// attached. Everything here is the contract the settings screen and the
// three send paths share.
// ---------------------------------------------------------------

describe('renderSignature', () => {
  it('renders the default template as the sender’s own name', () => {
    expect(
      renderSignature(DEFAULT_SIGNATURE_TEMPLATE, { agentName: 'منى' })
    ).toBe('منى');
  });

  it('fills both placeholders and keeps deliberate line breaks', () => {
    expect(
      renderSignature('{{ agent_name }}\n{{ business_name }}', {
        agentName: 'منى',
        businessName: 'عيادة هيموكيور',
      })
    ).toBe('منى\nعيادة هيموكيور');
  });

  it('drops the blank line a placeholder leaves when it resolves empty', () => {
    // No teammate (a public-API send) and no account name: the signature
    // must collapse to nothing rather than to a line of whitespace.
    expect(renderSignature('{{ agent_name }}', {})).toBe('');
    expect(renderSignature('شكرًا\n{{ agent_name }}', {})).toBe('شكرًا');
  });

  it('falls back to the account name so a signature never ends with nothing', () => {
    expect(
      renderSignature('{{ agent_name }}', { businessName: 'هيموكيور' })
    ).toBe('هيموكيور');
  });

  it('ignores unknown placeholders instead of throwing them at the customer', () => {
    expect(
      renderSignature('{{ agent_name }} · {{ nope }}', { agentName: 'منى' })
    ).toBe('منى · {{ nope }}');
  });

  it('tolerates spacing and case variations of a placeholder', () => {
    expect(renderSignature('{{AGENT_NAME}}', { agentName: 'منى' })).toBe('منى');
    expect(renderSignature('{{  agent_name  }}', { agentName: 'منى' })).toBe(
      'منى'
    );
  });

  it('caps a template at the column limit instead of sending a wall of text', () => {
    const huge = 'x'.repeat(MAX_SIGNATURE_TEMPLATE_LENGTH + 500);
    expect(renderSignature(huge, {}).length).toBe(MAX_SIGNATURE_TEMPLATE_LENGTH);
  });
});

describe('appendSignature', () => {
  it('separates the body from the signature with one blank line', () => {
    expect(appendSignature('الموعد بكرة', 'منى')).toBe('الموعد بكرة\n\nمنى');
  });

  it('is idempotent — a body that already ends with the signature is untouched', () => {
    const signed = 'الموعد بكرة\n\nمنى';
    expect(appendSignature(signed, 'منى')).toBe(signed);
  });

  it('does nothing when there is no signature', () => {
    expect(appendSignature('الموعد بكرة', '')).toBe('الموعد بكرة');
  });

  it('does nothing when there is no body to sign', () => {
    expect(appendSignature('   ', 'منى')).toBe('   ');
  });

  it('leaves the message unsigned rather than over Meta’s limit', () => {
    const body = 'x'.repeat(MAX_TEXT_LENGTH - 2);
    expect(appendSignature(body, 'منى')).toBe(body);
  });

  it('trims the trailing newline a composer leaves behind', () => {
    expect(appendSignature('الموعد بكرة\n', 'منى')).toBe('الموعد بكرة\n\nمنى');
  });
});

// ---------------------------------------------------------------
// The one call the send paths make. The fake db mirrors the two reads it
// performs (accounts, then profiles) and can be told to fail either one.
// ---------------------------------------------------------------

interface FakeDbOptions {
  account?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
  accountError?: boolean;
  profileError?: boolean;
}

function fakeDb(
  opts: FakeDbOptions,
  touched: string[] = []
): SupabaseClient {
  return {
    from(table: string) {
      touched.push(table);
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => {
          if (table === 'accounts') {
            return opts.accountError
              ? { data: null, error: { message: 'boom' } }
              : { data: opts.account ?? null, error: null };
          }
          if (table === 'profiles') {
            return opts.profileError
              ? { data: null, error: { message: 'boom' } }
              : { data: opts.profile ?? null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('signOutgoingText', () => {
  it('returns the text untouched while the feature is off — the default', async () => {
    const touched: string[] = [];
    const out = await signOutgoingText({
      db: fakeDb(
        {
          account: {
            signature_enabled: false,
            signature_template: DEFAULT_SIGNATURE_TEMPLATE,
            name: 'هيموكيور',
          },
          profile: { full_name: 'منى', email: 'mona@clinic.test' },
        },
        touched
      ),
      accountId: 'acct-1',
      messageType: 'text',
      text: 'الموعد بكرة',
      senderId: 'user-1',
    });

    expect(out).toBe('الموعد بكرة');
    // Disabled stops after the settings read — no profile lookup at all.
    expect(touched).toEqual(['accounts']);
  });

  it('signs with the sender’s profile name when enabled', async () => {
    const out = await signOutgoingText({
      db: fakeDb({
        account: {
          signature_enabled: true,
          signature_template: '— {{ agent_name }}',
          name: 'هيموكيور',
        },
        profile: { full_name: 'منى', email: 'mona@clinic.test' },
      }),
      accountId: 'acct-1',
      messageType: 'text',
      text: 'الموعد بكرة',
      senderId: 'user-1',
    });

    expect(out).toBe('الموعد بكرة\n\n— منى');
  });

  it('falls back to the email local part when the profile has no name', async () => {
    const out = await signOutgoingText({
      db: fakeDb({
        account: {
          signature_enabled: true,
          signature_template: DEFAULT_SIGNATURE_TEMPLATE,
          name: 'هيموكيور',
        },
        profile: { full_name: '  ', email: 'mona@clinic.test' },
      }),
      accountId: 'acct-1',
      messageType: 'text',
      text: 'الموعد بكرة',
      senderId: 'user-1',
    });

    expect(out).toBe('الموعد بكرة\n\nmona');
  });

  it('uses the account name for an engine/API send with no teammate', async () => {
    const out = await signOutgoingText({
      db: fakeDb({
        account: {
          signature_enabled: true,
          signature_template: DEFAULT_SIGNATURE_TEMPLATE,
          name: 'هيموكيور',
        },
      }),
      accountId: 'acct-1',
      messageType: 'text',
      text: 'الموعد بكرة',
      senderId: null,
    });

    expect(out).toBe('الموعد بكرة\n\nهيموكيور');
  });

  it('never touches a template or interactive body', async () => {
    for (const messageType of ['template', 'interactive', 'image']) {
      const touched: string[] = [];
      const out = await signOutgoingText({
        db: fakeDb({ account: { signature_enabled: true } }, touched),
        accountId: 'acct-1',
        messageType,
        text: 'body',
        senderId: 'user-1',
      });
      expect(out).toBe('body');
      expect(touched).toEqual([]);
    }
  });

  it('answers with the unsigned text when the settings read fails', async () => {
    const out = await signOutgoingText({
      db: fakeDb({ accountError: true }),
      accountId: 'acct-1',
      messageType: 'text',
      text: 'الموعد بكرة',
      senderId: 'user-1',
    });

    expect(out).toBe('الموعد بكرة');
  });

  it('still signs with the account name when the profile read fails', async () => {
    const out = await signOutgoingText({
      db: fakeDb({
        account: {
          signature_enabled: true,
          signature_template: DEFAULT_SIGNATURE_TEMPLATE,
          name: 'هيموكيور',
        },
        profileError: true,
      }),
      accountId: 'acct-1',
      messageType: 'text',
      text: 'الموعد بكرة',
      senderId: 'user-1',
    });

    expect(out).toBe('الموعد بكرة\n\nهيموكيور');
  });

  it('leaves empty or missing text alone', async () => {
    const touched: string[] = [];
    const db = fakeDb({ account: { signature_enabled: true } }, touched);
    expect(
      await signOutgoingText({
        db,
        accountId: 'acct-1',
        messageType: 'text',
        text: '   ',
        senderId: 'user-1',
      })
    ).toBe('   ');
    expect(
      await signOutgoingText({
        db,
        accountId: 'acct-1',
        messageType: 'text',
        text: null,
        senderId: 'user-1',
      })
    ).toBeNull();
    expect(touched).toEqual([]);
  });
});
