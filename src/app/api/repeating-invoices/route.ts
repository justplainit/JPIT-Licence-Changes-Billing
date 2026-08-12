import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get all active subscriptions with related data
    const subscriptions = await prisma.subscription.findMany({
      where: {
        status: { in: ["ACTIVE", "PENDING_RENEWAL"] },
      },
      include: {
        customer: true,
        product: true,
        sevenDayWindows: {
          where: { isClosed: false },
          orderBy: { closesAt: "asc" },
        },
        changes: {
          where: {
            status: { in: ["APPLIED", "PENDING"] },
          },
          orderBy: { effectiveDate: "desc" },
          take: 10,
          include: {
            sevenDayWindow: true,
          },
        },
        scheduledChanges: {
          where: { status: "PENDING" },
          orderBy: { scheduledDate: "asc" },
        },
      },
      orderBy: [
        { customer: { name: "asc" } },
        { product: { name: "asc" } },
      ],
    });

    // Get customer prices for these subscriptions
    const customerProductPairs = subscriptions.map((s) => ({
      customerId: s.customerId,
      productId: s.productId,
    }));

    const prices = await prisma.customerPrice.findMany({
      where: {
        OR: customerProductPairs,
        effectiveTo: null, // current price only
      },
    });

    const priceMap = new Map<string, number>();
    for (const p of prices) {
      priceMap.set(`${p.customerId}:${p.productId}`, p.pricePerSeat);
    }

    const now = new Date();
    const currentDay = now.getDate();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const billingDate = new Date(currentYear, currentMonth, 26);
    const daysUntilBilling = Math.ceil(
      (billingDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Build the tracker data for each subscription
    const trackerItems = subscriptions.map((sub) => {
      const pricePerSeat =
        priceMap.get(`${sub.customerId}:${sub.productId}`) ?? 0;
      const currentMonthlyTotal = pricePerSeat * sub.seatCount;

      // Find open 7-day windows
      const openWindows = sub.sevenDayWindows.filter(
        (w) => !w.isClosed && new Date(w.closesAt) > now
      );

      // Find recent changes that are still in a 7-day window
      const changesInGracePeriod = sub.changes.filter((c) => {
        if (!c.sevenDayWindow) return false;
        return (
          !c.sevenDayWindow.isClosed &&
          new Date(c.sevenDayWindow.closesAt) > now
        );
      });

      // Calculate what seat count would revert to if all grace-period changes were reversed
      let revertSeatCount = sub.seatCount;
      for (const change of changesInGracePeriod) {
        if (
          change.changeType === "ADD_SEATS" &&
          change.previousSeatCount != null
        ) {
          // If this add were reversed, we'd go back to previous count
          revertSeatCount =
            revertSeatCount -
            ((change.newSeatCount ?? sub.seatCount) -
              (change.previousSeatCount ?? sub.seatCount));
        }
      }

      const revertMonthlyTotal = pricePerSeat * revertSeatCount;

      // Calculate the earliest window close time
      let earliestWindowClose: string | null = null;
      let windowTimeRemaining: string | null = null;
      if (openWindows.length > 0) {
        const earliest = openWindows[0];
        earliestWindowClose = earliest.closesAt.toISOString();
        const remainMs =
          new Date(earliest.closesAt).getTime() - now.getTime();
        const remainHours = Math.floor(remainMs / (1000 * 60 * 60));
        const remainMinutes = Math.floor(
          (remainMs % (1000 * 60 * 60)) / (1000 * 60)
        );
        if (remainHours > 24) {
          const days = Math.floor(remainHours / 24);
          const hours = remainHours % 24;
          windowTimeRemaining = `${days}d ${hours}h ${remainMinutes}m`;
        } else if (remainHours > 0) {
          windowTimeRemaining = `${remainHours}h ${remainMinutes}m`;
        } else {
          windowTimeRemaining = `${remainMinutes}m`;
        }
      }

      // Determine status
      let status: "confirmed" | "grace_period" | "needs_update" | "billing_imminent";

      // Check if there are pending scheduled changes that should have been actioned
      const overdueScheduled = sub.scheduledChanges.filter(
        (sc) => new Date(sc.scheduledDate) <= now && sc.status === "PENDING"
      );

      if (overdueScheduled.length > 0) {
        status = "needs_update";
      } else if (openWindows.length > 0) {
        // If billing date is within 3 days and there are open windows, flag it
        if (daysUntilBilling >= 0 && daysUntilBilling <= 3) {
          status = "billing_imminent";
        } else {
          status = "grace_period";
        }
      } else {
        status = "confirmed";
      }

      return {
        id: sub.id,
        customer: {
          id: sub.customer.id,
          name: sub.customer.name,
        },
        product: {
          id: sub.product.id,
          name: sub.product.name,
          sku: sub.product.sku,
        },
        seatCount: sub.seatCount,
        pricePerSeat,
        currentMonthlyTotal,
        revertSeatCount,
        revertMonthlyTotal,
        hasOpenWindows: openWindows.length > 0,
        openWindowCount: openWindows.length,
        earliestWindowClose,
        windowTimeRemaining,
        changesInGracePeriod: changesInGracePeriod.map((c) => ({
          id: c.id,
          changeType: c.changeType,
          effectiveDate: c.effectiveDate,
          previousSeatCount: c.previousSeatCount,
          newSeatCount: c.newSeatCount,
          windowClosesAt: c.sevenDayWindow?.closesAt,
        })),
        scheduledChanges: sub.scheduledChanges.map((sc) => ({
          id: sc.id,
          changeType: sc.changeType,
          scheduledDate: sc.scheduledDate,
          targetSeatCount: sc.targetSeatCount,
          notes: sc.notes,
        })),
        status,
        termType: sub.termType,
        renewalDate: sub.renewalDate,
      };
    });

    // Summary stats
    const summary = {
      totalSubscriptions: trackerItems.length,
      confirmed: trackerItems.filter((t) => t.status === "confirmed").length,
      inGracePeriod: trackerItems.filter((t) => t.status === "grace_period").length,
      billingImminent: trackerItems.filter((t) => t.status === "billing_imminent").length,
      needsUpdate: trackerItems.filter((t) => t.status === "needs_update").length,
      daysUntilBilling: currentDay >= 26 ? `Billed (26th passed)` : `${daysUntilBilling} days`,
      billingDate: billingDate.toISOString(),
    };

    return NextResponse.json({ summary, items: trackerItems });
  } catch (error) {
    console.error("Error fetching repeating invoice tracker:", error);
    return NextResponse.json(
      { error: "Failed to fetch repeating invoice data" },
      { status: 500 }
    );
  }
}
