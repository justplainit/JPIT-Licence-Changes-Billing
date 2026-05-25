import { prisma } from "@/lib/prisma";

export interface RenewalRollResult {
  subscriptionId: string;
  customerName: string;
  productName: string;
  termType: string;
  oldRenewalDate: string;
  newRenewalDate: string;
}

/**
 * Rolls forward renewal dates for all active subscriptions whose renewalDate
 * is in the past. Runs daily via cron — covers monthly subs that have no
 * scheduled changes and therefore never got their date advanced.
 */
export async function rollForwardOverdueRenewalDates(): Promise<{
  updated: RenewalRollResult[];
}> {
  const now = new Date();

  const stale = await prisma.subscription.findMany({
    where: {
      status: { in: ["ACTIVE", "SUSPENDED"] },
      renewalDate: { lt: now },
    },
    include: { customer: true, product: true },
  });

  const updated: RenewalRollResult[] = [];

  for (const sub of stale) {
    const oldRenewalDate = new Date(sub.renewalDate);
    let newRenewalDate = new Date(sub.renewalDate);

    while (newRenewalDate <= now) {
      if (sub.termType === "THREE_YEAR") {
        newRenewalDate.setFullYear(newRenewalDate.getFullYear() + 3);
      } else if (sub.termType === "ANNUAL") {
        newRenewalDate.setFullYear(newRenewalDate.getFullYear() + 1);
      } else {
        newRenewalDate.setMonth(newRenewalDate.getMonth() + 1);
      }
    }

    await prisma.subscription.update({
      where: { id: sub.id },
      data: { renewalDate: newRenewalDate, termEndDate: newRenewalDate },
    });

    updated.push({
      subscriptionId: sub.id,
      customerName: sub.customer.name,
      productName: sub.product.name,
      termType: sub.termType,
      oldRenewalDate: oldRenewalDate.toISOString(),
      newRenewalDate: newRenewalDate.toISOString(),
    });
  }

  return { updated };
}

export interface ApplyResult {
  scheduledChangeId: string;
  customerName: string;
  productName: string;
  previousSeatCount: number;
  newSeatCount: number;
  newRenewalDate: string;
}

export async function applyScheduledChange(scheduledChangeId: string): Promise<ApplyResult> {
  return prisma.$transaction(async (tx) => {
    const sc = await tx.scheduledChange.findUnique({
      where: { id: scheduledChangeId },
      include: {
        subscription: { include: { customer: true, product: true } },
      },
    });

    if (!sc) throw new Error(`Scheduled change not found: ${scheduledChangeId}`);
    if (sc.status !== "PENDING") throw new Error(`Already ${sc.status}`);

    const subscription = sc.subscription;
    const previousSeatCount = subscription.seatCount;
    const newSeatCount = sc.targetSeatCount ?? subscription.seatCount;
    const now = new Date();

    // Roll renewal date forward until it's in the future
    let newRenewalDate = new Date(subscription.renewalDate);
    while (newRenewalDate <= now) {
      if (subscription.termType === "THREE_YEAR") {
        newRenewalDate.setFullYear(newRenewalDate.getFullYear() + 3);
      } else if (subscription.termType === "ANNUAL") {
        newRenewalDate.setFullYear(newRenewalDate.getFullYear() + 1);
      } else {
        newRenewalDate.setMonth(newRenewalDate.getMonth() + 1);
      }
    }

    await tx.subscription.update({
      where: { id: subscription.id },
      data: {
        seatCount: newSeatCount,
        renewalDate: newRenewalDate,
        termEndDate: newRenewalDate,
      },
    });

    await tx.scheduledChange.update({
      where: { id: sc.id },
      data: { status: "ACTIONED", actionedAt: now },
    });

    // Complete any pending scheduled amendment queue items for this product
    await tx.amendmentQueueItem.updateMany({
      where: {
        customerId: subscription.customerId,
        productName: subscription.product.name,
        isCompleted: false,
        isScheduledChange: true,
      },
      data: { isCompleted: true, completedAt: now },
    });

    return {
      scheduledChangeId: sc.id,
      customerName: subscription.customer.name,
      productName: subscription.product.name,
      previousSeatCount,
      newSeatCount,
      newRenewalDate: newRenewalDate.toISOString(),
    };
  });
}

export async function applyAllOverdueScheduledChanges(): Promise<{
  processed: ApplyResult[];
  errors: Array<{ id: string; error: string }>;
}> {
  const now = new Date();

  const due = await prisma.scheduledChange.findMany({
    where: { status: "PENDING", scheduledDate: { lte: now } },
    select: { id: true },
  });

  const processed: ApplyResult[] = [];
  const errors: Array<{ id: string; error: string }> = [];

  for (const { id } of due) {
    try {
      processed.push(await applyScheduledChange(id));
    } catch (err) {
      errors.push({ id, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  return { processed, errors };
}
