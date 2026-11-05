import { describe, expect, it } from 'vitest';

import { AGENT_NAME_MAX_LENGTH, agentNamePayload } from './agent-name';

describe('agentNamePayload', () => {
  it('says nothing when the box was never touched', () => {
    // Absent (not null) is what keeps a stale screen from wiping a saved name.
    expect(agentNamePayload('', false)).toBeUndefined();
    expect(agentNamePayload('مساعد', false)).toBeUndefined();
  });

  it('clears the name when a human emptied the box on purpose', () => {
    expect(agentNamePayload('', true)).toBeNull();
    expect(agentNamePayload('   ', true)).toBeNull();
  });

  it('sets the trimmed name', () => {
    expect(agentNamePayload('  مساعد هيموكيور  ', true)).toBe('مساعد هيموكيور');
  });

  it('caps the name at the column limit', () => {
    const long = 'ا'.repeat(AGENT_NAME_MAX_LENGTH + 20);
    expect(agentNamePayload(long, true)).toHaveLength(AGENT_NAME_MAX_LENGTH);
  });
});
