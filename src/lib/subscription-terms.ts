/**
 * Term and renewal-date helpers for new subscriptions. Pure date maths on
 * "YYYY-MM-DD" strings in UTC (Microsoft dates terms in UTC), so the same
 * results come out in the browser and on the server.
 */

export type TermType = "MONTHLY" | "ANNUAL" | "THREE_YEAR";

export const TERM_MONTHS: Record<TermType, number> = { MONTHLY: 1, ANNUAL: 12, THREE_YEAR: 36 };

export const TERM_LABELS: Record<TermType, string> = {
  MONTHLY: "Monthly",
  ANNUAL: "Annual",
  THREE_YEAR: "3-year",
};

/** The date part of "2026-10-05", "2026-10-05 09:12:00 UTC" or an ISO string. */
export function datePart(value: string): string | null {
  const match = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

const split = (ymd: string) => ymd.split("-").map(Number) as [number, number, number];
const ymdUTC = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Renewal date of a new subscription starting on `start`.
 *
 * With end date alignment to the calendar month (our standard on Crayon) the
 * first term ends on the last day of a month, as close to the full term as
 * possible without exceeding it, so it renews on the 1st: monthly bought
 * 5 Oct renews 1 Nov; annual bought 5 Oct 2026 renews 1 Oct 2027. Without
 * alignment it renews on the anniversary (5 Nov / 5 Oct 2027).
 */
export function renewalDateFor(start: string, termType: TermType, aligned: boolean): string {
  const [y, m, d] = split(start);
  const months = TERM_MONTHS[termType];
  if (aligned) return ymdUTC(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(y, m + months, 0)).getUTCDate();
  return ymdUTC(Date.UTC(y, m - 1 + months, Math.min(d, lastDay)));
}

/**
 * Why a chosen renewal date can't be right, or null if it can. End date
 * alignment can shorten the first term but never extend it.
 */
export function renewalDateProblem(start: string, termType: TermType, renewal: string): string | null {
  const latest = renewalDateFor(start, termType, false);
  if (renewal <= start) return `The renewal date must be after the start date (${formatYmd(start)}).`;
  if (renewal > latest) {
    return `The renewal date can't be later than ${formatYmd(latest)} — end date alignment can shorten a ${TERM_LABELS[termType].toLowerCase()} term, not extend it.`;
  }
  return null;
}

export function dayBefore(ymd: string): string {
  const [y, m, d] = split(ymd);
  return ymdUTC(Date.UTC(y, m - 1, d - 1));
}

export function formatYmd(ymd: string): string {
  const [y, m, d] = split(ymd);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
