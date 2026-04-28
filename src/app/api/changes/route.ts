import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { ChangeType } from "@/generated/prisma";
import {
  calculateProRata,
  calculateSeatReductionCredit,
  calculateRenewalWindowReduction,
  calculateUpgradeCost,
  calculate7DayWindow,
  formatCurrency,
} from "@/lib/billing-calculations";
import {
  generateProRataInvoiceDraft,
  generateCreditNoteDraft,
  generateUpgradeInvoiceDraft,
} from "@/lib/invoice-generator";
import { format } from "date-fns";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const subscriptionId = searchParams.get("subscriptionId");
    const type = searchParams.get("type");
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const changes = await prisma.subscriptionChange.findMany({
      where: {
        ...(subscriptionId && { subscriptionId }),
        ...(type && { changeType: type as ChangeType }),
      },
      include: {
        subscription: {
          include: {
            customer: true,
            product: true,
          },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        invoiceDraft: {
          include: { lineItems: true },
        },
        sevenDayWindow: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json(changes);
  } catch (error) {
    console.error("Error fetching changes:", error);
    return NextResponse.json(
      { error: "Failed to fetch changes" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { subscriptionId, changeType, effectiveDate, newSeatCount, newProductId, notes } = body;

    if (!subscriptionId || !changeType || !effectiveDate) {
      return NextResponse.json(
        { error: "subscriptionId, changeType, and effectiveDate are required" },
        { status: 400 }
      );
    }

    const changeDateObj = new Date(effectiveDate);

    const result = await prisma.$transaction(async (tx) => {
      // Fetch the subscription with related data
      const subscription = await tx.subscription.findUnique({
        where: { id: subscriptionId },
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

      switch (changeType as ChangeType) {
        // =====================================================================
        // ADD SEATS
        // =====================================================================
        case "ADD_SEATS": {
          if (!newSeatCount || newSeatCount <= subscription.seatCount) {
            throw new Error("newSeatCount must be greater than current seat count");
          }

          const additionalSeats = newSeatCount - subscription.seatCount;
          const previousSeatCount = subscription.seatCount;

          // Calculate pro rata
          const proRata = calculateProRata({
            pricePerSeat,
            additionalSeats,
            changeDate: changeDateObj,
            currency,
          });

          // Update subscription seat count
          await tx.subscription.update({
            where: { id: subscriptionId },
            data: { seatCount: newSeatCount },
          });

          // Create change record
          const change = await tx.subscriptionChange.create({
            data: {
              subscriptionId,
              changeType: "ADD_SEATS",
              status: "APPLIED",
              effectiveDate: changeDateObj,
              previousSeatCount,
              newSeatCount,
              proRataAmount: proRata.totalAmount,
              proRataDays: proRata.daysRemaining,
              proRataDailyRate: proRata.dailyRate,
              billingCurrency: currency,
              notes,
              createdById: session.user!.id!,
            },
          });

          // Create 7-day window for mid-term addition
          const { opensAt, closesAt } = calculate7DayWindow(changeDateObj);
          await tx.sevenDayWindow.create({
            data: {
              subscriptionId,
              changeId: change.id,
              windowType: "MID_TERM_ADDITION",
              opensAt,
              closesAt,
              seatsAffected: additionalSeats,
            },
          });

          // Generate invoice draft
          const invoiceDraftOutput = generateProRataInvoiceDraft({
            customerName: subscription.customer.name,
            productName: subscription.product.name,
            pricePerSeat,
            additionalSeats,
            changeDate: changeDateObj,
            currentSeatCount: previousSeatCount,
            currency,
          });

          // Create invoice draft in DB
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

          // Amendment tasks
          const dateStr = format(changeDateObj, "d MMMM yyyy");
          const nextMonthDate = new Date(changeDateObj.getFullYear(), changeDateObj.getMonth() + 1, 1);
          const nextMonthName = format(nextMonthDate, "MMMM yyyy");
          const xeroQty = (proRata.daysRemaining / proRata.daysInMonth).toFixed(5);
          const xeroUnitPrice = pricePerSeat * additionalSeats;
          const newMonthlyTotal = pricePerSeat * newSeatCount;

          // Task 1: Send one-time pro-rata invoice
          await tx.amendmentQueueItem.create({
            data: {
              customerId: subscription.customerId,
              description: [
                `SEND ONE-TIME PRO-RATA INVOICE to ${subscription.customer.name}`,
                ``,
                `Amount: ${formatCurrency(proRata.totalAmount, currency)} (excl. VAT)`,
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
                `Xero invoice entry:`,
                `  Description: ${subscription.product.name} – Pro rata (${format(proRata.periodStart, "d MMM")} – ${format(proRata.periodEnd, "d MMM yyyy")})`,
                `  Quantity:    ${xeroQty}  (${proRata.daysRemaining} days ÷ ${proRata.daysInMonth} days in month)`,
                `  Unit price:  ${formatCurrency(xeroUnitPrice, currency)}  (${additionalSeats} seat${additionalSeats !== 1 ? "s" : ""} × ${formatCurrency(pricePerSeat, currency)}/month)`,
                `  Line total:  ${formatCurrency(proRata.totalAmount, currency)}`,
                ``,
                `Create this as a one-time invoice in Xero (NOT on the repeating invoice).`,
              ].join("\n"),
              productName: subscription.product.name,
              newMonthlyAmount: proRata.totalAmount,
              newSeatCount: additionalSeats,
              actionByDate: changeDateObj,
              reason: `Pro-rata invoice for ${additionalSeats} new seat${additionalSeats !== 1 ? "s" : ""} – ${subscription.customer.name}`,
              proRataFraction: Math.round((proRata.daysRemaining / proRata.daysInMonth) * 10000) / 10000,
              proRataDays: proRata.daysRemaining,
              proRataDaysInMonth: proRata.daysInMonth,
              proRataAmount: proRata.totalAmount,
            },
          });

          // Task 2: Update repeating invoice from next month
          await tx.amendmentQueueItem.create({
            data: {
              customerId: subscription.customerId,
              description: [
                `UPDATE REPEATING INVOICE for ${subscription.customer.name} in Xero`,
                ``,
                `Product: ${subscription.product.name}`,
                `Change: ${previousSeatCount} seats → ${newSeatCount} seats`,
                `New monthly amount: ${formatCurrency(newMonthlyTotal, currency)} (${newSeatCount} × ${formatCurrency(pricePerSeat, currency)})`,
                `Effective from: 1 ${nextMonthName}`,
                ``,
                `DO NOT change the current month's repeating invoice – it has already been billed.`,
                `Only update the repeating invoice so that from 1 ${nextMonthName} it reflects ${newSeatCount} seats.`,
              ].join("\n"),
              productName: subscription.product.name,
              newMonthlyAmount: newMonthlyTotal,
              newSeatCount,
              actionByDate: nextMonthDate,
              reason: `Seat increase: ${previousSeatCount} → ${newSeatCount} effective ${dateStr}`,
            },
          });

          // Audit log
          await tx.auditLog.create({
            data: {
              userId: session.user!.id!,
              action: "ADD_SEATS",
              entityType: "Subscription",
              entityId: subscriptionId,
              details: `Added ${additionalSeats} seats (${previousSeatCount} → ${newSeatCount}). Pro rata: ${proRata.totalAmount} ${currency}`,
              proRataAmount: proRata.totalAmount,
              sevenDayWindowOpen: true,
              xeroInstructionsGen: true,
            },
          });

          return {
            change,
            proRata,
            invoiceDraft: invoiceDraftOutput,
          };
        }

        // =====================================================================
        // REMOVE SEATS
        // =====================================================================
        case "REMOVE_SEATS": {
          if (!newSeatCount || newSeatCount >= subscription.seatCount) {
            throw new Error("newSeatCount must be less than current seat count");
          }

          const seatsRemoved = subscription.seatCount - newSeatCount;
          const previousSeatCount = subscription.seatCount;

          // Check if within any open 7-day window
          const openWindow = subscription.sevenDayWindows.length > 0
            ? subscription.sevenDayWindows[0]
            : null;

          if (openWindow && openWindow.windowType === "RENEWAL") {
            // RENEWAL WINDOW: usage charge (renewal date → reduction date) + full-month credit
            const renewalDate = openWindow.opensAt;
            const renewalCalc = calculateRenewalWindowReduction({
              pricePerSeat,
              seatsRemoved,
              renewalDate,
              reductionDate: changeDateObj,
              currency,
            });

            await tx.subscription.update({
              where: { id: subscriptionId },
              data: { seatCount: newSeatCount },
            });

            const change = await tx.subscriptionChange.create({
              data: {
                subscriptionId,
                changeType: "REMOVE_SEATS",
                status: "APPLIED",
                effectiveDate: changeDateObj,
                previousSeatCount,
                newSeatCount,
                proRataAmount: -renewalCalc.netRefund,
                proRataDays: renewalCalc.daysUsed,
                proRataDailyRate: renewalCalc.dailyRate,
                billingCurrency: currency,
                notes: notes || "Within 7-day renewal window — usage charge issued, full month credit applied",
                createdById: session.user!.id!,
              },
            });

            const dateStr = format(changeDateObj, "d MMMM yyyy");
            const nextMonthDate = new Date(changeDateObj.getFullYear(), changeDateObj.getMonth() + 1, 1);
            const nextMonthName = format(nextMonthDate, "MMMM yyyy");
            const xeroUsageQty = (renewalCalc.daysUsed / renewalCalc.daysInMonth).toFixed(5);
            const xeroUsageUnitPrice = pricePerSeat * seatsRemoved;
            const newMonthlyTotal = pricePerSeat * newSeatCount;

            // Task 1: CREDIT NOTE — full month refund for removed seats
            await tx.amendmentQueueItem.create({
              data: {
                customerId: subscription.customerId,
                description: [
                  `ISSUE CREDIT NOTE to ${subscription.customer.name}`,
                  ``,
                  `Amount: ${formatCurrency(renewalCalc.totalMonthlyCredit, currency)} (excl. VAT)`,
                  `Product: ${subscription.product.name}`,
                  `Reason: ${seatsRemoved} seat${seatsRemoved !== 1 ? "s" : ""} removed within 7-day renewal window`,
                  ``,
                  `This reverses the full monthly charge for the ${seatsRemoved} removed seat${seatsRemoved !== 1 ? "s" : ""}.`,
                  `Credit: ${formatCurrency(pricePerSeat, currency)}/seat × ${seatsRemoved} seat${seatsRemoved !== 1 ? "s" : ""} = ${formatCurrency(renewalCalc.totalMonthlyCredit, currency)}`,
                  ``,
                  `Create a credit note in Xero for ${formatCurrency(renewalCalc.totalMonthlyCredit, currency)}.`,
                ].join("\n"),
                productName: subscription.product.name,
                newMonthlyAmount: -renewalCalc.totalMonthlyCredit,
                newSeatCount: seatsRemoved,
                actionByDate: changeDateObj,
                reason: `Renewal window credit note for ${seatsRemoved} removed seat${seatsRemoved !== 1 ? "s" : ""} – ${subscription.customer.name}`,
                proRataAmount: -renewalCalc.totalMonthlyCredit,
              },
            });

            // Task 2: USAGE INVOICE — charge for days used (renewal date → reduction date)
            await tx.amendmentQueueItem.create({
              data: {
                customerId: subscription.customerId,
                description: [
                  `SEND USAGE INVOICE to ${subscription.customer.name}`,
                  ``,
                  `Amount: ${formatCurrency(renewalCalc.totalUsageCharge, currency)} (excl. VAT)`,
                  `Product: ${subscription.product.name}`,
                  `Reason: Usage charge for ${seatsRemoved} seat${seatsRemoved !== 1 ? "s" : ""} from renewal to reduction`,
                  `Period: ${format(renewalCalc.periodStart, "d MMM")} – ${format(renewalCalc.periodEnd, "d MMM yyyy")} (${renewalCalc.daysUsed} days)`,
                  ``,
                  `Calculation:`,
                  `  Rate per seat: ${formatCurrency(pricePerSeat, currency)}/month`,
                  `  Daily rate: ${formatCurrency(renewalCalc.dailyRate, currency)} (${formatCurrency(pricePerSeat, currency)} ÷ ${renewalCalc.daysInMonth} days)`,
                  `  Days used: ${renewalCalc.daysUsed}`,
                  `  Per seat: ${formatCurrency(renewalCalc.usagePerSeat, currency)}`,
                  `  Total: ${formatCurrency(renewalCalc.usagePerSeat, currency)} × ${seatsRemoved} = ${formatCurrency(renewalCalc.totalUsageCharge, currency)}`,
                  ``,
                  `Xero invoice entry:`,
                  `  Description: ${subscription.product.name} – Usage (${format(renewalCalc.periodStart, "d MMM")} – ${format(renewalCalc.periodEnd, "d MMM yyyy")})`,
                  `  Quantity:    ${xeroUsageQty}  (${renewalCalc.daysUsed} days ÷ ${renewalCalc.daysInMonth} days in month)`,
                  `  Unit price:  ${formatCurrency(xeroUsageUnitPrice, currency)}  (${seatsRemoved} seat${seatsRemoved !== 1 ? "s" : ""} × ${formatCurrency(pricePerSeat, currency)}/month)`,
                  `  Line total:  ${formatCurrency(renewalCalc.totalUsageCharge, currency)}`,
                  ``,
                  `Net refund to customer: ${formatCurrency(renewalCalc.totalMonthlyCredit, currency)} − ${formatCurrency(renewalCalc.totalUsageCharge, currency)} = ${formatCurrency(renewalCalc.netRefund, currency)}`,
                  `Create this as a one-time invoice in Xero (NOT on the repeating invoice).`,
                ].join("\n"),
                productName: subscription.product.name,
                newMonthlyAmount: renewalCalc.totalUsageCharge,
                newSeatCount: seatsRemoved,
                actionByDate: changeDateObj,
                reason: `Usage invoice for ${seatsRemoved} removed seat${seatsRemoved !== 1 ? "s" : ""} (renewal window) – ${subscription.customer.name}`,
                proRataFraction: Math.round((renewalCalc.daysUsed / renewalCalc.daysInMonth) * 10000) / 10000,
                proRataDays: renewalCalc.daysUsed,
                proRataDaysInMonth: renewalCalc.daysInMonth,
                proRataAmount: renewalCalc.totalUsageCharge,
              },
            });

            // Task 3: UPDATE repeating invoice from next month
            await tx.amendmentQueueItem.create({
              data: {
                customerId: subscription.customerId,
                description: [
                  `UPDATE REPEATING INVOICE for ${subscription.customer.name} in Xero`,
                  ``,
                  `Product: ${subscription.product.name}`,
                  `Change: ${previousSeatCount} seats → ${newSeatCount} seats`,
                  `New monthly amount: ${formatCurrency(newMonthlyTotal, currency)} (${newSeatCount} × ${formatCurrency(pricePerSeat, currency)})`,
                  `Effective from: 1 ${nextMonthName}`,
                  ``,
                  `Update the repeating invoice so that from 1 ${nextMonthName} it reflects ${newSeatCount} seats.`,
                ].join("\n"),
                productName: subscription.product.name,
                newMonthlyAmount: newMonthlyTotal,
                newSeatCount,
                actionByDate: nextMonthDate,
                reason: `Seat decrease (renewal window): ${previousSeatCount} → ${newSeatCount} effective ${dateStr}`,
              },
            });

            await tx.auditLog.create({
              data: {
                userId: session.user!.id!,
                action: "REMOVE_SEATS",
                entityType: "Subscription",
                entityId: subscriptionId,
                details: `Removed ${seatsRemoved} seats within 7-day RENEWAL window (${previousSeatCount} → ${newSeatCount}). Usage charge: ${formatCurrency(renewalCalc.totalUsageCharge, currency)}. Net refund: ${formatCurrency(renewalCalc.netRefund, currency)}.`,
                proRataAmount: -renewalCalc.netRefund,
                sevenDayWindowOpen: true,
                xeroInstructionsGen: true,
              },
            });

            return {
              change,
              renewalWindowReduction: renewalCalc,
              withinWindow: true,
              windowType: "RENEWAL",
              message: `Renewal window seat reduction: ${seatsRemoved} seat${seatsRemoved !== 1 ? "s" : ""} removed. Usage invoice: ${formatCurrency(renewalCalc.totalUsageCharge, currency)} (excl. VAT). Full month credit: ${formatCurrency(renewalCalc.totalMonthlyCredit, currency)}. Net refund: ${formatCurrency(renewalCalc.netRefund, currency)}.`,
            };

          } else if (openWindow) {
            // MID_TERM_ADDITION / NEW_SUBSCRIPTION window
            // Check if this is a full reversal (grace period cancellation)
            const originalChange = openWindow.changeId
              ? await tx.subscriptionChange.findUnique({ where: { id: openWindow.changeId } })
              : null;
            const priorSeatCount = originalChange?.previousSeatCount ?? null;
            const isFullReversal = priorSeatCount !== null && newSeatCount <= priorSeatCount;

            if (isFullReversal) {
              // GRACE PERIOD FULL REVERSAL — no billing impact
              const restoredSeatCount = priorSeatCount;

              await tx.subscription.update({
                where: { id: subscriptionId },
                data: { seatCount: restoredSeatCount },
              });

              const change = await tx.subscriptionChange.create({
                data: {
                  subscriptionId,
                  changeType: "REMOVE_SEATS",
                  status: "APPLIED",
                  effectiveDate: changeDateObj,
                  previousSeatCount,
                  newSeatCount: restoredSeatCount,
                  proRataAmount: 0,
                  billingCurrency: currency,
                  notes: notes || `Grace period full reversal – seats returned to ${restoredSeatCount}. No billing impact.`,
                  createdById: session.user!.id!,
                },
              });

              // Close the 7-day window
              await tx.sevenDayWindow.update({
                where: { id: openWindow.id },
                data: { isClosed: true },
              });

              // Cancel pending amendment queue items for this customer + product
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

              await tx.amendmentQueueItem.create({
                data: {
                  customerId: subscription.customerId,
                  description: [
                    `NO BILLING ACTION REQUIRED — Grace period reversal for ${subscription.customer.name}`,
                    ``,
                    `Product: ${subscription.product.name}`,
                    `Seats returned to ${restoredSeatCount} within 7-day grace period.`,
                    `No pro-rata invoice or credit note needed.`,
                    `No changes needed to the repeating invoice in Xero.`,
                  ].join("\n"),
                  productName: subscription.product.name,
                  newMonthlyAmount: pricePerSeat * restoredSeatCount,
                  newSeatCount: restoredSeatCount,
                  actionByDate: changeDateObj,
                  reason: `Grace period reversal: ${restoredSeatCount} → ${previousSeatCount} → ${restoredSeatCount} – ${subscription.customer.name}`,
                },
              });

              await tx.auditLog.create({
                data: {
                  userId: session.user!.id!,
                  action: "GRACE_PERIOD_REVERSAL",
                  entityType: "Subscription",
                  entityId: subscriptionId,
                  details: `Grace period full reversal – ${subscription.product.name} seats ${restoredSeatCount} → ${previousSeatCount} → ${restoredSeatCount}. No billing impact.`,
                  proRataAmount: 0,
                  sevenDayWindowOpen: false,
                },
              });

              return {
                change,
                isGracePeriodReversal: true,
                withinWindow: true,
                message: `Grace period reversal detected. Seats returned to ${restoredSeatCount}. No billing changes needed — previous amendment tasks cancelled.`,
              };
            }

            // Within 7-day window (partial decrease): immediate reduction with credit
            await tx.subscription.update({
              where: { id: subscriptionId },
              data: { seatCount: newSeatCount },
            });

            const creditResult = calculateSeatReductionCredit({
              pricePerSeat,
              seatsRemoved,
              reductionDate: changeDateObj,
            });

            const change = await tx.subscriptionChange.create({
              data: {
                subscriptionId,
                changeType: "REMOVE_SEATS",
                status: "APPLIED",
                effectiveDate: changeDateObj,
                previousSeatCount,
                newSeatCount,
                proRataAmount: -creditResult.totalCredit,
                proRataDays: creditResult.daysRemaining,
                proRataDailyRate: creditResult.dailyRate,
                billingCurrency: currency,
                notes: notes || "Within 7-day window - immediate reduction with credit",
                createdById: session.user!.id!,
              },
            });

            // Generate credit note draft
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

            await tx.auditLog.create({
              data: {
                userId: session.user!.id!,
                action: "REMOVE_SEATS",
                entityType: "Subscription",
                entityId: subscriptionId,
                details: `Removed ${seatsRemoved} seats within 7-day window (${previousSeatCount} → ${newSeatCount}). Credit: ${creditResult.totalCredit} ${currency}`,
                proRataAmount: -creditResult.totalCredit,
                sevenDayWindowOpen: true,
                xeroInstructionsGen: true,
              },
            });

            return {
              change,
              creditNote: creditNoteDraft,
              withinWindow: true,
            };
          } else {
            // Outside 7-day window: schedule for next renewal
            const change = await tx.subscriptionChange.create({
              data: {
                subscriptionId,
                changeType: "REMOVE_SEATS",
                status: "SCHEDULED",
                effectiveDate: subscription.renewalDate,
                previousSeatCount,
                newSeatCount,
                billingCurrency: currency,
                notes: notes || "Outside 7-day window - scheduled for next renewal",
                createdById: session.user!.id!,
              },
            });

            const scheduledChange = await tx.scheduledChange.create({
              data: {
                subscriptionId,
                changeType: "REMOVE_SEATS",
                scheduledDate: subscription.renewalDate,
                targetSeatCount: newSeatCount,
                notes: `Reduce seats from ${previousSeatCount} to ${newSeatCount} at renewal`,
              },
            });

            await tx.auditLog.create({
              data: {
                userId: session.user!.id!,
                action: "SCHEDULE_REMOVE_SEATS",
                entityType: "Subscription",
                entityId: subscriptionId,
                details: `Scheduled seat reduction (${previousSeatCount} → ${newSeatCount}) for renewal date ${subscription.renewalDate.toISOString().split("T")[0]}. Outside 7-day window.`,
                sevenDayWindowOpen: false,
                scheduledChangeCreated: true,
              },
            });

            return {
              change,
              scheduledChange,
              withinWindow: false,
              message: `Seat reduction scheduled for renewal date: ${subscription.renewalDate.toISOString().split("T")[0]}`,
            };
          }
        }

        // =====================================================================
        // UPGRADE
        // =====================================================================
        case "UPGRADE": {
          if (!newProductId) {
            throw new Error("newProductId is required for upgrades");
          }

          const newProduct = await tx.product.findUnique({
            where: { id: newProductId },
          });

          if (!newProduct) {
            throw new Error("New product not found");
          }

          // Get price for new product
          const newProductPrice = await tx.customerPrice.findFirst({
            where: {
              customerId: subscription.customerId,
              productId: newProductId,
              effectiveTo: null,
            },
            orderBy: { effectiveFrom: "desc" },
          });

          const newPricePerSeat = newProductPrice?.pricePerSeat ?? 0;

          // Calculate upgrade cost
          const upgradeResult = calculateUpgradeCost({
            oldPricePerSeat: pricePerSeat,
            newPricePerSeat,
            seats: subscription.seatCount,
            changeDate: changeDateObj,
          });

          const previousProductId = subscription.productId;

          // Create change record
          const change = await tx.subscriptionChange.create({
            data: {
              subscriptionId,
              changeType: "UPGRADE",
              status: "APPLIED",
              effectiveDate: changeDateObj,
              previousSeatCount: subscription.seatCount,
              newSeatCount: subscription.seatCount,
              previousProductId,
              newProductId,
              proRataAmount: upgradeResult.netAmount,
              billingCurrency: currency,
              notes,
              createdById: session.user!.id!,
            },
          });

          // Generate upgrade invoice draft
          const upgradeDraft = generateUpgradeInvoiceDraft({
            customerName: subscription.customer.name,
            oldProductName: subscription.product.name,
            newProductName: newProduct.name,
            oldPricePerSeat: pricePerSeat,
            newPricePerSeat,
            seats: subscription.seatCount,
            changeDate: changeDateObj,
            currency,
          });

          await tx.invoiceDraft.create({
            data: {
              customerId: subscription.customerId,
              changeId: change.id,
              draftType: "UPGRADE_ADJUSTMENT",
              invoiceDate: changeDateObj,
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

          // Update subscription product
          await tx.subscription.update({
            where: { id: subscriptionId },
            data: { productId: newProductId },
          });

          // Create amendment queue item
          await tx.amendmentQueueItem.create({
            data: {
              customerId: subscription.customerId,
              description: `Update repeating invoice: change product from ${subscription.product.name} to ${newProduct.name}`,
              productName: newProduct.name,
              newMonthlyAmount: newPricePerSeat * subscription.seatCount,
              newSeatCount: subscription.seatCount,
              actionByDate: new Date(changeDateObj.getFullYear(), changeDateObj.getMonth() + 1, 1),
              reason: `Product upgrade: ${subscription.product.name} → ${newProduct.name} effective ${changeDateObj.toISOString().split("T")[0]}`,
              proRataFraction: Math.round((upgradeResult.charge.daysRemaining / upgradeResult.charge.daysInMonth) * 100) / 100,
              proRataDays: upgradeResult.charge.daysRemaining,
              proRataDaysInMonth: upgradeResult.charge.daysInMonth,
              proRataAmount: upgradeResult.netAmount,
            },
          });

          // Audit log
          await tx.auditLog.create({
            data: {
              userId: session.user!.id!,
              action: "UPGRADE",
              entityType: "Subscription",
              entityId: subscriptionId,
              details: `Upgraded from ${subscription.product.name} to ${newProduct.name}. Net adjustment: ${upgradeResult.netAmount} ${currency}`,
              proRataAmount: upgradeResult.netAmount,
              xeroInstructionsGen: true,
            },
          });

          return {
            change,
            upgradeResult,
            invoiceDraft: upgradeDraft,
          };
        }

        // =====================================================================
        // DOWNGRADE
        // =====================================================================
        case "DOWNGRADE": {
          if (!newProductId) {
            throw new Error("newProductId is required for downgrades");
          }

          const downgradeProduct = await tx.product.findUnique({
            where: { id: newProductId },
          });

          if (!downgradeProduct) {
            throw new Error("New product not found");
          }

          // Annual term: block mid-term downgrade, schedule instead
          if (subscription.termType === "ANNUAL" || subscription.termType === "THREE_YEAR") {
            const change = await tx.subscriptionChange.create({
              data: {
                subscriptionId,
                changeType: "DOWNGRADE",
                status: "SCHEDULED",
                effectiveDate: subscription.renewalDate,
                previousProductId: subscription.productId,
                newProductId,
                billingCurrency: currency,
                notes: notes || "Annual/multi-year term - downgrade scheduled for renewal",
                createdById: session.user!.id!,
              },
            });

            const scheduledChange = await tx.scheduledChange.create({
              data: {
                subscriptionId,
                changeType: "DOWNGRADE",
                scheduledDate: subscription.renewalDate,
                targetProductId: newProductId,
                notes: `Downgrade from ${subscription.product.name} to ${downgradeProduct.name} at renewal`,
              },
            });

            await tx.auditLog.create({
              data: {
                userId: session.user!.id!,
                action: "SCHEDULE_DOWNGRADE",
                entityType: "Subscription",
                entityId: subscriptionId,
                details: `Mid-term downgrade blocked (${subscription.termType} term). Scheduled for renewal: ${subscription.renewalDate.toISOString().split("T")[0]}`,
                scheduledChangeCreated: true,
              },
            });

            return {
              change,
              scheduledChange,
              message: `Downgrade scheduled for renewal date: ${subscription.renewalDate.toISOString().split("T")[0]}. Mid-term downgrades are not allowed on ${subscription.termType} terms.`,
            };
          }

          // Monthly term: process immediately
          const newDowngradePrice = await tx.customerPrice.findFirst({
            where: {
              customerId: subscription.customerId,
              productId: newProductId,
              effectiveTo: null,
            },
            orderBy: { effectiveFrom: "desc" },
          });

          const downPricePerSeat = newDowngradePrice?.pricePerSeat ?? 0;
          const previousProductId = subscription.productId;

          const change = await tx.subscriptionChange.create({
            data: {
              subscriptionId,
              changeType: "DOWNGRADE",
              status: "APPLIED",
              effectiveDate: changeDateObj,
              previousProductId,
              newProductId,
              previousSeatCount: subscription.seatCount,
              newSeatCount: subscription.seatCount,
              billingCurrency: currency,
              notes,
              createdById: session.user!.id!,
            },
          });

          // Update subscription product
          await tx.subscription.update({
            where: { id: subscriptionId },
            data: { productId: newProductId },
          });

          // Create amendment queue item
          await tx.amendmentQueueItem.create({
            data: {
              customerId: subscription.customerId,
              description: `Update repeating invoice: change product from ${subscription.product.name} to ${downgradeProduct.name} (downgrade)`,
              productName: downgradeProduct.name,
              newMonthlyAmount: downPricePerSeat * subscription.seatCount,
              newSeatCount: subscription.seatCount,
              actionByDate: new Date(changeDateObj.getFullYear(), changeDateObj.getMonth() + 1, 1),
              reason: `Product downgrade: ${subscription.product.name} → ${downgradeProduct.name} effective ${changeDateObj.toISOString().split("T")[0]}`,
            },
          });

          await tx.auditLog.create({
            data: {
              userId: session.user!.id!,
              action: "DOWNGRADE",
              entityType: "Subscription",
              entityId: subscriptionId,
              details: `Downgraded from ${subscription.product.name} to ${downgradeProduct.name} (monthly term - immediate)`,
              xeroInstructionsGen: true,
            },
          });

          return {
            change,
            message: "Downgrade applied immediately (monthly term)",
          };
        }

        // =====================================================================
        // RENEWAL — record the renewal and open a 7-day modification window
        // =====================================================================
        case "RENEWAL": {
          // Calculate new renewal/term-end dates based on term type
          let newRenewalDate: Date;
          if (subscription.termType === "MONTHLY") {
            newRenewalDate = new Date(changeDateObj.getFullYear(), changeDateObj.getMonth() + 1, 1);
          } else if (subscription.termType === "THREE_YEAR") {
            newRenewalDate = new Date(changeDateObj.getFullYear() + 3, changeDateObj.getMonth(), 1);
          } else {
            newRenewalDate = new Date(changeDateObj.getFullYear() + 1, changeDateObj.getMonth(), 1);
          }

          await tx.subscription.update({
            where: { id: subscriptionId },
            data: {
              startDate: changeDateObj,
              renewalDate: newRenewalDate,
              termEndDate: newRenewalDate,
              status: "ACTIVE",
            },
          });

          const change = await tx.subscriptionChange.create({
            data: {
              subscriptionId,
              changeType: "RENEWAL",
              status: "APPLIED",
              effectiveDate: changeDateObj,
              previousSeatCount: subscription.seatCount,
              newSeatCount: subscription.seatCount,
              billingCurrency: currency,
              notes,
              createdById: session.user!.id!,
            },
          });

          // Open 7-day RENEWAL window — seat reductions are allowed immediately
          const { opensAt, closesAt } = calculate7DayWindow(changeDateObj);
          await tx.sevenDayWindow.create({
            data: {
              subscriptionId,
              changeId: change.id,
              windowType: "RENEWAL",
              opensAt,
              closesAt,
              seatsAffected: subscription.seatCount,
            },
          });

          await tx.auditLog.create({
            data: {
              userId: session.user!.id!,
              action: "RENEWAL",
              entityType: "Subscription",
              entityId: subscriptionId,
              details: `Subscription renewed. Next renewal: ${format(newRenewalDate, "d MMMM yyyy")}. 7-day modification window open until ${format(closesAt, "d MMMM yyyy")}.`,
              sevenDayWindowOpen: true,
            },
          });

          return {
            change,
            message: `Subscription renewed. Next renewal: ${format(newRenewalDate, "d MMMM yyyy")}. 7-day modification window open until ${format(closesAt, "d MMMM yyyy")}.`,
            windowClosesAt: closesAt.toISOString(),
          };
        }

        default:
          throw new Error(`Unsupported change type: ${changeType}`);
      }
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Error processing change:", error);
    const message = error instanceof Error ? error.message : "Failed to process change";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
