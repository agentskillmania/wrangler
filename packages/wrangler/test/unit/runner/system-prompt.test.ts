import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildTimeLine } from '../../../src/runner/system-prompt.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Mirror the expected line from a Date's local getters (pins format, not clock) */
function expectedLine(now: Date): string {
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${WEEKDAYS[now.getDay()]}, ${p2(now.getMonth() + 1)}/${p2(now.getDate())}/${now.getFullYear()}, ${p2(now.getHours())}:${p2(now.getMinutes())} (${sign}${p2(Math.trunc(abs / 60))}:${p2(abs % 60)})`;
}

describe('buildTimeLine', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the single-line time context aligned with Rust build_time_line', () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date('2026-05-13T10:06:00Z'));

    const result = buildTimeLine();

    // 形状：`Wednesday, 13/05/2026, 10:06 (+08:00)` —— 星期, DD/MM/YYYY,
    // HH:MM, 数字时区偏移（无 IANA 名、无 --- 界符——那是旧头部形态）。
    expect(result).toMatch(/^[A-Z][a-z]+, \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2} \([+-]\d{2}:\d{2}\)$/);
    expect(result).toBe(expectedLine(new Date('2026-05-13T10:06:00Z')));
  });

  it('minute-level granularity: two times 1 minute apart differ, sub-minute times do not', () => {
    expect(buildTimeLine(new Date('2026-05-13T10:06:00'))).not.toBe(
      buildTimeLine(new Date('2026-05-13T10:07:00'))
    );
    expect(buildTimeLine(new Date('2026-05-13T10:06:00'))).toBe(
      buildTimeLine(new Date('2026-05-13T10:06:59'))
    );
  });

  it('accepts an injected Date (per-build fresh computation in the assembler)', () => {
    const now = new Date('2026-01-02T23:59:00');
    expect(buildTimeLine(now)).toBe(expectedLine(now));
  });
});
