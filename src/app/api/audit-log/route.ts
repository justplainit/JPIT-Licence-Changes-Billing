import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const entityType = searchParams.get("entityType");
    const userId = searchParams.get("userId");

    const skip = (page - 1) * limit;

    const where = {
      ...(entityType && { entityType }),
      ...(userId && { userId }),
    };

    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    // Resolve customer names via batch lookups keyed by entityType
    const customerIds = new Set<string>();
    const subscriptionIds = new Set<string>();
    const changeIds = new Set<string>();

    for (const entry of entries) {
      if (entry.entityType === "Customer") customerIds.add(entry.entityId);
      else if (entry.entityType === "Subscription") subscriptionIds.add(entry.entityId);
      else if (entry.entityType === "SubscriptionChange") changeIds.add(entry.entityId);
    }

    const [customers, subscriptions, changes] = await Promise.all([
      customerIds.size > 0
        ? prisma.customer.findMany({
            where: { id: { in: [...customerIds] } },
            select: { id: true, name: true },
          })
        : [],
      subscriptionIds.size > 0
        ? prisma.subscription.findMany({
            where: { id: { in: [...subscriptionIds] } },
            select: { id: true, customer: { select: { name: true } } },
          })
        : [],
      changeIds.size > 0
        ? prisma.subscriptionChange.findMany({
            where: { id: { in: [...changeIds] } },
            select: {
              id: true,
              subscription: { select: { customer: { select: { name: true } } } },
            },
          })
        : [],
    ]);

    const customerMap = new Map(customers.map((c) => [c.id, c.name]));
    const subCustomerMap = new Map(
      subscriptions.map((s) => [s.id, s.customer.name])
    );
    const changeCustomerMap = new Map(
      changes.map((c) => [c.id, c.subscription.customer.name])
    );

    const entriesWithCustomer = entries.map((entry) => {
      let customerName: string | null = null;
      if (entry.entityType === "Customer") {
        customerName = customerMap.get(entry.entityId) ?? null;
      } else if (entry.entityType === "Subscription") {
        customerName = subCustomerMap.get(entry.entityId) ?? null;
      } else if (entry.entityType === "SubscriptionChange") {
        customerName = changeCustomerMap.get(entry.entityId) ?? null;
      }
      return { ...entry, customerName };
    });

    return NextResponse.json({
      entries: entriesWithCustomer,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching audit log:", error);
    return NextResponse.json(
      { error: "Failed to fetch audit log" },
      { status: 500 }
    );
  }
}
