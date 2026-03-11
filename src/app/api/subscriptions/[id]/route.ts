import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const subscription = await prisma.subscription.findUnique({
      where: { id },
      include: {
        customer: true,
        product: true,
        changes: {
          include: {
            createdBy: {
              select: { id: true, name: true, email: true },
            },
            invoiceDraft: {
              include: { lineItems: true },
            },
            sevenDayWindow: true,
          },
          orderBy: { createdAt: "desc" },
        },
        sevenDayWindows: {
          orderBy: { createdAt: "desc" },
        },
        scheduledChanges: {
          orderBy: { scheduledDate: "asc" },
        },
      },
    });

    if (!subscription) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(subscription);
  } catch (error) {
    console.error("Error fetching subscription:", error);
    return NextResponse.json(
      { error: "Failed to fetch subscription" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const {
      seatCount,
      status,
      autoRenew,
      renewalDate,
      termEndDate,
      microsoftSubId,
      notes,
      billingFrequency,
    } = body;

    const subscription = await prisma.subscription.update({
      where: { id },
      data: {
        ...(seatCount !== undefined && { seatCount }),
        ...(status !== undefined && { status }),
        ...(autoRenew !== undefined && { autoRenew }),
        ...(renewalDate !== undefined && { renewalDate: new Date(renewalDate) }),
        ...(termEndDate !== undefined && { termEndDate: new Date(termEndDate) }),
        ...(microsoftSubId !== undefined && { microsoftSubId }),
        ...(notes !== undefined && { notes }),
        ...(billingFrequency !== undefined && { billingFrequency }),
      },
      include: {
        customer: true,
        product: true,
      },
    });

    return NextResponse.json(subscription);
  } catch (error) {
    console.error("Error updating subscription:", error);
    return NextResponse.json(
      { error: "Failed to update subscription" },
      { status: 500 }
    );
  }
}
