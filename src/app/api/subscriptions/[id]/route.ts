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
      termType,
      microsoftSubId,
      notes,
      billingFrequency,
    } = body;

    if (termType !== undefined && !["MONTHLY", "ANNUAL", "THREE_YEAR"].includes(termType)) {
      return NextResponse.json(
        { error: "termType must be MONTHLY, ANNUAL or THREE_YEAR" },
        { status: 400 }
      );
    }

    const subscription = await prisma.$transaction(async (tx) => {
      const before = await tx.subscription.findUnique({ where: { id } });
      if (!before) throw new Error("Subscription not found");

      const updated = await tx.subscription.update({
        where: { id },
        data: {
          ...(seatCount !== undefined && { seatCount }),
          ...(status !== undefined && { status }),
          ...(autoRenew !== undefined && { autoRenew }),
          ...(renewalDate !== undefined && { renewalDate: new Date(renewalDate) }),
          ...(termEndDate !== undefined && { termEndDate: new Date(termEndDate) }),
          ...(termType !== undefined && { termType }),
          ...(microsoftSubId !== undefined && { microsoftSubId }),
          ...(notes !== undefined && { notes }),
          ...(billingFrequency !== undefined && { billingFrequency }),
        },
        include: {
          customer: true,
          product: true,
        },
      });

      // These edits correct data directly, without a billing change record, so
      // record what was corrected — it shows in the customer's history.
      const ymd = (d: Date) => d.toISOString().split("T")[0];
      const corrections: string[] = [];
      if (seatCount !== undefined && seatCount !== before.seatCount) {
        corrections.push(`seats ${before.seatCount} → ${seatCount}`);
      }
      if (termType !== undefined && termType !== before.termType) {
        corrections.push(`term ${before.termType} → ${termType}`);
      }
      if (renewalDate !== undefined && ymd(new Date(renewalDate)) !== ymd(before.renewalDate)) {
        corrections.push(`renewal date ${ymd(before.renewalDate)} → ${ymd(new Date(renewalDate))}`);
      }
      if (status !== undefined && status !== before.status) {
        corrections.push(`status ${before.status} → ${status}`);
      }
      if (corrections.length > 0) {
        await tx.auditLog.create({
          data: {
            userId: session.user!.id!,
            action: "SUBSCRIPTION_CORRECTED",
            entityType: "Subscription",
            entityId: id,
            details: `Direct correction (${updated.customer.name} – ${updated.product.name}): ${corrections.join("; ")}`,
          },
        });
      }

      return updated;
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
