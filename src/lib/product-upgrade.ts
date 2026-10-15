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

  const task = {
    description: [
      `PRODUCT UPGRADE for ${subscription.customer.name}: ${subscription.product.name} → ${newProduct.name}`,
      ``,
      `Seats: ${seats} · Upgraded on ${dateStr}`,
      ``,
      `1. UPGRADE ADJUSTMENT INVOICE for the rest of ${month}:`,
      `     credit ${subscription.product.name}: ${formatCurrency(upgradeResult.credit.totalAmount, currency)}`,
      `     charge ${newProduct.name}: ${formatCurrency(upgradeResult.charge.totalAmount, currency)}`,
      `     net: ${formatCurrency(upgradeResult.netAmount, currency)}`,
      `2. UPDATE THE REPEATING INVOICE from ${nextMonthName}:`,
      `     replace ${subscription.product.name} with ${newProduct.name}, ${seats} seats`,
      `     = ${formatCurrency(newPricePerSeat * seats, currency)}/month (${seats} × ${formatCurrency(newPricePerSeat, currency)})`,
      ...(missingPrices.length
        ? [``, `⚠ No price in the system for ${missingPrices.join(" and ")} — work the amounts out from your own pricing.`]
        : []),
    ].join("\n"),
    productName: newProduct.name,
    newMonthlyAmount: newPricePerSeat * seats,
    newSeatCount: seats,
    actionByDate: nextMonth,
    reason: `Product upgrade: ${subscription.product.name} → ${newProduct.name} effective ${changeDate.toISOString().split("T")[0]}`,
    proRataFraction: Math.round((upgradeResult.charge.daysRemaining / upgradeResult.charge.daysInMonth) * 100) / 100,
    proRataDays: upgradeResult.charge.daysRemaining,
    proRataDaysInMonth: upgradeResult.charge.daysInMonth,
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
