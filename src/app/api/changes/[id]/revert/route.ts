import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: changeId } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = body.reason || "Manual revert";

    const result = await prisma.$transaction(async (tx) => {
      // Fetch the change with all related data
      const change = await tx.subscriptionChange.findUnique({
        where: { id: changeId },
        include: {
          subscription: {
            include: { customer: true, product: true },
          },
          invoiceDraft: {
            include: { lineItems: true },
          },
          sevenDayWindow: true,
        },
      });

      if (!change) {
        throw new Error("Change not found");
      }

      if (change.status === "CANCELLED") {
        throw new Error("This change has already been reverted/cancelled");
      }

      const sub = change.subscription;
      const revertActions: string[] = [];

      // ================================================================
      // Revert based on change type
      // ================================================================

      if (change.changeType === "ADD_SEATS") {
        // Revert seat count back to previous
        if (change.previousSeatCount != null) {
          await tx.subscription.update({
            where: { id: sub.id },
            data: { seatCount: change.previousSeatCount },
          });
          revertActions.push(
            `Seat count reverted: ${change.newSeatCount} back to ${change.previousSeatCount}`
          );
        }
      } else if (change.changeType === "REMOVE_SEATS") {
        if (change.status === "APPLIED" && change.previousSeatCount != null) {
          // Was an immediate reduction (within 7-day window) — restore seats
          await tx.subscription.update({
            where: { id: sub.id },
            data: { seatCount: change.previousSeatCount },
          });
          revertActions.push(
            `Seat count restored: ${change.newSeatCount} back to ${change.previousSeatCount}`
          );
        }

        if (change.status === "SCHEDULED") {
          // Cancel any associated scheduled changes
          const scheduledChanges = await tx.scheduledChange.findMany({
            where: {
              subscriptionId: sub.id,
              changeType: "REMOVE_SEATS",
              targetSeatCount: change.newSeatCount,
              status: "PENDING",
            },
          });

          for (const sc of scheduledChanges) {
            await tx.scheduledChange.update({
              where: { id: sc.id },
              data: { status: "CANCELLED" },
            });
            revertActions.push(`Cancelled scheduled change: ${sc.id}`);
          }
        }
      } else if (change.changeType === "CANCELLATION") {
        // Re-activate subscription
        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            status: "ACTIVE",
            ...(change.previousSeatCount != null && {
              seatCount: change.previousSeatCount,
            }),
          },
        });
        revertActions.push(
          `Subscription reactivated to ACTIVE (${change.previousSeatCount ?? sub.seatCount} seats)`
        );
      } else if (
        change.changeType === "UPGRADE" ||
        change.changeType === "DOWNGRADE"
      ) {
        // Revert product
        if (change.previousProductId) {
          await tx.subscription.update({
            where: { id: sub.id },
            data: { productId: change.previousProductId },
          });
          revertActions.push(
            `Product reverted to previous: ${change.previousProductId}`
          );
        }
      }

      // ================================================================
      // Clean up related records
      // ================================================================

      // Mark change as cancelled
      await tx.subscriptionChange.update({
        where: { id: changeId },
        data: {
          status: "CANCELLED",
          notes: `${change.notes || ""}\n\n[REVERTED] ${reason} — by ${session.user!.name || session.user!.email} on ${new Date().toISOString()}`,
        },
      });
      revertActions.push("Change status set to CANCELLED");

      // Close 7-day window if one was created
      if (change.sevenDayWindow) {
        await tx.sevenDayWindow.update({
          where: { id: change.sevenDayWindow.id },
          data: { isClosed: true },
        });
        revertActions.push("Associated 7-day window closed");
      }

      // Delete invoice draft and line items
      if (change.invoiceDraft) {
        await tx.invoiceLineItem.deleteMany({
          where: { invoiceDraftId: change.invoiceDraft.id },
        });
        await tx.invoiceDraft.delete({
          where: { id: change.invoiceDraft.id },
        });
        revertActions.push(
          `Deleted invoice draft: ${change.invoiceDraft.draftType} (${change.invoiceDraft.totalAmount})`
        );
      }

      // Find and mark related amendment queue items as completed
      // Match by customer + product + approximate creation time
      const amendmentWindow = new Date(change.createdAt);
      amendmentWindow.setMinutes(amendmentWindow.getMinutes() - 1);
      const amendmentWindowEnd = new Date(change.createdAt);
      amendmentWindowEnd.setMinutes(amendmentWindowEnd.getMinutes() + 1);

      const relatedAmendments = await tx.amendmentQueueItem.findMany({
        where: {
          customerId: sub.customerId,
          productName: sub.product.name,
          isCompleted: false,
          createdAt: {
            gte: amendmentWindow,
            lte: amendmentWindowEnd,
          },
        },
      });

      for (const amendment of relatedAmendments) {
        await tx.amendmentQueueItem.update({
          where: { id: amendment.id },
          data: {
            isCompleted: true,
            completedAt: new Date(),
          },
        });
        revertActions.push(`Marked amendment as completed: ${amendment.id}`);
      }

      // Audit log
      await tx.auditLog.create({
        data: {
          userId: session.user!.id!,
          action: "REVERT_CHANGE",
          entityType: "SubscriptionChange",
          entityId: changeId,
          details: [
            `Reverted ${change.changeType} for ${sub.customer.name} – ${sub.product.name}`,
            `Reason: ${reason}`,
            `Actions taken:`,
            ...revertActions.map((a) => `  - ${a}`),
          ].join("\n"),
        },
      });

      return {
        changeId,
        changeType: change.changeType,
        customerName: sub.customer.name,
        productName: sub.product.name,
        revertActions,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error reverting change:", error);
    const message =
      error instanceof Error ? error.message : "Failed to revert change";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
