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
// Grace period pro-rata: charge for seats used between renewal and reduction
// ---------------------------------------------------------------------------
// When a customer reduces seats within the 7-day grace period after renewal,
// the reduction takes effect immediately. But they used the extra seats from
// the renewal date until the reduction date, so they must be billed pro-rata
// for that period.

export interface GracePeriodProRataResult {
  dailyRate: number;
  daysUsed: number;
  daysInMonth: number;
  perSeatCharge: number;
  totalCharge: number;
  periodStart: Date;
  periodEnd: Date;
  breakdown: string;
}

export function calculateGracePeriodProRata(params: {
  pricePerSeat: number;
  seatsReduced: number;
  renewalDate: Date;
  reductionDate: Date;
  currency?: string;
}): GracePeriodProRataResult {
  const { pricePerSeat, seatsReduced, renewalDate, reductionDate, currency = "ZAR" } = params;

  const daysInMonth = getDaysInMonth(renewalDate);
  const periodStart = startOfDay(renewalDate);
  const periodEnd = startOfDay(reductionDate);

  // Days used = renewal date through the day before the reduction (inclusive)
  // e.g. renewal 1 April, reduction 7 April = 6 days (1,2,3,4,5,6 April)
  const daysUsed = differenceInCalendarDays(periodEnd, periodStart);

  const dailyRate = roundTo2(pricePerSeat / daysInMonth);
  const perSeatCharge = roundTo2(dailyRate * daysUsed);
  const totalCharge = roundTo2(perSeatCharge * seatsReduced);

  const sym = currencySymbol(currency);
  const startStr = format(periodStart, "d MMM");
  const endStr = format(periodEnd, "d MMM");

  const breakdown = [
    `Customer's agreed rate per seat: ${sym}${pricePerSeat.toFixed(2)}/month`,
    `Daily rate: ${sym}${pricePerSeat.toFixed(2)} \u00F7 ${daysInMonth} = ${sym}${dailyRate.toFixed(2)}`,
    `Days used (renewal to reduction): ${daysUsed} (${startStr} \u2013 ${endStr})`,
    `Per seat charge: ${sym}${dailyRate.toFixed(2)} \u00D7 ${daysUsed} = ${sym}${perSeatCharge.toFixed(2)}`,
    `Total charge: ${sym}${perSeatCharge.toFixed(2)} \u00D7 ${seatsReduced} = ${sym}${totalCharge.toFixed(2)}`,
  ].join("\n");

  return {
    dailyRate,
    daysUsed,
    daysInMonth,
    perSeatCharge,
    totalCharge,
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

/**
 * Get renewal date (1st of anniversary month).
 * For ANNUAL: 1 year from start.
 * For THREE_YEAR: 3 years from start.
 * For MONTHLY: 1st of next month.
 */
export function getNextRenewalDate(
  startDate: Date,
  termType: "MONTHLY" | "ANNUAL" | "THREE_YEAR"
): Date {
  const year = startDate.getFullYear();
  const month = startDate.getMonth();

  switch (termType) {
    case "MONTHLY":
      return new Date(year, month + 1, 1);
    case "ANNUAL":
      return new Date(year + 1, month, 1);
    case "THREE_YEAR":
      return new Date(year + 3, month, 1);
  }
}
