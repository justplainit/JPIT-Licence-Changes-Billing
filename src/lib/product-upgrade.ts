import { format } from "date-fns";
import type { Prisma } from "@/generated/prisma";
import { calculateUpgradeCost, formatCurrency } from "./billing-calculations";
import { generateUpgradeInvoiceDraft } from "./invoice-generator";

/**
 * Upgrade a subscription to another product (e.g. Business Standard →
 * Business Premium) from the change date: credit the old product and charge
 * the new one for the rest of the month, and update the repeating invoice
 * from next month. The term and renewal date stay the same. Shared by Log
 * Change and the Cloud-iQ apply flow so both bill an upgrade the same way.
 */
export async function applyProductUpgrade(
  tx: Prisma.TransactionClient,
  params: {
    subscription: {
      id: string;
      customerId: string;
      productId: string;
      seatCount: number;
      renewalDate?: Date;
      customer: { name: string; currency: string | null };
      product: { name: string };
    };
    newProduct: { id: string; name: string };
    changeDate: Date;
    userId: string;
    notes?: string | null;
    auditAction: string;
  }
) {
  const { subscription, newProduct, changeDate, userId, notes, auditAction } = params;

  const priceFor = (productId: string) =>
    tx.customerPrice.findFirst({
      where: { customerId: subscription.customerId, productId, effectiveTo: null },
      orderBy: { effectiveFrom: "desc" },
    });
  const oldPrice = await priceFor(subscription.productId);
  const newPrice = await priceFor(newProduct.id);
  const oldPricePerSeat = oldPrice?.pricePerSeat ?? 0;
  const newPricePerSeat = newPrice?.pricePerSeat ?? 0;
  const currency = oldPrice?.currency ?? newPrice?.currency ?? subscription.customer.currency ?? "ZAR";
  const seats = subscription.seatCount;

  const upgradeResult = calculateUpgradeCost({
    oldPricePerSeat,
    newPricePerSeat,
    seats,
    changeDate,
  });

  const change = await tx.subscriptionChange.create({
    data: {
      subscriptionId: subscription.id,
      changeType: "UPGRADE",
      status: "APPLIED",
      effectiveDate: changeDate,
      previousSeatCount: seats,
      newSeatCount: seats,
      previousProductId: subscription.productId,
      newProductId: newProduct.id,
      proRataAmount: upgradeResult.netAmount,
      billingCurrency: currency,
      notes,
      createdById: userId,
    },
  });

  const upgradeDraft = generateUpgradeInvoiceDraft({
    customerName: subscription.customer.name,
    oldProductName: subscription.product.name,
    newProductName: newProduct.name,
    oldPricePerSeat,
    newPricePerSeat,
    seats,
    changeDate,
    currency,
  });

  await tx.invoiceDraft.create({
    data: {
      customerId: subscription.customerId,
      changeId: change.id,
      draftType: "UPGRADE_ADJUSTMENT",
      invoiceDate: changeDate,
      totalAmount: upgradeDraft.totalAmount,
      currency,
      notes: upgradeDraft.notes.join("\n"),
      lineItems: {
        create: upgradeDraft.lineItems.map((item, index) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
          calculationBreakdown: item.calculationBreakdown,
          sortOrder: index,
        })),
      },
    },
  });

  await tx.subscription.update({
    where: { id: subscription.id },
    data: { productId: newProduct.id },
  });

  const nextMonth = new Date(changeDate.getFullYear(), changeDate.getMonth() + 1, 1);
  const dateStr = format(changeDate, "d MMMM yyyy");
  const month = format(changeDate, "MMMM");
  const nextMonthName = format(nextMonth, "MMMM yyyy");
  const missingPrices = [
    !oldPricePerSeat && subscription.product.name,
    !newPricePerSeat && newProduct.name,
  ].filter(Boolean);

  const { credit, charge } = upgradeResult;
  const period = `${format(changeDate, "d")}–${format(credit.periodEnd, "d MMM yyyy")}`;
  const days = `${charge.daysRemaining}/${charge.daysInMonth} days`;
  // Microsoft's billing month runs from the subscription's anniversary day.
  // The amounts here assume it starts on the 1st.
  const anniversaryDay = subscription.renewalDate?.getDate();
  const offCycle = anniversaryDay !== undefined && anniversaryDay !== 1;

  const task = {
    description: [
      `PRODUCT UPGRADE for ${subscription.customer.name}: ${subscription.product.name} → ${newProduct.name}`,
      `${seats} seat${seats !== 1 ? "s" : ""} · upgraded on ${dateStr} · term and renewal date unchanged`,
      ``,
      `HOW CRAYON BILLS THIS`,
      `Microsoft credits the unused ${subscription.product.name} days and charges`,
      `${newProduct.name} for the same days (${period}). Both show on`,
      `Crayon's invoice for ${month} as a pair of upgrade ("convert") lines; from`,
      `next month Crayon bills only ${newProduct.name}.`,
      ``,
      `1. ONE-TIME UPGRADE INVOICE in Xero — pass the same on to the customer:`,
      `     Line 1: ${subscription.product.name} – credit ${period} (${days})`,
      `             Qty ${seats} × −${formatCurrency(credit.perSeatProRata, currency)} = −${formatCurrency(credit.totalAmount, currency)}`,
      `     Line 2: ${newProduct.name} – ${period} (${days})`,
      `             Qty ${seats} × ${formatCurrency(charge.perSeatProRata, currency)} = ${formatCurrency(charge.totalAmount, currency)}`,
      `     Total: ${formatCurrency(upgradeResult.netAmount, currency)} excl VAT`,
      `   Leave ${month}'s repeating invoice as it is — line 1 already credits the`,
      `   ${subscription.product.name} days it covered.`,
      ``,
      `2. REPEATING INVOICE from ${nextMonthName}: replace ${subscription.product.name}`,
      `   with ${newProduct.name}, ${seats} seat${seats !== 1 ? "s" : ""} = ${formatCurrency(newPricePerSeat * seats, currency)}/month (${seats} × ${formatCurrency(newPricePerSeat, currency)}).`,
      ...(offCycle
        ? [``, `⚠ This subscription renews on day ${anniversaryDay} of the month, so Crayon's billing month`, `runs from day ${anniversaryDay}, not the 1st — check the days against Crayon's invoice.`]
        : []),
      ...(missingPrices.length
        ? [``, `⚠ No price in the system for ${missingPrices.join(" and ")} — work these amounts out from your own pricing.`]
        : []),
    ].join("\n"),
    productName: newProduct.name,
    newMonthlyAmount: newPricePerSeat * seats,
    newSeatCount: seats,
    // The one-time invoice is due now; the repeating invoice by next month.
    actionByDate: changeDate,
    reason: `Product upgrade: ${subscription.product.name} → ${newProduct.name} effective ${changeDate.toISOString().split("T")[0]} · net ${formatCurrency(upgradeResult.netAmount, currency)} for the rest of ${month}`,
    proRataAmount: upgradeResult.netAmount,
  };

  await tx.amendmentQueueItem.create({
    data: { customerId: subscription.customerId, ...task },
  });

  await tx.auditLog.create({
    data: {
      userId,
      action: auditAction,
      entityType: "Subscription",
      entityId: subscription.id,
      details: `Upgraded from ${subscription.product.name} to ${newProduct.name} (${seats} seats). Net adjustment: ${upgradeResult.netAmount} ${currency}${notes ? `. ${notes}` : ""}`,
      proRataAmount: upgradeResult.netAmount,
      xeroInstructionsGen: true,
    },
  });

  return { change, upgradeResult, upgradeDraft, task, currency };
}
