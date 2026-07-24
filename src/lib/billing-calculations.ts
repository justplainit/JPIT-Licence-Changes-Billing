import {
  getDaysInMonth,
  differenceInCalendarDays,
  differenceInHours,
  addHours,
  format,
  startOfDay,
  endOfMonth,
  isAfter,
  isBefore,
} from "date-fns";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProRataResult {
  dailyRate: number;
  daysRemaining: number;
  daysInMonth: number;
  perSeatProRata: number;
  totalAmount: number;
  periodStart: Date;
  periodEnd: Date;
  breakdown: string;
}

export interface CreditResult {
  dailyRate: number;
  daysRemaining: number;
  daysInMonth: number;
  perSeatCredit: number;
  totalCredit: number;
  periodStart: Date;
  periodEnd: Date;
  breakdown: string;
}

export interface UpgradeResult {
  credit: ProRataResult;
  charge: ProRataResult;
  netAmount: number;
  breakdown: string;
}

// ---------------------------------------------------------------------------
// Currency formatting
// ---------------------------------------------------------------------------

export function formatCurrency(amount: number, currency: string = "ZAR"): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  switch (currency.toUpperCase()) {
    case "USD":
      return `${sign}$${abs.toFixed(2)}`;
    case "ZAR":
    default:
      return `${sign}R${abs.toFixed(2)}`;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function currencySymbol(currency: string): string {
  switch (currency.toUpperCase()) {
    case "USD":
      return "$";
    case "ZAR":
    default:
      return "R";
  }
}

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Pro rata calculation for mid-month seat increases
// ---------------------------------------------------------------------------

export function calculateProRata(params: {
  pricePerSeat: number;
  additionalSeats: number;
  changeDate: Date;
  currency?: string;
}): ProRataResult {
  const { pricePerSeat, additionalSeats, changeDate, currency = "ZAR" } = params;

  const daysInMonth = getDaysInMonth(changeDate);
  const periodStart = startOfDay(changeDate);
  const periodEnd = endOfMonth(changeDate);

  // Remaining days = changeDate through last day of month (inclusive)
  const daysRemaining = differenceInCalendarDays(periodEnd, periodStart) + 1;

  const dailyRate = roundTo2(pricePerSeat / daysInMonth);
  const perSeatProRata = roundTo2(dailyRate * daysRemaining);
  const totalAmount = roundTo2(perSeatProRata * additionalSeats);

  const sym = currencySymbol(currency);
  const startStr = format(periodStart, "d MMM");
  const endStr = format(periodEnd, "d MMM");
  const monthName = format(changeDate, "MMM");

  const breakdown = [
    `Customer's agreed rate per seat: ${sym}${pricePerSeat.toFixed(2)}/month`,
    `Daily rate: ${sym}${pricePerSeat.toFixed(2)} \u00F7 ${daysInMonth} = ${sym}${dailyRate.toFixed(2)}`,
    `Days remaining: ${daysRemaining} (${startStr} \u2013 ${endStr} inclusive)`,
    `Per seat pro rata: ${sym}${dailyRate.toFixed(2)} \u00D7 ${daysRemaining} = ${sym}${perSeatProRata.toFixed(2)}`,
    `Total: ${sym}${perSeatProRata.toFixed(2)} \u00D7 ${additionalSeats} = ${sym}${totalAmount.toFixed(2)}`,
  ].join("\n");

  return {
    dailyRate,
    daysRemaining,
    daysInMonth,
    perSeatProRata,
    totalAmount,
    periodStart,
    periodEnd,
    breakdown,
  };
}

// ---------------------------------------------------------------------------
// Seat reduction credit (within 7-day window)
// ---------------------------------------------------------------------------

export function calculateSeatReductionCredit(params: {
  pricePerSeat: number;
  seatsRemoved: number;
  reductionDate: Date;
}): CreditResult {
  const { pricePerSeat, seatsRemoved, reductionDate } = params;
  const currency = "ZAR";

  const daysInMonth = getDaysInMonth(reductionDate);
  const periodStart = startOfDay(reductionDate);
  const periodEnd = endOfMonth(reductionDate);

  const daysRemaining = differenceInCalendarDays(periodEnd, periodStart) + 1;

  const dailyRate = roundTo2(pricePerSeat / daysInMonth);
  const perSeatCredit = roundTo2(dailyRate * daysRemaining);
  const totalCredit = roundTo2(perSeatCredit * seatsRemoved);

  const sym = currencySymbol(currency);
  const startStr = format(periodStart, "d MMM");
  const endStr = format(periodEnd, "d MMM");

  const breakdown = [
    `Customer's agreed rate per seat: ${sym}${pricePerSeat.toFixed(2)}/month`,
    `Daily rate: ${sym}${pricePerSeat.toFixed(2)} \u00F7 ${daysInMonth} = ${sym}${dailyRate.toFixed(2)}`,
    `Days remaining: ${daysRemaining} (${startStr} \u2013 ${endStr} inclusive)`,
    `Per seat credit: ${sym}${dailyRate.toFixed(2)} \u00D7 ${daysRemaining} = ${sym}${perSeatCredit.toFixed(2)}`,
    `Total credit: ${sym}${perSeatCredit.toFixed(2)} \u00D7 ${seatsRemoved} = ${sym}${totalCredit.toFixed(2)}`,
  ].join("\n");

  return {
    dailyRate,
    daysRemaining,
    daysInMonth,
    perSeatCredit,
    totalCredit,
    periodStart,
    periodEnd,
    breakdown,
  };
}

// ---------------------------------------------------------------------------
// Upgrade cost calculation (credit old + charge new)
// ---------------------------------------------------------------------------

export function calculateUpgradeCost(params: {
  oldPricePerSeat: number;
  newPricePerSeat: number;
  seats: number;
  changeDate: Date;
}): UpgradeResult {
  const { oldPricePerSeat, newPricePerSeat, seats, changeDate } = params;

  const credit = calculateProRata({
    pricePerSeat: oldPricePerSeat,
    additionalSeats: seats,
    changeDate,
  });

  const charge = calculateProRata({
    pricePerSeat: newPricePerSeat,
    additionalSeats: seats,
    changeDate,
  });

  const netAmount = roundTo2(charge.totalAmount - credit.totalAmount);

  const startStr = format(startOfDay(changeDate), "d MMM");
  const endStr = format(endOfMonth(changeDate), "d MMM");

  const breakdown = [
    `=== CREDIT for old product (${startStr} \u2013 ${endStr}) ===`,
    credit.breakdown,
    ``,
    `=== CHARGE for new product (${startStr} \u2013 ${endStr}) ===`,
    charge.breakdown,
    ``,
    `Net adjustment: ${formatCurrency(charge.totalAmount)} \u2212 ${formatCurrency(credit.totalAmount)} = ${formatCurrency(netAmount)}`,
  ].join("\n");

  return {
    credit,
    charge,
    netAmount,
    breakdown,
  };
}

// ---------------------------------------------------------------------------
// 7-day cancellation / reduction window helpers
// ---------------------------------------------------------------------------

export function calculate7DayWindow(startTime: Date): {
  opensAt: Date;
  closesAt: Date;
} {
  const opensAt = startTime;
  const closesAt = addHours(startTime, 168); // 7 days = 168 hours
  return { opensAt, closesAt };
}

export function isWindowOpen(closesAt: Date): boolean {
  return isBefore(new Date(), closesAt);
}

export function getWindowTimeRemaining(closesAt: Date): {
  hours: number;
  minutes: number;
  isExpired: boolean;
  display: string;
} {
  const now = new Date();

  if (isAfter(now, closesAt)) {
    return {
      hours: 0,
      minutes: 0,
      isExpired: true,
      display: "Window expired",
    };
  }

  const totalHours = differenceInHours(closesAt, now);
  const remainingMs = closesAt.getTime() - now.getTime();
  const totalMinutes = Math.floor(remainingMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  let display: string;
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    display = `${days}d ${remainingHours}h ${minutes}m remaining`;
  } else if (hours > 0) {
    display = `${hours}h ${minutes}m remaining`;
  } else {
    display = `${minutes}m remaining`;
  }

  return { hours, minutes, isExpired: false, display };
}

// ---------------------------------------------------------------------------
// Term pricing helpers
// ---------------------------------------------------------------------------

/** Monthly term premium: 20% over annual term price */
export function calculateMonthlyTermPrice(annualTermPrice: number): number {
  return roundTo2(annualTermPrice * 1.2);
}

/** EST (Extended Support Term) uplift: monthly rate + 3% */
export function calculateESTPrice(monthlyRate: number): number {
  return roundTo2(monthlyRate * 1.03);
}

// ---------------------------------------------------------------------------
// Billing date helpers
// ---------------------------------------------------------------------------

/**
 * Get the next billing date (26th of month).
 * If today is on or after the 26th, returns the 26th of next month.
 */
export function getNextBillingDate(fromDate: Date): Date {
  const year = fromDate.getFullYear();
  const month = fromDate.getMonth();
  const day = fromDate.getDate();

  if (day < 26) {
    return new Date(year, month, 26);
  }
  // Move to 26th of next month
  return new Date(year, month + 1, 26);
}

/** Number of months in one term interval. */
function termMonths(termType: "MONTHLY" | "ANNUAL" | "THREE_YEAR"): number {
  return termType === "MONTHLY" ? 1 : termType === "THREE_YEAR" ? 36 : 12;
}

/**
 * Add whole months to a date, preserving the day-of-month and clamping to the
 * last day of the target month when the day doesn't exist there (e.g. adding a
 * month to 31 Jan lands on 28/29 Feb). The result is normalised to local
 * midnight so renewal dates stay time-component free.
 */
function addMonthsClamped(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const daysInTargetMonth = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0
  ).getDate();
  target.setDate(Math.min(date.getDate(), daysInTargetMonth));
  return target;
}

