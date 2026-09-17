/**
 * Time context (single-line text of current date/time + timezone).
 *
 * Consumer: the message assembler computes it fresh on every request build as
 * the FIRST line of the dynamic tail reminder (buildDynamicReminder) — it sits
 * after the prefix-cache breakpoint, so minute-level changes only cost the
 * reminder block itself, never the cacheable prefix.
 *
 * Historically it was prefixed to the system prompt header as YAML frontmatter
 * (invalidating the provider prefix cache wholesale on every >1min request
 * gap); that injection point is gone (R2P-101w, aligned with Rust 5120a3e /
 * 1f08b1f, where the header time context was removed and `build_time_line`
 * feeds the tail reminder only).
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Build a single line containing the current date/time and timezone offset.
 *
 * Format (byte-aligned with Rust `build_time_line`):
 * ```
 * Wednesday, 05/13/2026, 10:06 (+08:00)
 * ```
 * MM/DD/YYYY (month first) — both this and Rust's `build_time_line` format
 * `{:02}/{:02}` as month/day. Rust's own doc example historically showed the
 * DD/MM direction (13/05/2026), a self-contradiction inherited by the TS
 * port's JSDoc; this example states the actual emitted direction.
 *
 * The timezone is the numeric UTC offset (never the IANA name): the offset is
 * what the Rust reference emits and it keeps this line host-stable in shape.
 *
 * @param now - Injection point for tests; defaults to the current time.
 */
export function buildTimeLine(now: Date = new Date()): string {
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);
  const tz = `${sign}${String(Math.trunc(absOffset / 60)).padStart(2, '0')}:${String(absOffset % 60).padStart(2, '0')}`;
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  return `${WEEKDAYS[now.getDay()]}, ${month}/${day}/${now.getFullYear()}, ${hour}:${minute} (${tz})`;
}
