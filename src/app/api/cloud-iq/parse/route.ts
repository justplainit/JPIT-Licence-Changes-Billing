import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { parseCloudIQNotification } from "@/lib/cloud-iq-parser";

// Detect state-change events from Cloud-iQ notifications
const EXPIRED_STATES = ["expired", "deleted", "disabled"];
const SUSPENDED_STATES = ["suspended"];
const ACTIVE_STATES = ["active"];

function parseStateChangeEvent(event: string): {
  isStateChange: boolean;
  fromState: string;
  toState: string;
  isCancellation: boolean;
  isSuspension: boolean;
  isReactivation: boolean;
} {
  // Match patterns like "State changed from Active to Expired"
  const match = event.match(/state\s+changed\s+from\s+(\w+)\s+to\s+(\w+)/i);
  if (!match) {
    return { isStateChange: false, fromState: "", toState: "", isCancellation: false, isSuspension: false, isReactivation: false };
  }
  const fromState = match[1].toLowerCase();
  const toState = match[2].toLowerCase();
  const isCancellation = EXPIRED_STATES.includes(toState);
  const isSuspension = SUSPENDED_STATES.includes(toState);
  const isReactivation = ACTIVE_STATES.includes(toState) && (EXPIRED_STATES.includes(fromState) || SUSPENDED_STATES.includes(fromState));
  return { isStateChange: true, fromState, toState, isCancellation, isSuspension, isReactivation };
}

