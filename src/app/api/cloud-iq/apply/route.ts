import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { format } from "date-fns";
import {
  calculateProRata,
  calculateSeatReductionCredit,
  calculate7DayWindow,
  formatCurrency,
  getNextRenewalDate,
  getUpcomingRenewalDate,
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
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: ApplyRequest = await request.json();
    const { subscriptionDbId, newQuantity, notificationTime, notificationEvent, notificationSubscriptionId, applyType, customerId, productId } = body;

    // New subscriptions don't exist in the DB yet, so they have no
    // subscriptionDbId — the record is created below from customerId/productId.
    // Every other apply type acts on an existing subscription and requires it.
    if (applyType !== "new_subscription" && !subscriptionDbId) {
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

      const result = await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.findUnique({ where: { id: customerId } });
        if (!customer) throw new Error("Customer not found");

        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product) throw new Error("Product not found");

        // Calculate dates based on ANNUAL term.
        // Renewal is the anniversary of the start date (NCE model).
        const startDate = changeDateObj;
        const renewalDate = getNextRenewalDate(startDate, "ANNUAL");
        const termEndDate = renewalDate;

        // Create the subscription
        const subscription = await tx.subscription.create({
          data: {
            customerId,
            productId,
            termType: "ANNUAL",
            billingFrequency: "MONTHLY",
            seatCount,
            startDate,
            renewalDate,
            termEndDate,
            autoRenew: true,
            microsoftSubId: notificationSubscriptionId || null,
          },
          include: { customer: true, product: true },
        });

        // Create 7-day window
        const { opensAt, closesAt } = calculate7DayWindow(startDate);
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
        const dateStr = format(changeDateObj, "d MMMM yyyy");
        const nextMonthDate = new Date(changeDateObj.getFullYear(), changeDateObj.getMonth() + 1, 1);
        const nextMonthName = format(nextMonthDate, "MMMM yyyy");
        const monthlyTotal = pricePerSeat * seatCount;

        // Create change record
        const change = await tx.subscriptionChange.create({
          data: {
            subscriptionId: subscription.id,
            changeType: "NEW_SUBSCRIPTION",
            status: "APPLIED",
            effectiveDate: startDate,
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
          changeDate: changeDateObj,
          currency,
        });

        // Generate invoice draft for pro-rata
        if (pricePerSeat > 0) {
          const invoiceDraftOutput = generateProRataInvoiceDraft({
            customerName: customer.name,
            productName: product.name,
            pricePerSeat,
            additionalSeats: seatCount,
            changeDate: changeDateObj,
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
              // Evaluate the 7-day window as of when the change actually
              // happened (the notification timestamp), NOT when it is being
              // processed. A notification parsed days later must still be
              // judged against the window that was open at the change date,
              // otherwise a since-expired window is wrongly treated as closed.
              closesAt: { gte: changeDateObj },
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
        proRataFraction?: number;
        proRataDays?: number;
        proRataDaysInMonth?: number;
        proRataAmount?: number;
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
          proRataFraction: Math.round((proRata.daysRemaining / proRata.daysInMonth) * 100) / 100,
          proRataDays: proRata.daysRemaining,
          proRataDaysInMonth: proRata.daysInMonth,
          proRataAmount: proRata.totalAmount,
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

      // ----- Identify a recent seat addition this decrease may be reversing -----
      // Prefer the change linked to an open 7-day window. If none is on record
      // (e.g. only the decrease notification was processed, so the addition's
      // window was never created), fall back to the most recent APPLIED
      // ADD_SEATS change within the 7-day grace period, so a same-day /
      // within-window reversal is still recognised.
      let originalChange = openWindow?.changeId
        ? await tx.subscriptionChange.findUnique({ where: { id: openWindow.changeId } })
        : null;

      if (!originalChange) {
        const graceCutoff = new Date(changeDateObj);
        graceCutoff.setDate(graceCutoff.getDate() - 7);
        originalChange = await tx.subscriptionChange.findFirst({
          where: {
            subscriptionId: subscriptionDbId,
            changeType: "ADD_SEATS",
            status: "APPLIED",
            effectiveDate: { gte: graceCutoff, lte: changeDateObj },
          },
          orderBy: { effectiveDate: "desc" },
        });
      }

      const priorSeatCount = originalChange?.previousSeatCount ?? null;
      // Full reversal = seats returned to EXACTLY the pre-addition level within
      // the grace period (added N seats, then removed exactly those N). That is
      // a true no-op the added-seat pro-rata just cancels out. A reduction that
      // lands BELOW the pre-addition level also removes original seats, so it is
      // a genuine reduction that must be credited — not a no-op reversal. Hence
      // an exact match is required whether or not a window is open; otherwise a
      // deep reduction (e.g. 100→136 then →7) would be misread as a reversal and
      // the seat count wrongly reset to the pre-addition level.
      const isFullReversal =
        priorSeatCount !== null && newQuantity === priorSeatCount;

      if (openWindow || isFullReversal) {
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

          // Close the 7-day window (if one was open)
          if (openWindow) {
            await tx.sevenDayWindow.update({
              where: { id: openWindow.id },
              data: { isClosed: true },
            });
          }

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

          // Surface the original one-time pro-rata charge so the accounting
          // team can act correctly depending on whether it was already sent.
          const addDateStr = originalChange
            ? format(originalChange.effectiveDate, "d MMMM yyyy")
            : "recently";
          const originalProRata = originalChange?.proRataAmount ?? null;
          const proRataStr =
            originalProRata !== null ? formatCurrency(originalProRata, currency) : null;
          const seatsReversed = previousSeatCount - priorSeatCount;
          const seatWord = seatsReversed !== 1 ? "seats" : "seat";

          // Create a clear either/or amendment so the admin knows what happened
          // and whether a credit note is required.
          await tx.amendmentQueueItem.create({
            data: {
              customerId: subscription.customerId,
              description: [
                `GRACE PERIOD REVERSAL — check pro-rata invoice for ${subscription.customer.name}`,
                ``,
                `Product: ${subscription.product.name}`,
                `What happened:`,
                `  • Seat increase: ${priorSeatCount} → ${previousSeatCount} on ${addDateStr}`,
                `  • Seat decrease (reversal): ${previousSeatCount} → ${priorSeatCount} on ${dateStr} (within 7-day grace period)`,
                ``,
                `A one-time pro-rata invoice${proRataStr ? ` of ${proRataStr}` : ""} was raised for the ${seatsReversed} added ${seatWord}.`,
                `Because the ${seatWord} ${seatsReversed !== 1 ? "were" : "was"} reversed within the 7-day window, the customer should pay nothing extra. What to do depends on whether that invoice was already sent:`,
                ``,
                `  • IF the pro-rata invoice${proRataStr ? ` of ${proRataStr}` : ""} was ALREADY SENT to the customer →`,
                `      issue a CREDIT NOTE${proRataStr ? ` for ${proRataStr}` : " for the same amount"} in Xero to cancel it out.`,
                `  • IF it was NOT sent yet →`,
                `      no action needed. The pending pro-rata invoice task has been cancelled automatically.`,
                ``,
                `Net effect to the customer: nothing extra. No change to the repeating invoice in Xero.`,
              ].join("\n"),
              productName: subscription.product.name,
              newMonthlyAmount: pricePerSeat * priorSeatCount,
              newSeatCount: priorSeatCount,
              actionByDate: changeDateObj,
              reason: `Grace period reversal — verify credit note: ${priorSeatCount} → ${previousSeatCount} → ${priorSeatCount} – ${subscription.customer.name}`,
            },
          });

          await tx.auditLog.create({
            data: {
              userId: session.user!.id!,
              action: "CLOUD_IQ_APPLY_GRACE_PERIOD_REVERSAL",
              entityType: "Subscription",
              entityId: subscriptionDbId,
              details: `Cloud-iQ: Grace period full reversal – ${subscription.product.name} seats ${priorSeatCount} → ${previousSeatCount} → ${priorSeatCount}. Net effect nil; credit note required only if the pro-rata invoice${proRataStr ? ` of ${proRataStr}` : ""} was already sent. Event: ${notificationEvent}`,
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
              description: `GRACE PERIOD REVERSAL — check pro-rata invoice. Seats returned to ${priorSeatCount}. If the one-time pro-rata invoice${proRataStr ? ` of ${proRataStr}` : ""} was already sent, issue a credit note for that amount; if not, the pending invoice task has been cancelled.`,
              actionByDate: changeDateObj.toISOString(),
              reason: `Grace period reversal: ${priorSeatCount} → ${previousSeatCount} → ${priorSeatCount}`,
            }],
            message: `Grace period reversal detected — the seat addition was reversed within the 7-day window, so the customer should pay nothing extra. If the one-time pro-rata invoice${proRataStr ? ` of ${proRataStr}` : ""} was already sent, issue a credit note for that amount; otherwise the pending pro-rata invoice task has been cancelled automatically.`,
          };
        }

        // ================================================================
        // BELOW-BASELINE within-window reduction → SPLIT (review note)
        // ================================================================
        // The customer added seats within the 7-day window and has now reduced
        // BELOW the pre-addition level. Two different things are happening and
        // they bill differently:
        //   • the recently-added seats (still in their 7-day window) are
        //     creditable now, but
        //   • the original committed seats can only be reduced at renewal.
        // Auto-crediting the whole reduction would over-credit seats Crayon /
        // Microsoft does not refund mid-term, so surface ONE clear review
        // instruction that splits the two, and schedule the renewal-side
        // reduction rather than crediting the lot.
        if (priorSeatCount !== null && newQuantity < priorSeatCount) {
          const addedWithinWindow = previousSeatCount - priorSeatCount;
          const reduceAtRenewal = priorSeatCount - newQuantity;

          const addedCredit = calculateSeatReductionCredit({
            pricePerSeat,
            seatsRemoved: addedWithinWindow,
            reductionDate: changeDateObj,
          });

          const upcomingRenewalDate = getUpcomingRenewalDate(
            subscription.renewalDate,
            subscription.termType,
            changeDateObj
          );
          const renewalDateStr = format(upcomingRenewalDate, "d MMMM yyyy");
          const newMonthlyAtRenewal = pricePerSeat * newQuantity;

          // Billing returns to the pre-addition baseline now (added seats
          // cancelled within window); the deeper reduction lands at renewal.
          await tx.subscription.update({
            where: { id: subscriptionDbId },
            data: { seatCount: priorSeatCount },
          });

          const change = await tx.subscriptionChange.create({
            data: {
              subscriptionId: subscriptionDbId,
              changeType: "REMOVE_SEATS",
              status: "APPLIED",
              effectiveDate: changeDateObj,
              previousSeatCount,
              newSeatCount: priorSeatCount,
              proRataAmount: -addedCredit.totalCredit,
              billingCurrency: currency,
              notes: `Within-window cancellation of ${addedWithinWindow} recently-added seat(s). Reduction drops below pre-addition level (${priorSeatCount}); remaining reduction to ${newQuantity} scheduled for renewal. Event: ${notificationEvent}`,
              createdById: session.user!.id!,
            },
          });

          // The addition's window has now been actioned.
          if (openWindow) {
            await tx.sevenDayWindow.update({
              where: { id: openWindow.id },
              data: { isClosed: true },
            });
          }

          // Schedule the original-seat reduction for renewal.
          await tx.scheduledChange.create({
            data: {
              subscriptionId: subscriptionDbId,
              changeType: "REMOVE_SEATS",
              scheduledDate: upcomingRenewalDate,
              targetSeatCount: newQuantity,
              notes: `Cloud-iQ: Reduce seats from ${priorSeatCount} to ${newQuantity} at renewal (original committed seats, outside 7-day window)`,
            },
          });

          await tx.amendmentQueueItem.create({
            data: {
              customerId: subscription.customerId,
              isScheduledChange: true,
              description: [
                `REVIEW: SPLIT SEAT REDUCTION for ${subscription.customer.name}`,
                ``,
                `Product: ${subscription.product.name}`,
                `Cloud-iQ change: ${previousSeatCount} → ${newQuantity} seats on ${dateStr}`,
                `Pre-addition level: ${priorSeatCount} seats`,
                ``,
                `This reduction drops BELOW the pre-addition level, so it splits in two:`,
                ``,
                `PART 1 — ${addedWithinWindow} recently-added seat${addedWithinWindow !== 1 ? "s" : ""} (within 7-day window) → CREDITABLE NOW`,
                `  • Added within the last 7 days, so they can be cancelled.`,
                `  • If their one-time pro-rata invoice was already sent, issue a credit note of`,
                `    up to ${formatCurrency(addedCredit.totalCredit, currency)} (${addedWithinWindow} × unused portion of the month).`,
                `  • If it was not sent, no credit is needed.`,
                ``,
                `PART 2 — ${reduceAtRenewal} original seat${reduceAtRenewal !== 1 ? "s" : ""} → REDUCE AT RENEWAL (${renewalDateStr})`,
                `  • Original committed seats cannot be reduced mid-term — they bill until renewal.`,
                `  • Do NOT credit these now.`,
                `  • On ${renewalDateStr}: update the repeating invoice in Xero to ${newQuantity} seat${newQuantity !== 1 ? "s" : ""}`,
                `    = ${formatCurrency(newMonthlyAtRenewal, currency)} (${newQuantity} × ${formatCurrency(pricePerSeat, currency)}).`,
                ``,
                `Until renewal the customer continues to be billed for ${priorSeatCount} seats.`,
              ].join("\n"),
              productName: subscription.product.name,
              newMonthlyAmount: newMonthlyAtRenewal,
              newSeatCount: newQuantity,
              actionByDate: changeDateObj,
              reason: `Split reduction (review): ${previousSeatCount} → ${newQuantity}; ${addedWithinWindow} creditable now, ${reduceAtRenewal} at renewal – ${subscription.customer.name}`,
            },
          });

          await tx.auditLog.create({
            data: {
              userId: session.user!.id!,
              action: "CLOUD_IQ_APPLY_SPLIT_REDUCTION",
              entityType: "Subscription",
              entityId: subscriptionDbId,
              details: `Cloud-iQ: Split reduction – ${addedWithinWindow} added seat(s) creditable within window, ${reduceAtRenewal} original seat(s) scheduled for renewal ${renewalDateStr}. ${previousSeatCount} → ${newQuantity}. Event: ${notificationEvent}`,
              proRataAmount: -addedCredit.totalCredit,
              sevenDayWindowOpen: false,
              scheduledChangeCreated: true,
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
            scheduledFor: renewalDateStr,
            currency,
            tasks: [{
              description: `SPLIT REDUCTION (review): ${addedWithinWindow} recently-added seat(s) creditable now (up to ${formatCurrency(addedCredit.totalCredit, currency)} if the pro-rata was already invoiced); ${reduceAtRenewal} original seat(s) reduce at renewal (${renewalDateStr}). Billed at ${priorSeatCount} until then.`,
              actionByDate: changeDateObj.toISOString(),
              reason: `Split reduction: ${previousSeatCount} → ${newQuantity}`,
            }],
            message: `This reduction drops below the pre-addition level, so it was split: ${addedWithinWindow} recently-added seat(s) are creditable now, and ${reduceAtRenewal} original seat(s) are scheduled to reduce at renewal (${renewalDateStr}). One review task has been created — please confirm the credit for the added seats and the renewal-side reduction.`,
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

      // Outside 7-day window: schedule for renewal.
      // The subscription's stored renewalDate may be a past anniversary, so roll
      // it forward to the next renewal on or after the change date.
      const upcomingRenewalDate = getUpcomingRenewalDate(
        subscription.renewalDate,
        subscription.termType,
        changeDateObj
      );

      const change = await tx.subscriptionChange.create({
        data: {
          subscriptionId: subscriptionDbId,
          changeType: "REMOVE_SEATS",
          status: "SCHEDULED",
          effectiveDate: upcomingRenewalDate,
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
          scheduledDate: upcomingRenewalDate,
          targetSeatCount: newQuantity,
          notes: `Cloud-iQ: Reduce seats from ${previousSeatCount} to ${newQuantity} at renewal`,
        },
      });

      const renewalDateStr = format(upcomingRenewalDate, "d MMMM yyyy");

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
        actionByDate: upcomingRenewalDate,
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
