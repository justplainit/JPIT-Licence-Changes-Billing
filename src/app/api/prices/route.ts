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
    const customerId = searchParams.get("customerId");
    const productId = searchParams.get("productId");

    const prices = await prisma.customerPrice.findMany({
      where: {
        ...(customerId && { customerId }),
        ...(productId && { productId }),
      },
      include: {
        customer: true,
        product: true,
      },
      orderBy: { effectiveFrom: "desc" },
    });

    return NextResponse.json(prices);
  } catch (error) {
    console.error("Error fetching prices:", error);
    return NextResponse.json(
      { error: "Failed to fetch prices" },
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
    const { customerId, productId, pricePerSeat, currency, notes } = body;

    if (!customerId || !productId || pricePerSeat === undefined) {
      return NextResponse.json(
        { error: "customerId, productId, and pricePerSeat are required" },
        { status: 400 }
      );
    }

    const now = new Date();

    // If there's an existing active price, close it
    const existingPrice = await prisma.customerPrice.findFirst({
      where: {
        customerId,
        productId,
        effectiveTo: null,
      },
      orderBy: { effectiveFrom: "desc" },
    });

    if (existingPrice) {
      await prisma.customerPrice.update({
        where: { id: existingPrice.id },
        data: { effectiveTo: now },
      });
    }

    // Create the new price
    const newPrice = await prisma.customerPrice.create({
      data: {
        customerId,
        productId,
        pricePerSeat,
        currency: currency || "USD",
        effectiveFrom: now,
        notes: notes || null,
      },
      include: {
        customer: true,
        product: true,
      },
    });

    return NextResponse.json(newPrice, { status: 201 });
  } catch (error) {
    console.error("Error creating price:", error);
    return NextResponse.json(
      { error: "Failed to create price" },
      { status: 500 }
    );
  }
}