export interface ParsedNotificationResult {
  notification: {
    time: string;
    event: string;
    changedBy: string;
    organization: string;
    cloudAccount: string;
    domain: string;
    subscriptionName: string;
    product: string;
    quantity: number;
    subscriptionId: string;
  };
  match: {
    customerId: string | null;
    customerName: string | null;
    subscriptionDbId: string | null;
    productId: string | null;
    productName: string | null;
    currentSeatCount: number | null;
    seatDifference: number | null;
    status: "matched" | "partial" | "new" | "no_change" | "cancellation" | "suspension" | "reactivation" | "new_subscription";
    details: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { text } = await request.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Notification text is required" },
        { status: 400 }
      );
    }

    const notifications = parseCloudIQNotification(text);

    if (notifications.length === 0) {
      return NextResponse.json(
        { error: "Could not parse any notifications from the provided text. Please paste the full Cloud-iQ notification email content." },
        { status: 400 }
      );
    }

    const results: ParsedNotificationResult[] = [];

    for (const notification of notifications) {
      // Parse the event for state changes (e.g. "State changed from Active to Expired")
      const stateChange = parseStateChangeEvent(notification.event);

      // Try to find the subscription by Microsoft Subscription ID
      // For state changes (expired/cancelled), also search non-ACTIVE subscriptions
      let subscription = null;
      if (notification.subscriptionId) {
        subscription = await prisma.subscription.findFirst({
          where: { microsoftSubId: notification.subscriptionId },
          include: {
            customer: true,
            product: true,
          },
        });
      }

      // If no match by subscriptionId, try matching by customer name + product name
      if (!subscription && notification.cloudAccount) {
        const customer = await prisma.customer.findFirst({
          where: {
            name: { contains: notification.cloudAccount, mode: "insensitive" },
          },
        });

        if (customer) {
          const product = await prisma.product.findFirst({
            where: {
              name: { contains: notification.product, mode: "insensitive" },
            },
          });

          if (product) {
            // For cancellations/expirations, also look for ACTIVE subscriptions to cancel
            subscription = await prisma.subscription.findFirst({
              where: {
                customerId: customer.id,
                productId: product.id,
                status: stateChange.isCancellation ? "ACTIVE" : "ACTIVE",
              },
              include: {
                customer: true,
                product: true,
              },
            });
          }
        }
      }

      if (subscription) {
        // Check for state change events FIRST (these take priority over seat comparisons)
        if (stateChange.isStateChange && stateChange.isCancellation) {
          results.push({
            notification,
            match: {
              customerId: subscription.customerId,
              customerName: subscription.customer.name,
              subscriptionDbId: subscription.id,
              productId: subscription.productId,
              productName: subscription.product.name,
              currentSeatCount: subscription.seatCount,
              seatDifference: null,
              status: "cancellation",
              details: `Subscription EXPIRED/CANCELLED: ${subscription.product.name} (${subscription.seatCount} seats). Event: ${notification.event}. This subscription must be removed from billing.`,
            },
          });
          continue;
        }

        if (stateChange.isStateChange && stateChange.isSuspension) {
          results.push({
            notification,
            match: {
              customerId: subscription.customerId,
              customerName: subscription.customer.name,
              subscriptionDbId: subscription.id,
              productId: subscription.productId,
              productName: subscription.product.name,
              currentSeatCount: subscription.seatCount,
              seatDifference: null,
              status: "suspension",
              details: `Subscription SUSPENDED: ${subscription.product.name} (${subscription.seatCount} seats). Event: ${notification.event}. Review billing — subscription may need to be paused.`,
            },
          });
          continue;
        }

        // Normal seat comparison
        const seatDifference = notification.quantity - subscription.seatCount;
        const status = seatDifference === 0 ? "no_change" : "matched";
        let details = "";

        if (seatDifference > 0) {
          details = `Seat increase detected: ${subscription.seatCount} → ${notification.quantity} (+${seatDifference} seats)`;
        } else if (seatDifference < 0) {
          details = `Seat decrease detected: ${subscription.seatCount} → ${notification.quantity} (${seatDifference} seats)`;
        } else {
          details = `No seat change. Current: ${subscription.seatCount}, Cloud-iQ: ${notification.quantity}. Event: ${notification.event}`;
        }

        results.push({
          notification,
          match: {
            customerId: subscription.customerId,
            customerName: subscription.customer.name,
            subscriptionDbId: subscription.id,
            productId: subscription.productId,
            productName: subscription.product.name,
            currentSeatCount: subscription.seatCount,
            seatDifference,
            status,
            details,
          },
        });
      } else {
        // Try partial match — find customer or product individually
        const customer = await prisma.customer.findFirst({
          where: {
            name: { contains: notification.cloudAccount, mode: "insensitive" },
          },
        });

        const product = await prisma.product.findFirst({
          where: {
            name: { contains: notification.product, mode: "insensitive" },
          },
        });

        const hasAnyMatch = customer || product;
        // Offer to create a subscription whenever both customer and product are
        // resolved — regardless of the exact event wording. Crayon may send
        // "State changed from Pending to Active" or other variants for new subs.
        const isNewSubscriptionEvent = /new subscription.*was created/i.test(notification.event);
        const isNewSub = !!(customer && product);

        results.push({
          notification,
          match: {
            customerId: customer?.id ?? null,
            customerName: customer?.name ?? null,
            subscriptionDbId: null,
            productId: product?.id ?? null,
            productName: product?.name ?? null,
            currentSeatCount: null,
            seatDifference: null,
            status: isNewSub ? "new_subscription" : hasAnyMatch ? "partial" : "new",
            details: isNewSub
              ? (isNewSubscriptionEvent
                  ? `New subscription detected: ${customer!.name} – ${product!.name}. Ready to create subscription and set up billing.`
                  : `No existing subscription found for ${customer!.name} – ${product!.name}. You can create it as a new subscription.`)
              : hasAnyMatch
                ? `Partial match: ${customer ? "Customer found" : "Customer not found"}, ${product ? "Product found" : "Product not found"}. No matching active subscription.`
                : `No matching customer or product found. Customer: "${notification.cloudAccount}", Product: "${notification.product}"`,
          },
        });
      }
    }

    // Log the parse action
    await prisma.auditLog.create({
      data: {
        userId: session.user!.id!,
        action: "CLOUD_IQ_PARSE",
        entityType: "CloudIQNotification",
        entityId: "batch",
        details: `Parsed ${notifications.length} Cloud-iQ notification(s). Matched: ${results.filter((r) => r.match.status === "matched").length}, No change: ${results.filter((r) => r.match.status === "no_change").length}, Partial: ${results.filter((r) => r.match.status === "partial").length}, New: ${results.filter((r) => r.match.status === "new").length}`,
      },
    });

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Error parsing Cloud-iQ notification:", error);
    return NextResponse.json(
      { error: "Failed to parse notification" },
      { status: 500 }
    );
  }
}
