import { format, endOfMonth, startOfDay } from "date-fns";
import {
  calculateProRata,
  calculateSeatReductionCredit,
  calculateUpgradeCost,
  formatCurrency,
} from "./billing-calculations";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InvoiceLineItemOutput {
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  calculationBreakdown: string;
}

export interface InvoiceDraftOutput {
  type: "PRO_RATA" | "CREDIT_NOTE" | "UPGRADE_ADJUSTMENT";
  customerName: string;
  invoiceDate: Date;
  lineItems: InvoiceLineItemOutput[];
  totalAmount: number;
  currency: string;
  notes: string[];
  formattedDraft: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(d: Date): string {
  return format(d, "d MMMM yyyy");
}

function formatShortDate(d: Date): string {
  return format(d, "d MMM yyyy");
}

function monthName(d: Date): string {
  return format(d, "MMMM");
}

// ---------------------------------------------------------------------------
// Pro rata invoice draft for mid-month seat increase
// ---------------------------------------------------------------------------

export function generateProRataInvoiceDraft(params: {
  customerName: string;
  productName: string;
  pricePerSeat: number;
  additionalSeats: number;
  changeDate: Date;
  currentSeatCount: number;
  currency?: string;
}): InvoiceDraftOutput {
  const {
    customerName,
    productName,
    pricePerSeat,
    additionalSeats,
    changeDate,
    currentSeatCount,
    currency = "ZAR",
  } = params;

  const proRata = calculateProRata({
    pricePerSeat,
    additionalSeats,
    changeDate,
    currency,
  });

  const periodStart = startOfDay(changeDate);
  const periodEnd = endOfMonth(changeDate);
  const month = monthName(changeDate);
  const newSeatCount = currentSeatCount + additionalSeats;

  const lineItem: InvoiceLineItemOutput = {
    description: `${productName} \u2013 Pro rata for ${additionalSeats} additional seat${additionalSeats !== 1 ? "s" : ""} (${format(periodStart, "d MMM")} \u2013 ${format(periodEnd, "d MMM yyyy")})`,
    quantity: additionalSeats,
    unitPrice: proRata.perSeatProRata,
    lineTotal: proRata.totalAmount,
    calculationBreakdown: proRata.breakdown,
  };

  const notes = [
    `Do NOT adjust the repeating invoice for ${month} \u2013 it has already been billed at ${currentSeatCount} seats.`,
    `From next month, update the repeating invoice to ${newSeatCount} seats at ${formatCurrency(pricePerSeat, currency)}/seat.`,
    `This one-time invoice covers only the pro rata charge for the additional ${additionalSeats} seat${additionalSeats !== 1 ? "s" : ""} for the remainder of ${month}.`,
  ];

  const formattedDraft = [
    `${"=".repeat(60)}`,
    `PRO RATA INVOICE DRAFT`,
    `${"=".repeat(60)}`,
    ``,
    `Customer:       ${customerName}`,
    `Invoice date:   ${formatDate(changeDate)}`,
    `Currency:       ${currency}`,
    ``,
    `${"─".repeat(60)}`,
    `LINE ITEMS`,
    `${"─".repeat(60)}`,
    ``,
    `${lineItem.description}`,
    `  Qty: ${additionalSeats}   Unit price: ${formatCurrency(lineItem.unitPrice, currency)}   Line total: ${formatCurrency(lineItem.lineTotal, currency)}`,
    ``,
    `  Calculation:`,
    ...proRata.breakdown.split("\n").map((line) => `    ${line}`),
    ``,
    `${"─".repeat(60)}`,
    `TOTAL: ${formatCurrency(proRata.totalAmount, currency)}`,
    `${"─".repeat(60)}`,
    ``,
    `NOTES:`,
    ...notes.map((note, i) => `  ${i + 1}. ${note}`),
    ``,
    `Seat summary:`,
    `  Previous count: ${currentSeatCount}`,
    `  Added:          ${additionalSeats}`,
    `  New count:      ${newSeatCount}`,
    `  Effective from: ${formatShortDate(changeDate)}`,
    `${"=".repeat(60)}`,
  ].join("\n");

  return {
    type: "PRO_RATA",
    customerName,
    invoiceDate: changeDate,
    lineItems: [lineItem],
    totalAmount: proRata.totalAmount,
    currency,
    notes,
    formattedDraft,
  };
}

// ---------------------------------------------------------------------------
// Credit note draft for seat reduction
// ---------------------------------------------------------------------------

export function generateCreditNoteDraft(params: {
  customerName: string;
  productName: string;
  pricePerSeat: number;
  seatsRemoved: number;
  reductionDate: Date;
  currency?: string;
}): InvoiceDraftOutput {
  const {
    customerName,
    productName,
    pricePerSeat,
    seatsRemoved,
    reductionDate,
    currency = "ZAR",
  } = params;

  const creditResult = calculateSeatReductionCredit({
    pricePerSeat,
    seatsRemoved,
    reductionDate,
  });

  const periodStart = startOfDay(reductionDate);
  const periodEnd = endOfMonth(reductionDate);
  const month = monthName(reductionDate);

  const lineItem: InvoiceLineItemOutput = {
    description: `${productName} \u2013 Credit for ${seatsRemoved} seat${seatsRemoved !== 1 ? "s" : ""} removed (${format(periodStart, "d MMM")} \u2013 ${format(periodEnd, "d MMM yyyy")})`,
    quantity: seatsRemoved,
    unitPrice: -creditResult.perSeatCredit,
    lineTotal: -creditResult.totalCredit,
    calculationBreakdown: creditResult.breakdown,
  };

  const notes = [
    `This credit note covers the unused portion of ${month} for the ${seatsRemoved} seat${seatsRemoved !== 1 ? "s" : ""} that were removed.`,
    `The seat reduction must be within the 7-day cancellation window to qualify for a credit.`,
    `Update the repeating invoice to reflect the reduced seat count from next month.`,
  ];

  const formattedDraft = [
    `${"=".repeat(60)}`,
    `CREDIT NOTE DRAFT`,
    `${"=".repeat(60)}`,
    ``,
    `Customer:       ${customerName}`,
    `Credit date:    ${formatDate(reductionDate)}`,
    `Currency:       ${currency}`,
    ``,
    `${"─".repeat(60)}`,
    `LINE ITEMS`,
    `${"─".repeat(60)}`,
    ``,
    `${lineItem.description}`,
    `  Qty: ${seatsRemoved}   Unit credit: ${formatCurrency(creditResult.perSeatCredit, currency)}   Line total: -${formatCurrency(creditResult.totalCredit, currency)}`,
    ``,
    `  Calculation:`,
    ...creditResult.breakdown.split("\n").map((line) => `    ${line}`),
    ``,
    `${"─".repeat(60)}`,
    `TOTAL CREDIT: -${formatCurrency(creditResult.totalCredit, currency)}`,
    `${"─".repeat(60)}`,
    ``,
    `NOTES:`,
    ...notes.map((note, i) => `  ${i + 1}. ${note}`),
    `${"=".repeat(60)}`,
  ].join("\n");

  return {
    type: "CREDIT_NOTE",
    customerName,
    invoiceDate: reductionDate,
    lineItems: [lineItem],
    totalAmount: -creditResult.totalCredit,
    currency,
    notes,
    formattedDraft,
  };
}

// ---------------------------------------------------------------------------
// Upgrade invoice draft (credit old product + charge new product)
// ---------------------------------------------------------------------------

export function generateUpgradeInvoiceDraft(params: {
  customerName: string;
  oldProductName: string;
  newProductName: string;
  oldPricePerSeat: number;
  newPricePerSeat: number;
  seats: number;
  changeDate: Date;
  currency?: string;
}): InvoiceDraftOutput {
  const {
    customerName,
    oldProductName,
    newProductName,
    oldPricePerSeat,
    newPricePerSeat,
    seats,
    changeDate,
    currency = "ZAR",
  } = params;

  const upgradeResult = calculateUpgradeCost({
    oldPricePerSeat,
    newPricePerSeat,
    seats,
    changeDate,
  });

  const periodStart = startOfDay(changeDate);
  const periodEnd = endOfMonth(changeDate);
  const month = monthName(changeDate);
  const periodLabel = `${format(periodStart, "d MMM")} \u2013 ${format(periodEnd, "d MMM yyyy")}`;

  const creditLine: InvoiceLineItemOutput = {
    description: `${oldProductName} \u2013 Credit for remainder of ${month} (${periodLabel})`,
    quantity: seats,
    unitPrice: -upgradeResult.credit.perSeatProRata,
    lineTotal: -upgradeResult.credit.totalAmount,
    calculationBreakdown: upgradeResult.credit.breakdown,
  };

  const chargeLine: InvoiceLineItemOutput = {
    description: `${newProductName} \u2013 Charge for remainder of ${month} (${periodLabel})`,
    quantity: seats,
    unitPrice: upgradeResult.charge.perSeatProRata,
    lineTotal: upgradeResult.charge.totalAmount,
    calculationBreakdown: upgradeResult.charge.breakdown,
  };

  const notes = [
    `Do NOT adjust the repeating invoice for ${month} \u2013 the old product has already been billed.`,
    `From next month, replace the repeating invoice line from ${oldProductName} to ${newProductName} at ${formatCurrency(newPricePerSeat, currency)}/seat.`,
    `Line 1 credits the customer for the unused portion of ${oldProductName}.`,
    `Line 2 charges for the new product (${newProductName}) for the same period.`,
    `Net amount payable: ${formatCurrency(upgradeResult.netAmount, currency)}.`,
  ];

  const formattedDraft = [
    `${"=".repeat(60)}`,
    `UPGRADE ADJUSTMENT INVOICE DRAFT`,
    `${"=".repeat(60)}`,
    ``,
    `Customer:       ${customerName}`,
    `Invoice date:   ${formatDate(changeDate)}`,
    `Currency:       ${currency}`,
    `Upgrade:        ${oldProductName} \u2192 ${newProductName}`,
    `Seats:          ${seats}`,
    ``,
    `${"─".repeat(60)}`,
    `LINE 1 \u2013 CREDIT (old product)`,
    `${"─".repeat(60)}`,
    ``,
    `${creditLine.description}`,
    `  Qty: ${seats}   Unit credit: ${formatCurrency(upgradeResult.credit.perSeatProRata, currency)}   Line total: -${formatCurrency(upgradeResult.credit.totalAmount, currency)}`,
    ``,
    `  Calculation:`,
    ...upgradeResult.credit.breakdown.split("\n").map((line) => `    ${line}`),
    ``,
    `${"─".repeat(60)}`,
    `LINE 2 \u2013 CHARGE (new product)`,
    `${"─".repeat(60)}`,
    ``,
    `${chargeLine.description}`,
    `  Qty: ${seats}   Unit price: ${formatCurrency(upgradeResult.charge.perSeatProRata, currency)}   Line total: ${formatCurrency(upgradeResult.charge.totalAmount, currency)}`,
    ``,
    `  Calculation:`,
    ...upgradeResult.charge.breakdown.split("\n").map((line) => `    ${line}`),
    ``,
    `${"─".repeat(60)}`,
    `SUMMARY`,
    `${"─".repeat(60)}`,
    `  Credit (old product):    -${formatCurrency(upgradeResult.credit.totalAmount, currency)}`,
    `  Charge (new product):     ${formatCurrency(upgradeResult.charge.totalAmount, currency)}`,
    `  NET AMOUNT:               ${formatCurrency(upgradeResult.netAmount, currency)}`,
    `${"─".repeat(60)}`,
    ``,
    `NOTES:`,
    ...notes.map((note, i) => `  ${i + 1}. ${note}`),
    `${"=".repeat(60)}`,
  ].join("\n");

  return {
    type: "UPGRADE_ADJUSTMENT",
    customerName,
    invoiceDate: changeDate,
    lineItems: [creditLine, chargeLine],
    totalAmount: upgradeResult.netAmount,
    currency,
    notes,
    formattedDraft,
  };
}
