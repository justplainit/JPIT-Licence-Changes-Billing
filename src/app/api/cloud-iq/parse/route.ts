import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { parseCloudIQNotification } from "@/lib/cloud-iq-parser";
import { findAppliedChangeForNotification } from "@/lib/cloud-iq-dedupe";

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
  isActivation: boolean;
} {
  // Match patterns like "State changed from Active to Expired"
  const match = event.match(/state\s+changed\s+from\s+(\w+)\s+to\s+(\w+)/i);
  if (!match) {
    return { isStateChange: false, fromState: "", toState: "", isCancellation: false, isSuspension: false, isReactivation: false, isActivation: false };
  }
  const fromState = match[1].toLowerCase();
  const toState = match[2].toLowerCase();
  const isCancellation = EXPIRED_STATES.includes(toState);
  const isSuspension = SUSPENDED_STATES.includes(toState);
  const isReactivation = ACTIVE_STATES.includes(toState) && (EXPIRED_STATES.includes(fromState) || SUSPENDED_STATES.includes(fromState));
  // A new subscription going live (e.g. "Pending → Active") is an activation,
  // not a reactivation of a previously expired/suspended subscription. Partner
  // Center / Crayon sends this when a brand-new subscription is provisioned.
  const isActivation = ACTIVE_STATES.includes(toState) && !isReactivation;
  return { isStateChange: true, fromState, toState, isCancellation, isSuspension, isReactivation, isActivation };
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
    friendlyNameChange?: { from: string; to: string };
  };
  match: {
    customerId: string | null;
    customerName: string | null;
    subscriptionDbId: string | null;
    productId: string | null;
    productName: string | null;
    currentSeatCount: number | null;
    seatDifference: number | null;
    status: "matched" | "partial" | "new" | "no_change" | "cancellation" | "suspension" | "reactivation" | "new_subscription" | "duplicate" | "product_change";
    details: string;
    /** Set when Cloud-iQ's "changed from" quantity differs from the app's seat count. */
    outOfSync?: { cloudIqFrom: number; appSeatCount: number };
    /** For a product change (e.g. Standard → Premium): the product it moves to. */
    productChange?: {
      fromProductName: string;
      toProductId: string | null;
      toProductName: string;
      /** The target product isn't in the system yet; it is added on apply. */
      toProductIsNew: boolean;
    };
    /** New subscription whose product will be added (named as in Cloud-iQ) on create. */
    productIsNew?: boolean;
    /** For a duplicate: the change already recorded from this email. */
    appliedChange?: {
      id: string;
      previousSeatCount: number | null;
      newSeatCount: number | null;
      status: string;
      appliedOn: string;
      /** It never reached the email's quantity (e.g. split under earlier rules). */
      partly: boolean;
    };
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

      // A product change names the NEW product, so when the subscription
      // isn't linked by its Microsoft ID yet, look for the customer's active
      // subscription on the product it changed FROM — otherwise it would look
      // like a brand-new subscription and be billed twice.
      const rename = notification.friendlyNameChange;
      if (!subscription && rename && notification.cloudAccount) {
        const customer = await prisma.customer.findFirst({
          where: { name: { contains: notification.cloudAccount, mode: "insensitive" } },
        });
        const fromProduct = await prisma.product.findFirst({
          where: { name: { equals: rename.from, mode: "insensitive" } },
        });
        if (customer && fromProduct) {
          subscription = await prisma.subscription.findFirst({
            where: { customerId: customer.id, productId: fromProduct.id, status: "ACTIVE" },
            include: { customer: true, product: true },
          });
        }
      }

      if (subscription) {
        // This exact email (same timestamp and event) was already applied and
        // not undone: it's a duplicate, so don't offer to apply it again.
        const alreadyApplied = await findAppliedChangeForNotification(prisma, {
          subscriptionId: subscription.id,
          eventTime: new Date(notification.time),
          event: notification.event,
        });
        if (alreadyApplied) {
          const appliedOn = alreadyApplied.createdAt.toISOString().split("T")[0];
          const appliedBy = alreadyApplied.createdBy?.name ? ` by ${alreadyApplied.createdBy.name}` : "";
          const recorded = `${alreadyApplied.previousSeatCount ?? "–"} → ${alreadyApplied.newSeatCount ?? "–"}`;

          // An email applied under earlier rules may only have been partly
          // applied — e.g. a split that took 136 → 135 now and scheduled the
          // rest — so the app never reached the email's quantity.
          const target = notification.event.match(/quantity changed from \d+ to (\d+)/i);
          const emailTarget = target ? parseInt(target[1], 10) : null;
          // A split that still has its renewal-side schedule (pending, or
          // actioned at renewal) was fully handled; only flag it when that
          // part is gone.
          let partly: { emailTarget: number } | undefined;
          if (
            emailTarget !== null &&
            alreadyApplied.status === "APPLIED" &&
            alreadyApplied.newSeatCount !== null &&
            alreadyApplied.newSeatCount !== emailTarget
          ) {
            const rest = await prisma.scheduledChange.findFirst({
              where: {
                subscriptionId: subscription.id,
                targetSeatCount: emailTarget,
                status: { in: ["PENDING", "ACTIONED"] },
                createdAt: {
                  gte: new Date(alreadyApplied.createdAt.getTime() - 60_000),
                  lte: new Date(alreadyApplied.createdAt.getTime() + 60_000),
                },
              },
            });
            if (!rest) partly = { emailTarget };
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
              seatDifference: null,
              status: "duplicate",
              details: partly
                ? `Only partly applied on ${appliedOn}${appliedBy}: ${recorded} was recorded, but this email takes it to ${partly.emailTarget}, and nothing in the app takes it the rest of the way. If that was wrong, Undo it and this email can be applied again under the current rules.`
                : `Already applied on ${appliedOn}${appliedBy} (${alreadyApplied.changeType.replace(/_/g, " ").toLowerCase()} ${recorded}, ${alreadyApplied.status.toLowerCase()}). To apply it again, Undo that change first.`,
              appliedChange: {
                id: alreadyApplied.id,
                previousSeatCount: alreadyApplied.previousSeatCount,
                newSeatCount: alreadyApplied.newSeatCount,
                status: alreadyApplied.status,
                appliedOn,
                partly: !!partly,
              },
            },
          });
          continue;
        }

        // Product change (e.g. Business Standard → Business Premium): Cloud-iQ
        // adds "Friendly name changed from X to Y" and the Product field shows
        // the new product. A rename alone (Product unchanged) is not one.
        const toName = notification.product.trim();
        if (
          rename &&
          rename.from.toLowerCase() !== rename.to.toLowerCase() &&
          rename.to.toLowerCase() === toName.toLowerCase() &&
          subscription.product.name.toLowerCase() !== toName.toLowerCase()
        ) {
          const toProduct =
            (await prisma.product.findFirst({ where: { name: { equals: toName, mode: "insensitive" } } })) ??
            (await prisma.product.findFirst({ where: { name: { contains: toName, mode: "insensitive" } } }));
          const seatNote =
            notification.quantity && notification.quantity !== subscription.seatCount
              ? ` ⚠ Cloud-iQ shows ${notification.quantity} seats but the app has ${subscription.seatCount}: the change is applied to the app's ${subscription.seatCount} seats — sort out the seat difference separately.`
              : "";
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
              status: "product_change",
              productChange: {
                fromProductName: subscription.product.name,
                toProductId: toProduct?.id ?? null,
                toProductName: toProduct?.name ?? toName,
                toProductIsNew: !toProduct,
              },
              details: `Product change: ${subscription.product.name} → ${toProduct?.name ?? toName} (${subscription.seatCount} seats) on the same subscription. Applying it credits the old product and charges the new one for the rest of the month, and updates the repeating invoice from next month. Term and renewal date stay the same.${!toProduct ? ` "${toName}" isn't in the system yet; it will be added under this name.` : ""}${seatNote}`,
            },
          });
          continue;
        }

        // A cancellation/suspension email for a subscription already in that
        // state was applied before (e.g. the same email pasted again): there
        // is nothing to do, so don't offer to apply it a second time.
        const alreadyInState =
          (stateChange.isCancellation && subscription.status === "CANCELLED") ||
          (stateChange.isSuspension && ["SUSPENDED", "CANCELLED"].includes(subscription.status));
        if (stateChange.isStateChange && alreadyInState) {
          results.push({
            notification,
            match: {
              customerId: subscription.customerId,
              customerName: subscription.customer.name,
              subscriptionDbId: subscription.id,
              productId: subscription.productId,
              productName: subscription.product.name,
              currentSeatCount: subscription.seatCount,
              seatDifference: 0,
              status: "no_change",
              details: `Already ${subscription.status.toLowerCase()}: ${subscription.product.name}. This notification was applied before — nothing to do.`,
            },
          });
          continue;
        }

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
          // Decreases only take effect at renewal; a Partner Center
          // synchronization is that renewal applying the reduced quantity.
          if (/partner center synchroni[sz]ation/i.test(notification.changedBy)) {
            details += ` — renewal reduction (Partner Center synchronization): will be applied immediately`;
          }
        } else {
          details = `No seat change. Current: ${subscription.seatCount}, Cloud-iQ: ${notification.quantity}. Event: ${notification.event}`;
        }

        // "Quantity changed from X to Y": if X isn't what the app holds, the app
        // has drifted from Cloud-iQ (a missed, undone or out-of-order
        // notification), so applying would start from the wrong number.
        const fromMatch = notification.event.match(/quantity\s+changed\s+from\s+(\d+)\s+to\s+\d+/i);
        const cloudIqFrom = fromMatch ? parseInt(fromMatch[1], 10) : null;
        const outOfSync =
          status === "matched" && cloudIqFrom !== null && cloudIqFrom !== subscription.seatCount
            ? { cloudIqFrom, appSeatCount: subscription.seatCount }
            : undefined;

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
            outOfSync,
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

        // Check if this is a new-subscription event with both customer and product found.
        // Two shapes signal a brand-new subscription that needs to be created:
        //   1. An explicit "New subscription was created" event.
        //   2. An activation state change (e.g. "State changed from Pending to Active"),
        //      which Partner Center / Crayon sends when a newly provisioned
        //      subscription goes live and is not yet in our system.
        const isNewSubscriptionEvent = /new subscription.*was created/i.test(notification.event);
        const isActivationEvent = stateChange.isStateChange && stateChange.isActivation;
        const isNewSubEvent = isNewSubscriptionEvent || isActivationEvent;
        const isNewSub = isNewSubEvent && customer && product;
        // A product the system doesn't have yet is added under the name
        // Cloud-iQ gives it when the subscription is created.
        const isNewSubNewProduct = isNewSubEvent && customer && !product && !!notification.product?.trim();

        results.push({
          notification,
          match: {
            customerId: customer?.id ?? null,
            customerName: customer?.name ?? null,
            subscriptionDbId: null,
            productId: product?.id ?? null,
            productName: product?.name ?? (isNewSubNewProduct ? notification.product.trim() : null),
            currentSeatCount: null,
            seatDifference: null,
            status: isNewSub || isNewSubNewProduct ? "new_subscription" : hasAnyMatch ? "partial" : "new",
            ...(isNewSubNewProduct && { productIsNew: true }),
            details: isNewSub
              ? `New subscription detected: ${customer!.name} – ${product!.name}. Ready to create subscription and set up billing.`
              : isNewSubNewProduct
                ? `New subscription detected: ${customer!.name} – ${notification.product.trim()}. This product isn't in the system yet; it will be added under this name when you create the subscription.`
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
