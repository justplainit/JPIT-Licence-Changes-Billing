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
    const billingPeriod = searchParams.get("billingPeriod");

    const fxRates = await prisma.fxRate.findMany({
      where: {
        ...(billingPeriod && { billingPeriod }),
      },
      orderBy: { effectiveDate: "desc" },
    });

    return NextResponse.json(fxRates);
  } catch (error) {
    console.error("Error fetching FX rates:", error);
    return NextResponse.json(
      { error: "Failed to fetch FX rates" },
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
    const { fromCurrency, toCurrency, rate, effectiveDate, billingPeriod } = body;

    if (rate === undefined || !effectiveDate) {
      return NextResponse.json(
        { error: "rate and effectiveDate are required" },
        { status: 400 }
      );
    }

    const from = fromCurrency || "USD";
    const to = toCurrency || "ZAR";
    const effDate = new Date(effectiveDate);

    // Upsert: create or update based on unique constraint
    const fxRate = await prisma.fxRate.upsert({
      where: {
        fromCurrency_toCurrency_effectiveDate: {
          fromCurrency: from,
          toCurrency: to,
          effectiveDate: effDate,
        },
      },
      update: {
        rate,
        billingPeriod: billingPeriod || null,
      },
      create: {
        fromCurrency: from,
        toCurrency: to,
        rate,
        effectiveDate: effDate,
        billingPeriod: billingPeriod || null,
      },
    });

    return NextResponse.json(fxRate, { status: 201 });
  } catch (error) {
    console.error("Error creating/updating FX rate:", error);
    return NextResponse.json(
      { error: "Failed to create/update FX rate" },
      { status: 500 }
    );
  }
}
