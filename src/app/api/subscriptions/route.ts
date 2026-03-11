import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { SubscriptionStatus, TermType } from "@/generated/prisma";
import { calculate7DayWindow } from "@/lib/billing-calculations";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get("customerId");
    const status = searchParams.get("status");

    const subscriptions = await prisma.subscription.findMany({
      where: {
        ...(customerId && { customerId }),
        ...(status && { status: status as SubscriptionStatus }),
      },
      include: {
        customer: true,
        product: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(subscriptions);
  } catch (error) {
    console.error("Error fetching subscriptions:", error);
    return NextResponse.json(
      { error: "Failed to fetch subscriptions" },
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
    const {
      customerId,
      productId,
      termType,
      billingFrequency,
      seatCount,
      startDate,
      autoRenew,
    } = body;

    if (!customerId || !productId || !termType || !seatCount || !startDate) {
      return NextResponse.json(
        { error: "customerId, productId, termType, seatCount, and startDate are required" },
        { status: 400 }
      );
    }

    const start = new Date(startDate);

    // Calculate renewalDate and termEndDate based on termType
    let renewalDate: Date;
    let termEndDate: Date;

    switch (termType as TermType) {
      case "MONTHLY":
        renewalDate = new Date(start.getFullYear(), start.getMonth() + 1, 1);
        termEndDate = new Date(start.getFullYear(), start.getMonth() + 1, 1);
        break;
      case "ANNUAL":
        renewalDate = new Date(start.getFullYear() + 1, start.getMonth(), 1);
        termEndDate = new Date(start.getFullYear() + 1, start.getMonth(), 1);
        break;
      case "THREE_YEAR":
        renewalDate = new Date(start.getFullYear() + 3, start.getMonth(), 1);
        termEndDate = new Date(start.getFullYear() + 3, start.getMonth(), 1);
        break;
      default:
        return NextResponse.json(
          { error: "Invalid termType. Must be MONTHLY, ANNUAL, or THREE_YEAR" },
          { status: 400 }
        );
    }

    const { opensAt, closesAt } = calculate7DayWindow(start);

    const subscription = await prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.create({
        data: {
          customerId,
          productId,
          termType: termType as TermType,
          billingFrequency: billingFrequency || "MONTHLY",
          seatCount,
          startDate: start,
          renewalDate,
          termEndDate,
          autoRenew: autoRenew ?? true,
        },
        include: {
          customer: true,
          product: true,
        },
      });

      // Create 7-day window for new subscription
      await tx.sevenDayWindow.create({
        data: {
          subscriptionId: sub.id,
          windowType: "NEW_SUBSCRIPTION",
          opensAt,
          closesAt,
          seatsAffected: seatCount,
        },
      });

      // Create audit log entry
      await tx.auditLog.create({
        data: {
          userId: session.user!.id!,
          action: "CREATE_SUBSCRIPTION",
          entityType: "Subscription",
          entityId: sub.id,
          details: `Created subscription for ${sub.customer.name} - ${sub.product.name} (${seatCount} seats, ${termType})`,
          sevenDayWindowOpen: true,
        },
      });

      return sub;
    });

    return NextResponse.json(subscription, { status: 201 });
  } catch (error) {
    console.error("Error creating subscription:", error);
    return NextResponse.json(
      { error: "Failed to create subscription" },
      { status: 500 }
    );
  }
}
