import type { Prisma } from "@/generated/prisma";

/**
 * Marker stored in a change's notes recording the Cloud-iQ email's own
 * timestamp. Needed where the change's effectiveDate is not the email time
 * (e.g. a reduction scheduled for renewal).
 */
export function notifiedMarker(eventTime: Date): string {
  return `Notified: ${eventTime.toISOString()}`;
}

/**
 * Find a change already applied from this exact Cloud-iQ email — same
 * subscription, same event text, same email timestamp (not the time it was
 * parsed). Undone changes are CANCELLED and ignored, so an email can be
 * applied again after its change was undone.
 *
 * Immediate changes store the email time as their effectiveDate; scheduled
 * ones carry it in their notes via notifiedMarker().
 */
export async function findAppliedChangeForNotification(
  db: Prisma.TransactionClient,
  params: { subscriptionId: string; eventTime: Date; event: string }
) {
  const { subscriptionId, eventTime, event } = params;
  if (!event || isNaN(eventTime.getTime())) return null;

  return db.subscriptionChange.findFirst({
    where: {
      subscriptionId,
      status: { not: "CANCELLED" },
      AND: [
        { notes: { contains: `Event: ${event}` } },
        {
          OR: [
            { effectiveDate: eventTime },
            { notes: { contains: notifiedMarker(eventTime) } },
          ],
        },
      ],
    },
    include: { createdBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
}
