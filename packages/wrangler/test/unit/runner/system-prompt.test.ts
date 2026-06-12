import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildTimeContext } from '../../../src/runner/system-prompt.js';

describe('buildTimeContext', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a YAML frontmatter block containing Time and Timezone', () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date('2026-05-13T10:06:00Z'));

    const result = buildTimeContext();

    expect(result).toMatch(/^---\nTime: .+\nTimezone: .+\n---$/);
    expect(result).toMatch(/Time: [A-Za-z]+, \d{2}\/\d{2}\/\d{4}, \d{2}:06/);
    expect(result).toMatch(/Timezone: [A-Za-z0-9/_+-]+/);
  });

  it('uses the current local timezone from Intl.DateTimeFormat', () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date('2026-05-13T10:06:00Z'));

    const result = buildTimeContext();
    const expectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    expect(result).toContain(`Timezone: ${expectedTz}`);
  });

  it('updates the timestamp when the system time crosses day boundaries', () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date('2026-01-02T23:59:00Z'));

    const beforeMidnight = buildTimeContext();
    expect(beforeMidnight).toMatch(/Time: [A-Za-z]+, 0\d\/0\d\/2026, \d{2}:59/);

    vi.setSystemTime(new Date('2026-01-03T00:01:00Z'));

    const afterMidnight = buildTimeContext();
    expect(afterMidnight).toMatch(/Time: [A-Za-z]+, 01\/0\d\/2026, 0\d:01/);
  });
});
