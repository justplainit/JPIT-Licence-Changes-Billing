import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { format } from "date-fns";
import {
  calculateProRata,
  calculateSeatReductionCredit,
  calculate7DayWindow,
  formatCurrency,
} from "@/lib/billing-calculations";
import {
  generateProRataInvoiceDraft,
  generateCreditNoteDraft,
} from "@/lib/invoice-generator";

interface ApplyRequest {
  subscriptionDbId: string;
  newQuantity: number;
  notificationTime: string;
  notificationEvent: string;
  notificationSubscriptionId: string;
  applyType?: "seat_change" | "cancellation" | "suspension" | "new_subscription";
  customerId?: string;
  productId?: string;
  termType?: "ANNUAL" | "MONTHLY" | "THREE_YEAR";
  billingFrequency?: "MONTHLY" | "ANNUAL";
  startDate?: string;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: ApplyRequest = await request.json();
    const { subscriptionDbId, newQuantity, notificationTime, notificationEvent, notificationSubscriptionId, applyType, customerId, productId, termType, billingFrequency, startDate } = body;

    // new_subscription does not have a subscriptionDbId yet — it will be created
    if (!subscriptionDbId && applyType !== "new_subscription") {
      return NextResponse.json(
        { error: "subscriptionDbId is required" },
        { status: 400 }
      );
    }

    const effectiveDate = notificationTime ? new Date(notificationTime) : new Date();
    // Use a valid date; fall back to now if parsing fails
    const changeDateObj = isNaN(effectiveDate.getTime()) ? new Date() : effectiveDate;

