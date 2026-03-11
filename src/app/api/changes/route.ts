import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { ChangeType } from "@/generated/prisma";
import {
  calculateProRata,
  calculateSeatReductionCredit,
  calculateUpgradeCost,
  calculate7DayWindow,
} from "@/lib/billing-calculations";
import {
  generateProRataInvoiceDraft,
  generateCreditNoteDraft,
  generateUpgradeInvoiceDraft,
} from "@/lib/invoice-generator";

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

          // Create amendment queue item for next billing cycle
          await tx.amendmentQueueItem.create({
            data: {
              customerId: subscription.customerId,
              description: `Update repeating invoice: ${subscription.product.name} from ${previousSeatCount} to ${newSeatCount} seats`,
              productName: subscription.product.name,
              newMonthlyAmount: pricePerSeat * newSeatCount,
              newSeatCount,
              actionByDate: new Date(changeDateObj.getFullYear(), changeDateObj.getMonth() + 1, 1),
              reason: `Mid-term seat addition: +${additionalSeats} seats effective ${changeDateObj.toISOString().split("T")[0]}`,
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

          if (openWindow) {
            // Within 7-day window: immediate reduction with credit
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