/**
 * Get the renewal date: the anniversary of the start date, one term ahead.
 *
 * This mirrors Microsoft NCE, where a subscription renews on the anniversary of
 * its commitment start date (the actual day), not the 1st of the month.
 * For ANNUAL: 1 year from start. For THREE_YEAR: 3 years. For MONTHLY: 1 month.
 */
export function getNextRenewalDate(
  startDate: Date,
  termType: "MONTHLY" | "ANNUAL" | "THREE_YEAR"
): Date {
  return addMonthsClamped(startDate, termMonths(termType));
}

/**
 * Get the next renewal date that falls on or after a reference date.
 *
 * A subscription's stored renewalDate can be in the past (e.g. a previous
 * anniversary that has already elapsed). When scheduling a change "at renewal",
 * we must roll the stored anniversary forward by the term interval until it is
 * on or after the reference date (typically the change/notification date), so
 * the change lands on the upcoming renewal rather than a past one. The
 * anniversary day-of-month is preserved (candidates are always computed from the
 * original anchor, so no drift accumulates).
 */
export function getUpcomingRenewalDate(
  renewalDate: Date,
  termType: "MONTHLY" | "ANNUAL" | "THREE_YEAR",
  referenceDate: Date
): Date {
  const step = termMonths(termType);

  // Normalise the anchor to local midnight, preserving its day-of-month.
  let candidate = addMonthsClamped(renewalDate, 0);

  // Advance in whole-term multiples from the anchor until on or after the
  // reference date. Guard against pathological loops with a generous bound.
  let k = 0;
  while (candidate < referenceDate && k < 1200) {
    k += 1;
    candidate = addMonthsClamped(renewalDate, step * k);
  }

  return candidate;
}