    // ================================================================
    // CANCELLATION / EXPIRY
    // ================================================================
    if (applyType === "cancellation" || applyType === "suspension") {
      const result = await prisma.$transaction(async (tx) => {
        const subscription = await tx.subscription.findUnique({
          where: { id: subscriptionDbId },
          include: { customer: true, product: true },
        });

        if (!subscription) {
          throw new Error("Subscription not found");
        }

        // Get customer price for the product
        const customerPrice = await tx.customerPrice.findFirst({
          where: {
            customerId: subscription.customerId,
            productId: subscription.productId,
            effectiveTo: null,
          },
          orderBy: { effectiveFrom: "desc" },
        });

        const pricePerSeat = customerPrice?.pricePerSeat ?? 0;
        const currency = customerPrice?.currency ?? subscription.customer.currency ?? "ZAR";
        const dateStr = format(changeDateObj, "d MMMM yyyy");
        const monthName = format(changeDateObj, "MMMM yyyy");

        const newStatus = applyType === "cancellation" ? "CANCELLED" : "SUSPENDED";
        const previousMonthlyAmount = pricePerSeat * subscription.seatCount;

        // Update subscription status
        await tx.subscription.update({
          where: { id: subscriptionDbId },
          data: { status: newStatus },
        });

        // Create change record
        const change = await tx.subscriptionChange.create({
          data: {
            subscriptionId: subscriptionDbId,
            changeType: "CANCELLATION",
            status: "APPLIED",
            effectiveDate: changeDateObj,
            previousSeatCount: subscription.seatCount,
            newSeatCount: 0,
            billingCurrency: currency,
            notes: `Applied from Cloud-iQ notification. Event: ${notificationEvent}`,
            createdById: session.user!.id!,
          },
        });

        // Close any open 7-day windows
        await tx.sevenDayWindow.updateMany({
          where: { subscriptionId: subscriptionDbId, isClosed: false },
          data: { isClosed: true },
        });

        // Cancel any pending scheduled changes
        await tx.scheduledChange.updateMany({
          where: { subscriptionId: subscriptionDbId, status: "PENDING" },
          data: { status: "CANCELLED" },
        });

        const amendmentItems: Array<{
          description: string;
          productName: string;
          newMonthlyAmount: number;
          newSeatCount: number;
          actionByDate: Date;
          reason: string;
        }> = [];

        if (applyType === "cancellation") {
          // Task: Remove from repeating invoice
          amendmentItems.push({
            description: [
              `REMOVE LINE ITEM FROM REPEATING INVOICE for ${subscription.customer.name} in Xero`,
              ``,
              `Product: ${subscription.product.name}`,
              `Seats being removed: ${subscription.seatCount}`,
              `Monthly amount to remove: ${formatCurrency(previousMonthlyAmount, currency)}`,
              `Expired on: ${dateStr}`,
              ``,
              `Steps:`,
              `  1. Open the repeating invoice for ${subscription.customer.name} in Xero`,
              `  2. DELETE the line item for "${subscription.product.name}" (${subscription.seatCount} × ${formatCurrency(pricePerSeat, currency)} = ${formatCurrency(previousMonthlyAmount, currency)}/month)`,
              `  3. If this was their only product, CANCEL the entire repeating invoice`,
              `  4. Save the repeating invoice`,
              ``,
              `Note: If ${monthName} has already been invoiced, no credit note is needed`,
              `unless the customer paid for a period beyond the expiry date.`,
            ].join("\n"),
            productName: subscription.product.name,
            newMonthlyAmount: 0,
            newSeatCount: 0,
            actionByDate: changeDateObj,
            reason: `Subscription expired: ${subscription.product.name} (${subscription.seatCount} seats) – ${subscription.customer.name}`,
          });
        } else {
          // Suspension — review needed
          amendmentItems.push({
            description: [
              `REVIEW SUSPENDED SUBSCRIPTION for ${subscription.customer.name}`,
              ``,
              `Product: ${subscription.product.name}`,
              `Seats: ${subscription.seatCount}`,
              `Monthly amount: ${formatCurrency(previousMonthlyAmount, currency)}`,
              `Suspended on: ${dateStr}`,
              ``,
              `Action required:`,
              `  1. Investigate why the subscription was suspended`,
              `  2. Contact the customer if needed`,
              `  3. If suspension is permanent, remove the line item from the repeating invoice in Xero`,
              `  4. If temporary, no billing changes needed — but monitor for reactivation`,
            ].join("\n"),
            productName: subscription.product.name,
            newMonthlyAmount: previousMonthlyAmount,
            newSeatCount: subscription.seatCount,
            actionByDate: changeDateObj,
            reason: `Subscription suspended: ${subscription.product.name} – ${subscription.customer.name}`,
          });
        }

        for (const item of amendmentItems) {
          await tx.amendmentQueueItem.create({
            data: {
              customerId: subscription.customerId,
              ...item,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            userId: session.user!.id!,
            action: applyType === "cancellation" ? "CLOUD_IQ_APPLY_CANCELLATION" : "CLOUD_IQ_APPLY_SUSPENSION",
            entityType: "Subscription",
            entityId: subscriptionDbId,
            details: `Cloud-iQ: Subscription ${newStatus.toLowerCase()} – ${subscription.product.name} (${subscription.seatCount} seats) for ${subscription.customer.name}. Event: ${notificationEvent}`,
            xeroInstructionsGen: true,
          },
        });

        return {
          changeType: "CANCELLATION" as const,
          applyType,
          customerName: subscription.customer.name,
          productName: subscription.product.name,
          previousSeatCount: subscription.seatCount,
          newSeatCount: 0,
          previousMonthlyAmount,
          currency,
          tasks: amendmentItems.map((a) => ({
            description: a.description,
            actionByDate: a.actionByDate.toISOString(),
            reason: a.reason,
          })),
        };
      });

      return NextResponse.json(result, { status: 201 });
    }

    // ================================================================
    // NEW SUBSCRIPTION
    // ================================================================
    if (applyType === "new_subscription") {
      if (!customerId || !productId) {
        return NextResponse.json(
          { error: "customerId and productId are required for new subscriptions" },
          { status: 400 }
        );
      }

      const seatCount = newQuantity || 1;
      const resolvedTermType = termType ?? "ANNUAL";
      const resolvedBillingFrequency = billingFrequency ?? "MONTHLY";
      const subscriptionStartDate = startDate ? new Date(startDate) : changeDateObj;

      const result = await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.findUnique({ where: { id: customerId } });
        if (!customer) throw new Error("Customer not found");

        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product) throw new Error("Product not found");

        // Calculate renewal/term end dates based on term type
        let renewalDate: Date;
        if (resolvedTermType === "MONTHLY") {
          renewalDate = new Date(subscriptionStartDate.getFullYear(), subscriptionStartDate.getMonth() + 1, 1);
        } else if (resolvedTermType === "THREE_YEAR") {
          renewalDate = new Date(subscriptionStartDate.getFullYear() + 3, subscriptionStartDate.getMonth(), 1);
        } else {
          renewalDate = new Date(subscriptionStartDate.getFullYear() + 1, subscriptionStartDate.getMonth(), 1);
        }
        const termEndDate = renewalDate;

        // Create the subscription
        const subscription = await tx.subscription.create({
          data: {
            customerId,
            productId,
            termType: resolvedTermType,
            billingFrequency: resolvedBillingFrequency,
            seatCount,
            startDate: subscriptionStartDate,
            renewalDate,
            termEndDate,
            autoRenew: true,
            microsoftSubId: notificationSubscriptionId || null,
          },
          include: { customer: true, product: true },
        });

        // Create 7-day window
        const { opensAt, closesAt } = calculate7DayWindow(subscriptionStartDate);
        await tx.sevenDayWindow.create({
          data: {
            subscriptionId: subscription.id,
            windowType: "NEW_SUBSCRIPTION",
            opensAt,
            closesAt,
            seatsAffected: seatCount,
          },
        });

        // Get customer price for the product
        const customerPrice = await tx.customerPrice.findFirst({
          where: {
            customerId,
            productId,
            effectiveTo: null,
          },
          orderBy: { effectiveFrom: "desc" },
        });

        const pricePerSeat = customerPrice?.pricePerSeat ?? 0;
        const currency = customerPrice?.currency ?? customer.currency ?? "ZAR";
        const dateStr = format(subscriptionStartDate, "d MMMM yyyy");
        const nextMonthDate = new Date(subscriptionStartDate.getFullYear(), subscriptionStartDate.getMonth() + 1, 1);
        const nextMonthName = format(nextMonthDate, "MMMM yyyy");
        const monthlyTotal = pricePerSeat * seatCount;

        // Create change record
        const change = await tx.subscriptionChange.create({
          data: {
            subscriptionId: subscription.id,
            changeType: "NEW_SUBSCRIPTION",
            status: "APPLIED",
            effectiveDate: subscriptionStartDate,
            previousSeatCount: 0,
            newSeatCount: seatCount,
            billingCurrency: currency,
            notes: `Created from Cloud-iQ notification. Event: ${notificationEvent}`,
            createdById: session.user!.id!,
          },
        });

        const amendmentItems: Array<{
          description: string;
          productName: string;
          newMonthlyAmount: number;
          newSeatCount: number;
          actionByDate: Date;
          reason: string;
          proRataFraction?: number;
          proRataDays?: number;
          proRataDaysInMonth?: number;
          proRataAmount?: number;
        }> = [];

        // Calculate pro-rata for the remainder of the current month
        const proRata = calculateProRata({
          pricePerSeat,
          additionalSeats: seatCount,
          changeDate: subscriptionStartDate,
          currency,
        });

        // Generate invoice draft for pro-rata
        if (pricePerSeat > 0) {
          const invoiceDraftOutput = generateProRataInvoiceDraft({
            customerName: customer.name,
            productName: product.name,
            pricePerSeat,
            additionalSeats: seatCount,
            changeDate: subscriptionStartDate,
            currentSeatCount: 0,
            currency,
          });

          await tx.invoiceDraft.create({
            data: {
              customerId,
              changeId: change.id,
              draftType: "PRO_RATA",
              invoiceDate: changeDateObj,
              totalAmount: invoiceDraftOutput.totalAmount,
              currency,
              notes: invoiceDraftOutput.notes.join("\n"),
              lineItems: {
                create: invoiceDraftOutput.lineItems.map((item, index) => ({
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
        }

        // Task 1: Send pro-rata invoice for the current month
        amendmentItems.push({
          description: [
            `SEND ONE-TIME PRO-RATA INVOICE to ${customer.name}`,
            ``,
            `Amount: ${formatCurrency(proRata.totalAmount, currency)} (incl. VAT to be added)`,
            `Product: ${product.name}`,
            `Reason: New subscription – ${seatCount} seat${seatCount !== 1 ? "s" : ""} starting ${dateStr}`,
            `Period: ${format(proRata.periodStart, "d MMM")} – ${format(proRata.periodEnd, "d MMM yyyy")}`,
            ``,
            `Calculation:`,
            `  Rate per seat: ${formatCurrency(pricePerSeat, currency)}/month`,
            `  Daily rate: ${formatCurrency(proRata.dailyRate, currency)} (${formatCurrency(pricePerSeat, currency)} ÷ ${proRata.daysInMonth} days)`,
            `  Days remaining: ${proRata.daysRemaining}`,
            `  Per seat: ${formatCurrency(proRata.perSeatProRata, currency)}`,
            `  Total: ${formatCurrency(proRata.perSeatProRata, currency)} × ${seatCount} = ${formatCurrency(proRata.totalAmount, currency)}`,
            ``,
            `Create this as a one-time invoice in Xero (NOT on the repeating invoice).`,
          ].join("\n"),
          productName: product.name,
          newMonthlyAmount: proRata.totalAmount,
          newSeatCount: seatCount,
          actionByDate: changeDateObj,
          reason: `Pro-rata invoice for new subscription – ${customer.name}`,
          proRataFraction: Math.round((proRata.daysRemaining / proRata.daysInMonth) * 100) / 100,
          proRataDays: proRata.daysRemaining,
          proRataDaysInMonth: proRata.daysInMonth,
          proRataAmount: proRata.totalAmount,
        });

        // Task 2: Add to repeating invoice from next month
        amendmentItems.push({
          description: [
            `ADD TO REPEATING INVOICE for ${customer.name} in Xero`,
            ``,
            `Product: ${product.name}`,
            `Seats: ${seatCount}`,
            `Monthly amount: ${formatCurrency(monthlyTotal, currency)} (${seatCount} × ${formatCurrency(pricePerSeat, currency)})`,
            `Effective from: 1 ${nextMonthName}`,
            ``,
            `Add a new line item to the repeating invoice (or create a new repeating invoice if one doesn't exist).`,
          ].join("\n"),
          productName: product.name,
          newMonthlyAmount: monthlyTotal,
          newSeatCount: seatCount,
          actionByDate: nextMonthDate,
          reason: `New subscription: ${product.name} (${seatCount} seats) – ${customer.name}`,
        });

        for (const item of amendmentItems) {
          await tx.amendmentQueueItem.create({
            data: {
              customerId,
              ...item,
            },
          });
        }

        // Audit log
        await tx.auditLog.create({
          data: {
            userId: session.user!.id!,
            action: "CLOUD_IQ_APPLY_NEW_SUBSCRIPTION",
            entityType: "Subscription",
            entityId: subscription.id,
            details: `Cloud-iQ: Created new subscription – ${product.name} (${seatCount} seats) for ${customer.name}. Pro rata: ${formatCurrency(proRata.totalAmount, currency)}. Event: ${notificationEvent}`,
            proRataAmount: proRata.totalAmount,
            sevenDayWindowOpen: true,
            xeroInstructionsGen: true,
          },
        });

        return {
          changeType: "NEW_SUBSCRIPTION" as const,
          customerName: customer.name,
          productName: product.name,
          previousSeatCount: 0,
          newSeatCount: seatCount,
          proRataAmount: proRata.totalAmount,
          currency,
          tasks: amendmentItems.map((a) => ({
            description: a.description,
            actionByDate: a.actionByDate.toISOString(),
            reason: a.reason,
          })),
        };
      });

      return NextResponse.json(result, { status: 201 });
    }

    // ================================================================
    // SEAT CHANGES (existing logic below)
    // ================================================================
    if (newQuantity === undefined || newQuantity === null) {
      return NextResponse.json(
        { error: "newQuantity is required for seat changes" },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.findUnique({
        where: { id: subscriptionDbId },
        include: {
          customer: true,
          product: true,
          sevenDayWindows: {
            where: {
              isClosed: false,
              closesAt: { gte: new Date() },
            },
            orderBy: { closesAt: "desc" },
          },
        },
      });

      if (!subscription) {
        throw new Error("Subscription not found");
      }

      const seatDifference = newQuantity - subscription.seatCount;

      if (seatDifference === 0) {
        throw new Error("No seat change detected");
      }

      // Update the Microsoft Subscription ID if we have one and it's not set yet
      if (notificationSubscriptionId && !subscription.microsoftSubId) {
        await tx.subscription.update({
          where: { id: subscriptionDbId },
          data: { microsoftSubId: notificationSubscriptionId },
        });
      }

      // Get customer price
      const customerPrice = await tx.customerPrice.findFirst({
        where: {
          customerId: subscription.customerId,
          productId: subscription.productId,
          effectiveTo: null,
        },
        orderBy: { effectiveFrom: "desc" },
      });

      const pricePerSeat = customerPrice?.pricePerSeat ?? 0;
      const currency = customerPrice?.currency ?? subscription.customer.currency ?? "ZAR";
      const dateStr = format(changeDateObj, "d MMMM yyyy");
      const monthName = format(changeDateObj, "MMMM");
      const nextMonthDate = new Date(changeDateObj.getFullYear(), changeDateObj.getMonth() + 1, 1);
      const nextMonthName = format(nextMonthDate, "MMMM yyyy");

      const amendmentItems: Array<{
        description: string;
        productName: string;
        newMonthlyAmount: number;
        newSeatCount: number;
        actionByDate: Date;
        reason: string;
      }> = [];

      // ================================================================
      // SEAT INCREASE
      // ================================================================
      if (seatDifference > 0) {
        const previousSeatCount = subscription.seatCount;
        const additionalSeats = seatDifference;

        const proRata = calculateProRata({
          pricePerSeat,
          additionalSeats,
          changeDate: changeDateObj,
          currency,
        });

        // Update subscription
        await tx.subscription.update({
          where: { id: subscriptionDbId },
          data: { seatCount: newQuantity },
        });

        // Create change record
        const change = await tx.subscriptionChange.create({
          data: {
            subscriptionId: subscriptionDbId,
            changeType: "ADD_SEATS",
            status: "APPLIED",
            effectiveDate: changeDateObj,
            previousSeatCount,
            newSeatCount: newQuantity,
            proRataAmount: proRata.totalAmount,
            proRataDays: proRata.daysRemaining,
            proRataDailyRate: proRata.dailyRate,
            billingCurrency: currency,
            notes: `Applied from Cloud-iQ notification. Event: ${notificationEvent}`,
            createdById: session.user!.id!,
          },
        });

        // 7-day window
        const { opensAt, closesAt } = calculate7DayWindow(changeDateObj);
        await tx.sevenDayWindow.create({
          data: {
            subscriptionId: subscriptionDbId,
            changeId: change.id,
            windowType: "MID_TERM_ADDITION",
            opensAt,
            closesAt,
            seatsAffected: additionalSeats,
          },
        });

        // Invoice draft
        const invoiceDraftOutput = generateProRataInvoiceDraft({
          customerName: subscription.customer.name,
          productName: subscription.product.name,
          pricePerSeat,
          additionalSeats,
          changeDate: changeDateObj,
          currentSeatCount: previousSeatCount,
          currency,
        });

        await tx.invoiceDraft.create({
          data: {
            customerId: subscription.customerId,
            changeId: change.id,
            draftType: "PRO_RATA",
            invoiceDate: changeDateObj,
            totalAmount: invoiceDraftOutput.totalAmount,
            currency,
            notes: invoiceDraftOutput.notes.join("\n"),
            lineItems: {
              create: invoiceDraftOutput.lineItems.map((item, index) => ({
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

        // ---- AMENDMENT TASKS WITH EXACT INSTRUCTIONS ----

        // Task 1: Send pro-rata invoice NOW
        amendmentItems.push({
          description: [
            `SEND ONE-TIME PRO-RATA INVOICE to ${subscription.customer.name}`,
            ``,
            `Amount: ${formatCurrency(proRata.totalAmount, currency)} (incl. VAT to be added)`,
            `Product: ${subscription.product.name}`,
            `Reason: ${additionalSeats} additional seat${additionalSeats !== 1 ? "s" : ""} added on ${dateStr}`,
            `Period: ${format(proRata.periodStart, "d MMM")} – ${format(proRata.periodEnd, "d MMM yyyy")}`,
            ``,
            `Calculation:`,
            `  Rate per seat: ${formatCurrency(pricePerSeat, currency)}/month`,
            `  Daily rate: ${formatCurrency(proRata.dailyRate, currency)} (${formatCurrency(pricePerSeat, currency)} ÷ ${proRata.daysInMonth} days)`,
            `  Days remaining: ${proRata.daysRemaining}`,
            `  Per seat: ${formatCurrency(proRata.perSeatProRata, currency)}`,
            `  Total: ${formatCurrency(proRata.perSeatProRata, currency)} × ${additionalSeats} = ${formatCurrency(proRata.totalAmount, currency)}`,
            ``,
            `Create this as a one-time invoice in Xero (NOT on the repeating invoice).`,
          ].join("\n"),
          productName: subscription.product.name,
          newMonthlyAmount: proRata.totalAmount,
          newSeatCount: additionalSeats,
          actionByDate: changeDateObj,
          reason: `Pro-rata invoice for ${additionalSeats} new seat${additionalSeats !== 1 ? "s" : ""} – ${subscription.customer.name}`,
        });

        // Task 2: Update repeating invoice from next month
        const newMonthlyTotal = pricePerSeat * newQuantity;
        amendmentItems.push({
          description: [
            `UPDATE REPEATING INVOICE for ${subscription.customer.name} in Xero`,
            ``,
            `Product: ${subscription.product.name}`,
            `Change: ${previousSeatCount} seats → ${newQuantity} seats`,
            `New monthly amount: ${formatCurrency(newMonthlyTotal, currency)} (${newQuantity} × ${formatCurrency(pricePerSeat, currency)})`,
            `Effective from: 1 ${nextMonthName}`,
            ``,
            `DO NOT change the current month's repeating invoice – it has already been billed.`,
            `Only update the repeating invoice so that from 1 ${nextMonthName} it reflects ${newQuantity} seats.`,
          ].join("\n"),
          productName: subscription.product.name,
          newMonthlyAmount: newMonthlyTotal,
          newSeatCount: newQuantity,
          actionByDate: nextMonthDate,
          reason: `Seat increase: ${previousSeatCount} → ${newQuantity} effective ${dateStr}`,
        });

        // Audit log
        await tx.auditLog.create({
          data: {
            userId: session.user!.id!,
            action: "CLOUD_IQ_APPLY_ADD_SEATS",
            entityType: "Subscription",
            entityId: subscriptionDbId,
            details: `Cloud-iQ: Added ${additionalSeats} seats (${previousSeatCount} → ${newQuantity}). Pro rata: ${formatCurrency(proRata.totalAmount, currency)}. Event: ${notificationEvent}`,
            proRataAmount: proRata.totalAmount,
            sevenDayWindowOpen: true,
            xeroInstructionsGen: true,
          },
        });

        // Create amendment queue items
        for (const item of amendmentItems) {
          await tx.amendmentQueueItem.create({
            data: {
              customerId: subscription.customerId,
              ...item,
            },
          });
        }

        return {
          changeType: "ADD_SEATS" as const,
          customerName: subscription.customer.name,
          productName: subscription.product.name,
          previousSeatCount,
          newSeatCount: newQuantity,
          proRataAmount: proRata.totalAmount,
          currency,
          tasks: amendmentItems.map((a) => ({
            description: a.description,
            actionByDate: a.actionByDate.toISOString(),
            reason: a.reason,
          })),
          invoiceDraft: invoiceDraftOutput.formattedDraft,
        };
      }

      // ================================================================
      // SEAT DECREASE
      // ================================================================
      const seatsRemoved = subscription.seatCount - newQuantity;
      const previousSeatCount = subscription.seatCount;

      // Check for open 7-day window
      const openWindow = subscription.sevenDayWindows.length > 0
        ? subscription.sevenDayWindows[0]
        : null;

      if (openWindow) {
        // ----- Check if this is a FULL REVERSAL (grace period cancellation) -----
        // Look up the original change that created this 7-day window to find the
        // seat count BEFORE the addition.
        const originalChange = openWindow.changeId
          ? await tx.subscriptionChange.findUnique({ where: { id: openWindow.changeId } })
          : null;
        const priorSeatCount = originalChange?.previousSeatCount ?? null;
        const isFullReversal = priorSeatCount !== null && newQuantity <= priorSeatCount;

        if (isFullReversal) {
          // ================================================================
          // GRACE PERIOD FULL REVERSAL — no billing action needed
          // ================================================================

          // Revert seat count to what it was before the addition
          await tx.subscription.update({
            where: { id: subscriptionDbId },
            data: { seatCount: priorSeatCount },
          });

          // Create change record for the reversal
          const change = await tx.subscriptionChange.create({
            data: {
              subscriptionId: subscriptionDbId,
              changeType: "REMOVE_SEATS",
              status: "APPLIED",
              effectiveDate: changeDateObj,
              previousSeatCount,
              newSeatCount: priorSeatCount,
              proRataAmount: 0,
              billingCurrency: currency,
              notes: `Grace period full reversal – seats returned to ${priorSeatCount} (within 7-day window). No billing impact. Event: ${notificationEvent}`,
              createdById: session.user!.id!,
            },
          });

          // Close the 7-day window
          await tx.sevenDayWindow.update({
            where: { id: openWindow.id },
            data: { isClosed: true },
          });

          // Cancel all pending (non-completed) amendment queue items for this
          // customer + product that were created by the original addition
          const pendingAmendments = await tx.amendmentQueueItem.findMany({
            where: {
              customerId: subscription.customerId,
              productName: subscription.product.name,
              isCompleted: false,
            },
          });

          for (const amendment of pendingAmendments) {
            await tx.amendmentQueueItem.update({
              where: { id: amendment.id },
              data: {
                isCompleted: true,
                completedAt: new Date(),
                reason: amendment.reason + " [AUTO-CANCELLED: Grace period reversal]",
              },
            });
          }

          // Create a single "no action" amendment so the admin knows what happened
          await tx.amendmentQueueItem.create({
            data: {
              customerId: subscription.customerId,
              description: [
                `NO BILLING ACTION REQUIRED — Grace period reversal for ${subscription.customer.name}`,
                ``,
                `Product: ${subscription.product.name}`,
                `What happened:`,
                `  • Seat increase: ${priorSeatCount} → ${previousSeatCount} on ${originalChange ? format(originalChange.effectiveDate, "d MMMM yyyy") : "recently"}`,
                `  • Seat decrease: ${previousSeatCount} → ${priorSeatCount} on ${dateStr} (within 7-day grace period)`,
                ``,
                `Result: Seats are back to ${priorSeatCount}. No pro-rata invoice or credit note needed.`,
                `The previous amendment tasks for this change have been automatically cancelled.`,
                ``,
                `No changes needed to the repeating invoice in Xero.`,
              ].join("\n"),
              productName: subscription.product.name,
              newMonthlyAmount: pricePerSeat * priorSeatCount,
              newSeatCount: priorSeatCount,
              actionByDate: changeDateObj,
              reason: `Grace period reversal: ${priorSeatCount} → ${previousSeatCount} → ${priorSeatCount} – ${subscription.customer.name}`,
            },
          });

          await tx.auditLog.create({
            data: {
              userId: session.user!.id!,
              action: "CLOUD_IQ_APPLY_GRACE_PERIOD_REVERSAL",
              entityType: "Subscription",
              entityId: subscriptionDbId,
              details: `Cloud-iQ: Grace period full reversal – ${subscription.product.name} seats ${priorSeatCount} → ${previousSeatCount} → ${priorSeatCount}. No billing impact. Event: ${notificationEvent}`,
              proRataAmount: 0,
              sevenDayWindowOpen: false,
              xeroInstructionsGen: true,
            },
          });

          return {
            changeType: "REMOVE_SEATS" as const,
            withinWindow: true,
            isGracePeriodReversal: true,
            customerName: subscription.customer.name,
            productName: subscription.product.name,
            previousSeatCount,
            newSeatCount: priorSeatCount,
            creditAmount: 0,
            currency,
            tasks: [{
              description: `NO BILLING ACTION REQUIRED — Grace period reversal. Seats returned to ${priorSeatCount}. Previous amendment tasks have been automatically cancelled.`,
              actionByDate: changeDateObj.toISOString(),
              reason: `Grace period reversal: ${priorSeatCount} → ${previousSeatCount} → ${priorSeatCount}`,
            }],
            message: `Grace period reversal detected. The seat addition has been fully reversed within the 7-day window. No billing changes are needed — previous amendment tasks have been automatically cancelled.`,
          };
        }

        // ================================================================
        // PARTIAL SEAT DECREASE within 7-day window (not a full reversal)
        // ================================================================
        await tx.subscription.update({
          where: { id: subscriptionDbId },
          data: { seatCount: newQuantity },
        });

        const creditResult = calculateSeatReductionCredit({
          pricePerSeat,
          seatsRemoved,
          reductionDate: changeDateObj,
        });

        const change = await tx.subscriptionChange.create({
          data: {
            subscriptionId: subscriptionDbId,
            changeType: "REMOVE_SEATS",
            status: "APPLIED",
            effectiveDate: changeDateObj,
            previousSeatCount,
            newSeatCount: newQuantity,
            proRataAmount: -creditResult.totalCredit,
            proRataDays: creditResult.daysRemaining,
            proRataDailyRate: creditResult.dailyRate,
            billingCurrency: currency,
            notes: `Applied from Cloud-iQ notification (within 7-day window). Event: ${notificationEvent}`,
            createdById: session.user!.id!,
          },
        });

        const creditNoteDraft = generateCreditNoteDraft({
          customerName: subscription.customer.name,
          productName: subscription.product.name,
          pricePerSeat,
          seatsRemoved,
          reductionDate: changeDateObj,
          currency,
        });

        await tx.invoiceDraft.create({
          data: {
            customerId: subscription.customerId,
            changeId: change.id,
            draftType: "CREDIT_NOTE",
            invoiceDate: changeDateObj,
            totalAmount: creditNoteDraft.totalAmount,
            currency,
            notes: creditNoteDraft.notes.join("\n"),
            lineItems: {
              create: creditNoteDraft.lineItems.map((item, index) => ({
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

        // Task 1: Issue credit note
        amendmentItems.push({
          description: [
            `ISSUE CREDIT NOTE to ${subscription.customer.name}`,
            ``,
            `Amount: ${formatCurrency(creditResult.totalCredit, currency)}`,
            `Product: ${subscription.product.name}`,
            `Reason: ${seatsRemoved} seat${seatsRemoved !== 1 ? "s" : ""} removed on ${dateStr} (within 7-day cancellation window)`,
            `Period: ${format(creditResult.periodStart, "d MMM")} – ${format(creditResult.periodEnd, "d MMM yyyy")}`,
            ``,
            `Create a credit note in Xero for the unused portion of ${monthName}.`,
          ].join("\n"),
          productName: subscription.product.name,
          newMonthlyAmount: -creditResult.totalCredit,
          newSeatCount: seatsRemoved,
          actionByDate: changeDateObj,
          reason: `Credit note for ${seatsRemoved} removed seat${seatsRemoved !== 1 ? "s" : ""} – ${subscription.customer.name}`,
        });

        // Task 2: Update repeating invoice
        const newMonthlyTotal = pricePerSeat * newQuantity;
        amendmentItems.push({
          description: [
            `UPDATE REPEATING INVOICE for ${subscription.customer.name} in Xero`,
            ``,
            `Product: ${subscription.product.name}`,
            `Change: ${previousSeatCount} seats → ${newQuantity} seats`,
            `New monthly amount: ${formatCurrency(newMonthlyTotal, currency)} (${newQuantity} × ${formatCurrency(pricePerSeat, currency)})`,
            `Effective from: 1 ${nextMonthName}`,
            ``,
            `Update the repeating invoice so that from 1 ${nextMonthName} it reflects ${newQuantity} seats.`,
          ].join("\n"),
          productName: subscription.product.name,
          newMonthlyAmount: newMonthlyTotal,
          newSeatCount: newQuantity,
          actionByDate: nextMonthDate,
          reason: `Seat decrease: ${previousSeatCount} → ${newQuantity} effective ${dateStr}`,
        });

        for (const item of amendmentItems) {
          await tx.amendmentQueueItem.create({
            data: {
              customerId: subscription.customerId,
              ...item,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            userId: session.user!.id!,
            action: "CLOUD_IQ_APPLY_REMOVE_SEATS",
            entityType: "Subscription",
            entityId: subscriptionDbId,
            details: `Cloud-iQ: Removed ${seatsRemoved} seats within 7-day window (${previousSeatCount} → ${newQuantity}). Credit: ${formatCurrency(creditResult.totalCredit, currency)}. Event: ${notificationEvent}`,
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
          newSeatCount: newQuantity,
          creditAmount: creditResult.totalCredit,
          currency,
          tasks: amendmentItems.map((a) => ({
            description: a.description,
            actionByDate: a.actionByDate.toISOString(),
            reason: a.reason,
          })),
          invoiceDraft: creditNoteDraft.formattedDraft,
        };
      }

      // Outside 7-day window: schedule for renewal
      const change = await tx.subscriptionChange.create({
        data: {
          subscriptionId: subscriptionDbId,
          changeType: "REMOVE_SEATS",
          status: "SCHEDULED",
          effectiveDate: subscription.renewalDate,
          previousSeatCount,
          newSeatCount: newQuantity,
          billingCurrency: currency,
          notes: `Applied from Cloud-iQ notification (outside 7-day window – scheduled for renewal). Event: ${notificationEvent}`,
          createdById: session.user!.id!,
        },
      });

      await tx.scheduledChange.create({
        data: {
          subscriptionId: subscriptionDbId,
          changeType: "REMOVE_SEATS",
          scheduledDate: subscription.renewalDate,
          targetSeatCount: newQuantity,
          notes: `Cloud-iQ: Reduce seats from ${previousSeatCount} to ${newQuantity} at renewal`,
        },
      });

      const renewalDateStr = format(subscription.renewalDate, "d MMMM yyyy");

      // Task: Reduce at renewal
      amendmentItems.push({
        description: [
          `SCHEDULED: REDUCE SEATS AT RENEWAL for ${subscription.customer.name}`,
          ``,
          `Product: ${subscription.product.name}`,
          `Change: ${previousSeatCount} seats → ${newQuantity} seats (remove ${seatsRemoved})`,
          `Renewal date: ${renewalDateStr}`,
          ``,
          `This reduction is outside the 7-day cancellation window.`,
          `The customer will continue to be billed for ${previousSeatCount} seats until renewal.`,
          ``,
          `On ${renewalDateStr}:`,
          `  1. Confirm the seat reduction has been applied in Partner Center / Crayon`,
          `  2. Update the repeating invoice in Xero to ${newQuantity} seats`,
          `  3. New monthly amount: ${formatCurrency(pricePerSeat * newQuantity, currency)} (${newQuantity} × ${formatCurrency(pricePerSeat, currency)})`,
        ].join("\n"),
        productName: subscription.product.name,
        newMonthlyAmount: pricePerSeat * newQuantity,
        newSeatCount: newQuantity,
        actionByDate: subscription.renewalDate,
        reason: `Scheduled seat decrease at renewal: ${previousSeatCount} → ${newQuantity}`,
      });

      for (const item of amendmentItems) {
        await tx.amendmentQueueItem.create({
          data: {
            customerId: subscription.customerId,
            isScheduledChange: true,
            ...item,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: session.user!.id!,
          action: "CLOUD_IQ_APPLY_SCHEDULE_REMOVE_SEATS",
          entityType: "Subscription",
          entityId: subscriptionDbId,
          details: `Cloud-iQ: Scheduled seat reduction (${previousSeatCount} → ${newQuantity}) for renewal ${renewalDateStr}. Outside 7-day window. Event: ${notificationEvent}`,
          sevenDayWindowOpen: false,
          scheduledChangeCreated: true,
        },
      });

      return {
        changeType: "REMOVE_SEATS" as const,
        withinWindow: false,
        customerName: subscription.customer.name,
        productName: subscription.product.name,
        previousSeatCount,
        newSeatCount: newQuantity,
        scheduledFor: renewalDateStr,
        currency,
        tasks: amendmentItems.map((a) => ({
          description: a.description,
          actionByDate: a.actionByDate.toISOString(),
          reason: a.reason,
        })),
        message: `Seat reduction scheduled for renewal date: ${renewalDateStr}. Customer continues to be billed for ${previousSeatCount} seats until then.`,
      };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Error applying Cloud-iQ change:", error);
    const message = error instanceof Error ? error.message : "Failed to apply change";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
