import { format } from "date-fns";
import type { Prisma } from "@/generated/prisma";
import {
  calculate7DayWindow,
  calculateSeatReductionCredit,
  formatCurrency,
} from "./billing-calculations";

/**
 * A new subscription is put on the repeating invoice by its "ADD TO REPEATING
 * INVOICE" task. Until that task is done the subscription isn't on the
 * repeating invoice, so seat changes in the meantime must change that task —
 * not add an "update the repeating invoice" task next to it, which would leave
 * the team with two tasks saying different seat counts.
 */

const ADD_TASK_PREFIX = "ADD TO REPEATING INVOICE";

/**
 * Tasks are replaced, not edited: the old one is closed with this marker and
 * a new one is created. Undoing the change reopens the tasks it marked (and
 * closes the ones it created), so Undo puts the queue back as it was.
 */
export const replacedByMarker = (changeId: string) => `[REPLACED by change ${changeId}]`;

async function replaceTask(
  tx: Prisma.TransactionClient,
  task: { id: string; reason: string; customerId: string; productName: string; actionByDate: Date; isScheduledChange: boolean; scheduledChangeId: string | null; proRataFraction: number | null; proRataDays: number | null; proRataDaysInMonth: number | null; proRataAmount: number | null; description: string; newMonthlyAmount: number; newSeatCount: number },
  changeId: string,
  why: string,
  replacement: Partial<{ description: string; newMonthlyAmount: number; newSeatCount: number; proRataAmount: number | null }> | null
) {
  await tx.amendmentQueueItem.update({
    where: { id: task.id },
    data: { isCompleted: true, completedAt: new Date(), reason: `${task.reason} ${replacedByMarker(changeId)} ${why}` },
  });
  if (!replacement) return;
  await tx.amendmentQueueItem.create({
    data: {
      customerId: task.customerId,
      productName: task.productName,
      actionByDate: task.actionByDate,
      reason: task.reason,
      isScheduledChange: task.isScheduledChange,
      scheduledChangeId: task.scheduledChangeId,
      proRataFraction: task.proRataFraction,
      proRataDays: task.proRataDays,
      proRataDaysInMonth: task.proRataDaysInMonth,
      proRataAmount: task.proRataAmount,
      description: task.description,
      newMonthlyAmount: task.newMonthlyAmount,
      newSeatCount: task.newSeatCount,
      ...replacement,
    },
  });
}
const UPDATE_TASK_PREFIX = "UPDATE REPEATING INVOICE";
const PRO_RATA_PREFIX = "SEND ONE-TIME PRO-RATA INVOICE";

/** Within the 7 days after purchase, any seat of a new subscription can be cancelled. */
export function isWithinPurchaseWindow(startDate: Date, changeDate: Date): boolean {
  return changeDate >= startDate && changeDate < calculate7DayWindow(startDate).closesAt;
}

/**
 * If the subscription's "ADD TO REPEATING INVOICE" task is still open, change
 * it to the new seat count (and close any open "update repeating invoice"
 * tasks for the product, which it replaces). Returns true when it did, so the
 * caller doesn't create a repeating-invoice task of its own.
 */
export async function updateOpenAddToRepeatingTask(
  tx: Prisma.TransactionClient,
  params: {
    customerId: string;
    productName: string;
    previousSeatCount: number;
    newSeatCount: number;
    pricePerSeat: number;
    currency: string;
    changeDate: Date;
    /** The change making this update (so Undo can put the task back). */
    changeId: string;
  }
): Promise<boolean> {
  const { customerId, productName, previousSeatCount, newSeatCount, pricePerSeat, currency, changeDate, changeId } = params;

  const addTask = await tx.amendmentQueueItem.findFirst({
    where: { customerId, productName, isCompleted: false, description: { startsWith: ADD_TASK_PREFIX } },
    orderBy: { createdAt: "desc" },
  });
  if (!addTask) return false;

  const monthly = pricePerSeat * newSeatCount;
  const updateLine = `Updated ${format(changeDate, "d MMM yyyy")}: ${previousSeatCount} → ${newSeatCount} seat${newSeatCount !== 1 ? "s" : ""}. Add the line with ${newSeatCount} seat${newSeatCount !== 1 ? "s" : ""}.`;
  const description = addTask.description
    .split("\n")
    .map((line) =>
      line.startsWith("Seats:")
        ? `Seats: ${newSeatCount}`
        : line.startsWith("Monthly amount:")
          ? `Monthly amount: ${formatCurrency(monthly, currency)} (${newSeatCount} × ${formatCurrency(pricePerSeat, currency)})`
          : line
    )
    .concat(["", updateLine])
    .join("\n");

  await replaceTask(tx, addTask, changeId, `[seats ${previousSeatCount} → ${newSeatCount}]`, {
    description,
    newSeatCount,
    newMonthlyAmount: monthly,
  });

  // Older "update repeating invoice" tasks for this product describe a
  // repeating invoice line that doesn't exist yet: the add task now has the
  // final seat count, so they are superseded.
  const stale = await tx.amendmentQueueItem.findMany({
    where: { customerId, productName, isCompleted: false, description: { startsWith: UPDATE_TASK_PREFIX } },
  });
  for (const task of stale) {
    await replaceTask(tx, task, changeId, `[SUPERSEDED: the "Add to repeating invoice" task now has ${newSeatCount} seats]`, null);
  }
  return true;
}

