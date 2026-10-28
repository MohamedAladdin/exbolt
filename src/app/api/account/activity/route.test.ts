import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// The activity endpoint is the only way to read the trail from the outside,
// so its gates are the contract:
//   * plan  — `audit_log` (CORE off, GROWTH/SCALE on);
//   * role  — admin+ (both enforced by requireFeature).
// These tests pin the fact that the gate is SERVER-SIDE: a client that
// ignores the hidden settings tab still gets 402/403, and no query runs.
// ---------------------------------------------------------------------------

const requireFeature = vi.fn();

vi.mock('@/lib/plans/guard', () => ({
  requireFeature: (...args: unknown[]) => requireFeature(...args),
}));

const logRows = [
  {
    id: 2,
    created_at: '2026-10-28T10:00:00.000Z',
    action: 'members.role_changed',
    category: 'members',
    source: 'app',
    actor_user_id: 'u1',
    actor_name: 'محمد',
    actor_email: 'm@example.com',
    actor_role: 'owner',
    target_type: 'member',
    target_id: 'u2',
    target_label: 'سارة',
    changes: { account_role: { from: 'agent', to: 'admin' } },
    metadata: { table: 'profiles', op: 'UPDATE' },
  },
  {
    id: 1,
    created_at: '2026-10-28T09:00:00.000Z',
    action: 'settings.tag_added',
    category: 'settings',
    source: 'app',
    actor_user_id: 'u1',
    actor_name: 'محمد',
    actor_email: 'm@example.com',
    actor_role: 'owner',
    target_type: 'tag',
    target_id: 't1',
    target_label: 'VIP',
    changes: {},
    metadata: { table: 'tags', op: 'INSERT' },
  },
];

const orCalls: string[] = [];

function builder(result: unknown) {
  const b: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit', 'lt']) {
    b[method] = vi.fn(() => b);
  }
  b.or = vi.fn((value: string) => {
    orCalls.push(value);
    return b;
  });
  b.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return b;
}

function supabaseMock() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'account_activity_log') return builder({ data: logRows, error: null });
      return builder({
        data: [
          {
            actor_user_id: 'u1',
            actor_name: 'محمد',
            actor_email: 'm@example.com',
            events: 12,
            last_seen: '2026-10-28T10:00:00.000Z',
          },
        ],
        error: null,
      });
    }),
  };
}

const ctx = {
  supabase: supabaseMock(),
  userId: 'u1',
  accountId: 'acct-1',
  role: 'owner',
  account: { id: 'acct-1', name: 'Acme', status: 'active' },
  entitlements: {},
};

async function get(query = '') {
  const { GET } = await import('./route');
  return GET(new Request(`https://bolt.test/api/account/activity${query}`));
}

beforeEach(() => {
  requireFeature.mockReset();
  orCalls.length = 0;
  ctx.supabase = supabaseMock();
});

describe('GET /api/account/activity', () => {
  it('returns 402 for a plan without the audit_log feature, without querying', async () => {
    const { PlanError } = await vi.importActual<typeof import('@/lib/plans/guard')>(
      '@/lib/plans/guard',
    );
    requireFeature.mockRejectedValue(
      new PlanError('This feature is not included in the Core plan.', {
        code: 'plan_feature_missing',
        feature: 'audit_log',
      }),
    );

    const res = await get();
    expect(res.status).toBe(402);
    expect(ctx.supabase.from).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.code).toBe('plan_feature_missing');
  });

  it('declares the feature and the minimum role it needs', async () => {
    requireFeature.mockRejectedValue(new Error('stop'));
    await get();
    expect(requireFeature).toHaveBeenCalledWith('audit_log', 'admin');
  });

  it('returns 403 for an agent (role gate lives in requireFeature)', async () => {
    const { ForbiddenError } = await vi.importActual<typeof import('@/lib/auth/account')>(
      '@/lib/auth/account',
    );
    requireFeature.mockRejectedValue(new ForbiddenError('nope'));

    const res = await get();
    expect(res.status).toBe(403);
  });

  it('returns the newest page and the actor list', async () => {
    requireFeature.mockResolvedValue(ctx);

    const res = await get('?limit=1');
    expect(res.status).toBe(200);

    const body = await res.json();
    // limit=1 fetches 2 rows; the extra one is only there to tell us
    // there is another page, and it must not be returned.
    expect(body.events).toHaveLength(1);
    expect(body.events[0].id).toBe(2);
    expect(body.nextCursor).toBe(2);
    expect(body.actors).toEqual([
      { id: 'u1', name: 'محمد', email: 'm@example.com', events: 12 },
    ]);
  });

  it('strips characters that would break the PostgREST or-filter', async () => {
    requireFeature.mockResolvedValue(ctx);

    await get('?q=' + encodeURIComponent('sa,ra(1)%*"'));
    expect(orCalls).toHaveLength(1);
    // The reserved characters are gone from the TERM; the remaining
    // commas/percent signs are PostgREST's own syntax and must stay.
    expect(orCalls[0]).toBe(
      'target_label.ilike.%sara1%,actor_name.ilike.%sara1%,action.ilike.%sara1%',
    );
  });

  it('ignores an unknown category and a non-uuid actor instead of failing', async () => {
    requireFeature.mockResolvedValue(ctx);
    const res = await get('?category=everything&actor=../../etc');
    expect(res.status).toBe(200);
  });
});
