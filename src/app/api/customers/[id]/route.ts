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

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        subscriptions: {
          include: {
            product: true,
            scheduledChanges: {
              where: { status: "PENDING" },
            },
            // Full change history for the customer's History section.
            changes: {
              include: { createdBy: { select: { name: true } } },
              orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
              take: 200,
            },
          },
          orderBy: { createdAt: "desc" },
        },
        prices: {
          include: {
            product: true,
          },
          orderBy: { effectiveFrom: "desc" },
        },
      },
    });

    if (!customer) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      );
    }

    // Direct data corrections (no billing change record) and the customer's
    // open billing tasks, so the page shows everything recorded for them.
    const [corrections, openTasks] = await Promise.all([
      prisma.auditLog.findMany({
        where: {
          action: "SUBSCRIPTION_CORRECTED",
          entityType: "Subscription",
          entityId: { in: customer.subscriptions.map((s) => s.id) },
        },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      prisma.amendmentQueueItem.findMany({
        where: { customerId: id, isCompleted: false },
        orderBy: { actionByDate: "asc" },
      }),
    ]);

    return NextResponse.json({ ...customer, corrections, openTasks });
  } catch (error) {
    console.error("Error fetching customer:", error);
    return NextResponse.json(
      { error: "Failed to fetch customer" },
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
    const { name, accountNumber, contactEmail, contactPhone, notes, currency } =
      body;

    const customer = await prisma.customer.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(accountNumber !== undefined && { accountNumber }),
        ...(contactEmail !== undefined && { contactEmail }),
        ...(contactPhone !== undefined && { contactPhone }),
        ...(notes !== undefined && { notes }),
        ...(currency !== undefined && { currency }),
      },
    });

    return NextResponse.json(customer);
  } catch (error) {
    console.error("Error updating customer:", error);
    return NextResponse.json(
      { error: "Failed to update customer" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const activeSubscriptions = await prisma.subscription.count({
      where: {
        customerId: id,
        status: { in: ["ACTIVE", "PENDING_RENEWAL"] },
      },
    });

    if (activeSubscriptions > 0) {
      return NextResponse.json(
        {
          error:
            "Cannot delete customer with active subscriptions. Cancel all subscriptions first.",
        },
        { status: 400 }
      );
    }

    await prisma.customer.delete({ where: { id } });

    return NextResponse.json({ message: "Customer deleted successfully" });
  } catch (error) {
    console.error("Error deleting customer:", error);
    return NextResponse.json(
      { error: "Failed to delete customer" },
      { status: 500 }
    );
  }
}
