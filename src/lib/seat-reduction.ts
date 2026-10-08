import { format } from "date-fns";
import type { Prisma } from "@/generated/prisma";
import {
  calculate7DayWindow,
  calculateSeatReductionCredit,
  formatCurrency,
  getMostRecentRenewalDate,
} from "./billing-calculations";

type TermType = "MONTHLY" | "ANNUAL" | "THREE_YEAR";

/**
 * The 7-day (168h) window opened by the most recent renewal on or before the
 * change date. NCE allows seat reductions at renewal and within this window.
 */
export function getRenewalWindow(
  renewalDate: Date,
  termType: TermType,
  changeDate: Date
): { termStart: Date; closesAt: Date; isOpen: boolean } {
  const termStart = getMostRecentRenewalDate(renewalDate, termType, changeDate);
  const { closesAt } = calculate7DayWindow(termStart);
  return { termStart, closesAt, isOpen: changeDate < closesAt };
}

/**
 * Refuse to schedule a seat reduction that is already pending for the same
 * subscription, target seat count and date — e.g. the same Cloud-iQ email
 * applied twice, or a reduction logged again by hand. Throwing rolls back the
 * surrounding transaction, so nothing is created and the message is shown.
 */
export async function assertReductionNotAlreadyScheduled(
  tx: Prisma.TransactionClient,
  subscriptionId: string,
  targetSeatCount: number,
  scheduledDate: Date
): Promise<void> {
  const dayStart = new Date(scheduledDate.getFullYear(), scheduledDate.getMonth(), scheduledDate.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const existing = await tx.scheduledChange.findFirst({
    where: {
      subscriptionId,
      changeType: "REMOVE_SEATS",
      targetSeatCount,
      status: "PENDING",
      scheduledDate: { gte: dayStart, lt: dayEnd },
    },
  });

  if (existing) {
    throw new Error(
      `Already scheduled: a reduction to ${targetSeatCount} seat${targetSeatCount !== 1 ? "s" : ""} on ${format(scheduledDate, "d MMMM yyyy")} is already pending for this subscription. Nothing new was created.`
    );
  }
}

/**
 * Apply a seat reduction that takes effect at a renewal: on the renewal date
 * or inside the 7-day window it opens. Such a reduction has already taken
 * effect for the new term, so it is applied immediately — never pushed out to
 * the following renewal. Shared by the Cloud-iQ apply flow and Log Change so
 * both follow the same rules.
 */
export async function applyReductionAtRenewal(
  tx: Prisma.TransactionClient,
  params: {
    subscription: {
      id: string;
      customerId: string;
      renewalDate: Date;
      termType: TermType;
      customer: { name: string };
      product: { name: string };
    };
    previousSeatCount: number;
    newSeatCount: number;
    pricePerSeat: number;
    currency: string;
    changeDate: Date;
    userId: string;
    /** The change came from "Partner Center synchronization" — i.e. the renewal itself. */
    isRenewalSync: boolean;
    /** Where the change came from, e.g. "Applied from Cloud-iQ notification". */
    origin: string;
    /** Appended to the change notes / audit details, e.g. the Cloud-iQ event. */
    detail: string;
    auditAction: string;
  }
) {
  const {
    subscription,
    previousSeatCount,
    newSeatCount,
    pricePerSeat,
    currency,
    changeDate,
    userId,
    isRenewalSync,
    origin,
    detail,
    auditAction,
  } = params;

  const seatsRemoved = previousSeatCount - newSeatCount;
  const window = getRenewalWindow(subscription.renewalDate, subscription.termType, changeDate);

  // A renewal sync outside the window computed from our stored renewal date
  // means that stored date is wrong: Partner Center renewed on the change date.
  // Use that date and flag the stored one for correction.
  const storedRenewalWrong = isRenewalSync && !window.isOpen;
  const renewalDay = window.isOpen
    ? window.termStart
    : new Date(changeDate.getFullYear(), changeDate.getMonth(), changeDate.getDate());
  const termStartStr = format(renewalDay, "d MMMM yyyy");
  const storedRenewalStr = format(subscription.renewalDate, "d MMMM yyyy");
  const dateStr = format(changeDate, "d MMMM yyyy");
  const monthName = format(changeDate, "MMMM");
  const renewalDateWarning = storedRenewalWrong
    ? [
        ``,
        `⚠ CHECK RENEWAL DATE: the app has this subscription's renewal date as`,
        `${storedRenewalStr}, but Partner Center renewed it on ${termStartStr}.`,
        `Correct the renewal date on the subscription so future changes are scheduled correctly.`,
      ]
    : [];
  const newMonthlyTotal = pricePerSeat * newSeatCount;
  const creditResult = calculateSeatReductionCredit({
    pricePerSeat,
    seatsRemoved,
    reductionDate: changeDate,
  });

  await tx.subscription.update({
    where: { id: subscription.id },
    data: { seatCount: newSeatCount },
  });

  // A reduction to this seat count may already have been scheduled for this
  // renewal. It has now happened: mark it actioned.
  await tx.scheduledChange.updateMany({
    where: {
      subscriptionId: subscription.id,
      changeType: "REMOVE_SEATS",
      targetSeatCount: newSeatCount,
      status: "PENDING",
    },
    data: { status: "ACTIONED", actionedAt: new Date() },
  });

  // Record the change as applied, reusing the newest matching scheduled record
  // so there is one history entry and Undo restores the right seat count. Any
  // further matching schedules (e.g. the same notification applied twice) are
  // duplicates and are cancelled.
  const changeData = {
    status: "APPLIED" as const,
    effectiveDate: changeDate,
    previousSeatCount,
    newSeatCount,
    billingCurrency: currency,
    notes: `${origin} – reduction at renewal (term started ${termStartStr})${isRenewalSync ? " via Partner Center synchronization" : ""}.${storedRenewalWrong ? ` Stored renewal date (${storedRenewalStr}) disagrees with the Partner Center renewal.` : ""}${detail ? ` ${detail}` : ""}`,
  };
  const scheduledRecords = await tx.subscriptionChange.findMany({
    where: {
      subscriptionId: subscription.id,
      changeType: "REMOVE_SEATS",
      status: "SCHEDULED",
      newSeatCount,
    },
    orderBy: { createdAt: "desc" },
  });
  const [reused, ...duplicates] = scheduledRecords;
  if (reused) {
    await tx.subscriptionChange.update({ where: { id: reused.id }, data: changeData });
  } else {
    await tx.subscriptionChange.create({
      data: {
        ...changeData,
        subscriptionId: subscription.id,
        changeType: "REMOVE_SEATS",
        createdById: userId,
      },
    });
  }
  for (const dup of duplicates) {
    await tx.subscriptionChange.update({
      where: { id: dup.id },
      data: {
        status: "CANCELLED",
        notes: `${dup.notes ?? ""} [DUPLICATE: superseded by the reduction applied at the ${termStartStr} renewal]`.trim(),
      },
    });
  }

  // Retire any pending "reduce at renewal" task for this reduction — it is
  // replaced by the immediate tasks below.
  const pendingScheduledTasks = await tx.amendmentQueueItem.findMany({
    where: {
      customerId: subscription.customerId,
      productName: subscription.product.name,
      isScheduledChange: true,
      newSeatCount,
      isCompleted: false,
    },
  });
  for (const task of pendingScheduledTasks) {
    await tx.amendmentQueueItem.update({
      where: { id: task.id },
      data: {
        isCompleted: true,
        completedAt: new Date(),
        reason: task.reason + " [SUPERSEDED: reduction applied at renewal]",
      },
    });
  }

  const tasks = [
    {
      description: [
        `UPDATE REPEATING INVOICE for ${subscription.customer.name} in Xero NOW`,
        ``,
        `Product: ${subscription.product.name}`,
        `Change: ${previousSeatCount} seats → ${newSeatCount} seats (remove ${seatsRemoved})`,
        `Took effect: ${dateStr} (at the ${termStartStr} renewal)`,
        ``,
        `New monthly amount: ${formatCurrency(newMonthlyTotal, currency)} (${newSeatCount} × ${formatCurrency(pricePerSeat, currency)})`,
        ``,
        `The reduction applies to the current term, so update the repeating`,
        `invoice now — the next invoice must go out at ${newSeatCount} seats.`,
        ...renewalDateWarning,
      ].join("\n"),
      productName: subscription.product.name,
      newMonthlyAmount: newMonthlyTotal,
      newSeatCount,
      actionByDate: changeDate,
      reason: `Reduction at renewal: ${previousSeatCount} → ${newSeatCount} effective ${dateStr}`,
    },
    {
      description: [
        `CHECK: CREDIT NOTE MAY BE NEEDED for ${subscription.customer.name}`,
        ``,
        `Product: ${subscription.product.name}`,
        `Seats removed at renewal: ${seatsRemoved}`,
        `Period: ${format(creditResult.periodStart, "d MMM")} – ${format(creditResult.periodEnd, "d MMM yyyy")}`,
        ``,
        `  • IF the ${monthName} invoice was ALREADY SENT at ${previousSeatCount} seats →`,
        `      issue a credit note for ${formatCurrency(creditResult.totalCredit, currency)}`,
        `      (${seatsRemoved} × ${formatCurrency(creditResult.perSeatCredit, currency)} for the rest of ${monthName}).`,
        `  • IF it was NOT sent yet →`,
        `      no credit needed; just make sure it goes out at ${newSeatCount} seats.`,
      ].join("\n"),
      productName: subscription.product.name,
      newMonthlyAmount: -creditResult.totalCredit,
      newSeatCount: seatsRemoved,
      actionByDate: changeDate,
      reason: `Possible credit for ${seatsRemoved} seat${seatsRemoved !== 1 ? "s" : ""} removed at renewal – ${subscription.customer.name}`,
    },
  ];

  for (const task of tasks) {
    await tx.amendmentQueueItem.create({
      data: { customerId: subscription.customerId, ...task },
    });
  }

  await tx.auditLog.create({
    data: {
      userId,
      action: auditAction,
      entityType: "Subscription",
      entityId: subscription.id,
      details: `Reduction at renewal applied immediately (${previousSeatCount} → ${newSeatCount}), term started ${termStartStr}${isRenewalSync ? " (Partner Center synchronization)" : ""}.${storedRenewalWrong ? ` Stored renewal date ${storedRenewalStr} needs correcting.` : ""} Possible credit ${formatCurrency(creditResult.totalCredit, currency)} if ${monthName} was already invoiced.${detail ? ` ${detail}` : ""}`,
      proRataAmount: -creditResult.totalCredit,
      sevenDayWindowOpen: true,
      xeroInstructionsGen: true,
    },
  });

  return {
    changeType: "REMOVE_SEATS" as const,
    withinWindow: true,
    customerName: subscription.customer.name,
    productName: subscription.product.name,
    previousSeatCount,
    newSeatCount,
    creditAmount: creditResult.totalCredit,
    currency,
    tasks: tasks.map((t) => ({
      description: t.description,
      actionByDate: t.actionByDate.toISOString(),
      reason: t.reason,
    })),
    message: `Reduction took effect at the ${termStartStr} renewal, so it has been applied immediately (${previousSeatCount} → ${newSeatCount}). Update the repeating invoice now; a credit note is only needed if ${monthName} was already invoiced at ${previousSeatCount} seats.${storedRenewalWrong ? ` Note: the app's stored renewal date (${storedRenewalStr}) disagrees with Partner Center — please correct it on the subscription.` : ""}`,
  };
}