/**
 * A seat reduction within 7 days of buying a new subscription. All its seats
 * are still cancellable, so it takes effect now, and the seats cancelled are
 * treated as never sold: unsent pro-rata invoices are cut down (latest
 * additions first), the repeating-invoice task gets the new count, and a
 * credit note is only asked for seats on a pro-rata invoice already sent.
 */
export async function applyReductionWithinPurchaseWindow(
  tx: Prisma.TransactionClient,
  params: {
    subscription: {
      id: string;
      customerId: string;
      startDate: Date;
      customer: { name: string };
      product: { name: string };
    };
    previousSeatCount: number;
    newSeatCount: number;
    pricePerSeat: number;
    currency: string;
    changeDate: Date;
    userId: string;
    /** Where the change came from, e.g. "Applied from Cloud-iQ notification". */
    origin: string;
    /** Appended to the change notes / audit details, e.g. the Cloud-iQ event. */
    detail: string;
    auditAction: string;
  }
) {
  const { subscription, previousSeatCount, newSeatCount, pricePerSeat, currency, changeDate, userId, origin, detail, auditAction } = params;
  const customerId = subscription.customerId;
  const productName = subscription.product.name;
  const seatsRemoved = previousSeatCount - newSeatCount;
  const boughtStr = format(subscription.startDate, "d MMMM yyyy");
  const dateStr = format(changeDate, "d MMMM yyyy");
  const seatWord = (n: number) => `seat${n !== 1 ? "s" : ""}`;

  await tx.subscription.update({
    where: { id: subscription.id },
    data: { seatCount: newSeatCount },
  });

  const change = await tx.subscriptionChange.create({
    data: {
      subscriptionId: subscription.id,
      changeType: "REMOVE_SEATS",
      status: "APPLIED",
      effectiveDate: changeDate,
      previousSeatCount,
      newSeatCount,
      billingCurrency: currency,
      notes: `${origin} – reduced within 7 days of purchase (bought ${boughtStr}); cancelled seats are not billed.${detail ? ` ${detail}` : ""}`,
      createdById: userId,
    },
  });

  // Cut the unsent pro-rata invoices for this subscription down, starting
  // with the most recent additions.
  const openProRata = await tx.amendmentQueueItem.findMany({
    where: {
      customerId,
      productName,
      isCompleted: false,
      description: { startsWith: PRO_RATA_PREFIX },
      createdAt: { gte: new Date(subscription.startDate.getTime() - 60_000) },
    },
    orderBy: { createdAt: "desc" },
  });
  let toCancel = seatsRemoved;
  const adjusted: string[] = [];
  for (const task of openProRata) {
    if (toCancel <= 0) break;
    const seats = task.newSeatCount;
    if (seats <= 0) continue;
    const perSeat = (task.proRataAmount ?? task.newMonthlyAmount) / seats;
    const note = `Updated ${format(changeDate, "d MMM yyyy")}: ${Math.min(seats, toCancel)} ${seatWord(Math.min(seats, toCancel))} cancelled within 7 days of purchase.`;
    if (seats <= toCancel) {
      await replaceTask(tx, task, change.id, `[CANCELLED: ${seats} ${seatWord(seats)} removed within 7 days of purchase — don't send]`, null);
      adjusted.push(`pro-rata invoice for ${seats} ${seatWord(seats)} cancelled`);
      toCancel -= seats;
    } else {
      const remaining = seats - toCancel;
      const total = Math.round(perSeat * remaining * 100) / 100;
      const description = task.description
        .split("\n")
        .map((line) =>
          line.startsWith("Amount:")
            ? `Amount: ${formatCurrency(total, currency)} (incl. VAT to be added)`
            : line.startsWith("Reason:")
              ? line.replace(/\b\d+ (additional )?seats?\b/, (_m, extra = "") => `${remaining} ${extra}${seatWord(remaining)}`)
            : line.trim().startsWith("Total:")
              ? `  Total: ${formatCurrency(perSeat, currency)} × ${remaining} = ${formatCurrency(total, currency)}`
              : line
        )
        .concat(["", `${note} Invoice ${remaining} ${seatWord(remaining)}, not ${seats}.`])
        .join("\n");
      await replaceTask(tx, task, change.id, `[${seats} → ${remaining} ${seatWord(remaining)}]`, {
        description,
        newSeatCount: remaining,
        newMonthlyAmount: total,
        ...(task.proRataAmount !== null && { proRataAmount: total }),
      });
      adjusted.push(`pro-rata invoice changed from ${seats} to ${remaining} ${seatWord(remaining)}`);
      toCancel = 0;
    }
  }

  const tasks: Array<{ description: string; productName: string; newMonthlyAmount: number; newSeatCount: number; actionByDate: Date; reason: string }> = [];

  // Seats on a pro-rata invoice that was already sent need a credit note.
  if (toCancel > 0) {
    const credit = calculateSeatReductionCredit({ pricePerSeat, seatsRemoved: toCancel, reductionDate: changeDate });
    tasks.push({
      description: [
        `CREDIT NOTE for ${subscription.customer.name}`,
        ``,
        `Product: ${productName}`,
        `${toCancel} ${seatWord(toCancel)} cancelled on ${dateStr}, within 7 days of purchase (bought ${boughtStr}).`,
        ``,
        `  • IF the pro-rata invoice for these seats was ALREADY SENT →`,
        `      credit ${toCancel} × ${formatCurrency(credit.perSeatCredit, currency)} = ${formatCurrency(credit.totalCredit, currency)}`,
        `      (${format(credit.periodStart, "d MMM")} – ${format(credit.periodEnd, "d MMM yyyy")}).`,
        `  • IF it was NOT sent → no credit; invoice only ${newSeatCount} ${seatWord(newSeatCount)}.`,
        ...(pricePerSeat ? [] : [``, `⚠ No price in the system for ${productName} — work the amount out from your own pricing.`]),
      ].join("\n"),
      productName,
      newMonthlyAmount: -credit.totalCredit,
      newSeatCount: toCancel,
      actionByDate: changeDate,
      reason: `${toCancel} ${seatWord(toCancel)} cancelled within 7 days of purchase – ${subscription.customer.name}`,
    });
  }

  // The repeating invoice: change the pending "add" task, or — if it was
  // already done — ask for the line to be corrected before it goes out.
  const updatedAdd = await updateOpenAddToRepeatingTask(tx, {
    customerId,
    productName,
    previousSeatCount,
    newSeatCount,
    pricePerSeat,
    currency,
    changeDate,
    changeId: change.id,
  });
  if (!updatedAdd) {
    const monthly = pricePerSeat * newSeatCount;
    tasks.push({
      description: [
        `UPDATE REPEATING INVOICE for ${subscription.customer.name} in Xero NOW`,
        ``,
        `Product: ${productName}`,
        `Change: ${previousSeatCount} → ${newSeatCount} ${seatWord(newSeatCount)} (cancelled within 7 days of purchase)`,
        `Monthly amount: ${formatCurrency(monthly, currency)} (${newSeatCount} × ${formatCurrency(pricePerSeat, currency)})`,
        ``,
        `The subscription was already added to the repeating invoice at ${previousSeatCount} ${seatWord(previousSeatCount)}:`,
        `change the line to ${newSeatCount} before the next invoice goes out.`,
      ].join("\n"),
      productName,
      newMonthlyAmount: monthly,
      newSeatCount,
      actionByDate: changeDate,
      reason: `Reduced within 7 days of purchase: ${previousSeatCount} → ${newSeatCount} – ${subscription.customer.name}`,
    });
  }

  for (const task of tasks) {
    await tx.amendmentQueueItem.create({ data: { customerId, ...task } });
  }

  const done = [
    ...adjusted,
    ...(updatedAdd ? [`"Add to repeating invoice" task changed to ${newSeatCount} ${seatWord(newSeatCount)}`] : []),
  ];

  await tx.auditLog.create({
    data: {
      userId,
      action: auditAction,
      entityType: "Subscription",
      entityId: subscription.id,
      details: `Reduced within 7 days of purchase (${previousSeatCount} → ${newSeatCount}). ${done.join("; ") || "No open tasks to update"}.${detail ? ` ${detail}` : ""}`,
      sevenDayWindowOpen: true,
      xeroInstructionsGen: true,
    },
  });

  return {
    changeType: "REMOVE_SEATS" as const,
    withinWindow: true,
    customerName: subscription.customer.name,
    productName,
    previousSeatCount,
    newSeatCount,
    currency,
    tasks: tasks.map((t) => ({ description: t.description, actionByDate: t.actionByDate.toISOString(), reason: t.reason })),
    message: `Reduced within 7 days of purchase (bought ${boughtStr}), so ${previousSeatCount} → ${newSeatCount} applies now and the cancelled seats aren't billed. ${done.length ? `Updated: ${done.join("; ")}.` : ""}${toCancel > 0 ? ` A credit note task covers ${toCancel} ${seatWord(toCancel)} on a pro-rata invoice that was already sent.` : ""}`.trim(),
  };
}
