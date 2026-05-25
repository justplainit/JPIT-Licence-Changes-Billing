import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { rollForwardOverdueRenewalDates } from "@/lib/apply-scheduled-changes";

// GET: preview stale subscriptions (dry run)
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const stale = await prisma.subscription.findMany({
    where: {
      status: { in: ["ACTIVE", "SUSPENDED"] },
      renewalDate: { lt: now },
    },
    include: { customer: true, product: true },
    orderBy: { renewalDate: "asc" },
  });

  return NextResponse.json({
    count: stale.length,
    subscriptions: stale.map((s) => ({
      id: s.id,
      customerName: s.customer.name,
      productName: s.product.name,
      termType: s.termType,
      currentRenewalDate: s.renewalDate,
    })),
  });
}

// POST: apply the fix
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { updated } = await rollForwardOverdueRenewalDates();

  return NextResponse.json({
    fixed: updated.length,
    updated,
  });
}
