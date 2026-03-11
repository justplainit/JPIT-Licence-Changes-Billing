import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const imports = await prisma.reconciliationImport.findMany({
      include: {
        _count: {
          select: { items: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(imports);
  } catch (error) {
    console.error("Error fetching reconciliation imports:", error);
    return NextResponse.json(
      { error: "Failed to fetch reconciliation imports" },
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
    const { fileName, billingPeriod, items } = body;

    if (!fileName || !billingPeriod || !items || !Array.isArray(items)) {
      return NextResponse.json(
        { error: "fileName, billingPeriod, and items array are required" },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      let matchedRecords = 0;
      let discrepancies = 0;

      // Process each item and try to match against internal records
      const processedItems = await Promise.all(
        items.map(
          async (item: {
            customerName: string;
            productName: string;
            sku?: string;
            externalQuantity: number;
            externalAmount: number;
          }) => {
            let internalQuantity: number | null = null;
            let internalAmount: number | null = null;
            let hasDiscrepancy = false;
            let discrepancyNotes: string | null = null;

            // Try to match by customer name and product SKU
            const customer = await tx.customer.findFirst({
              where: {
                name: {
                  equals: item.customerName,
                  mode: "insensitive",
                },
              },
            });

            if (customer) {
              // Find product by SKU or name
              const productWhere = item.sku
                ? { sku: item.sku }
                : {
                    name: {
                      equals: item.productName,
                      mode: "insensitive" as const,
                    },
                  };

              const product = await tx.product.findFirst({
                where: productWhere,
              });

              if (product) {
                // Find active subscription for this customer + product
                const subscription = await tx.subscription.findFirst({
                  where: {
                    customerId: customer.id,
                    productId: product.id,
                    status: { in: ["ACTIVE", "PENDING_RENEWAL"] },
                  },
                });

                // Get active price
                const price = await tx.customerPrice.findFirst({
                  where: {
                    customerId: customer.id,
                    productId: product.id,
                    effectiveTo: null,
                  },
                  orderBy: { effectiveFrom: "desc" },
                });

                if (subscription) {
                  internalQuantity = subscription.seatCount;
                  internalAmount = price
                    ? price.pricePerSeat * subscription.seatCount
                    : null;
                  matchedRecords++;

                  // Check for discrepancies
                  const discrepancyReasons: string[] = [];

                  if (internalQuantity !== item.externalQuantity) {
                    discrepancyReasons.push(
                      `Quantity mismatch: internal=${internalQuantity}, external=${item.externalQuantity}`
                    );
                  }

                  if (
                    internalAmount !== null &&
                    Math.abs(internalAmount - item.externalAmount) > 0.01
                  ) {
                    discrepancyReasons.push(
                      `Amount mismatch: internal=${internalAmount.toFixed(2)}, external=${item.externalAmount.toFixed(2)}`
                    );
                  }

                  if (discrepancyReasons.length > 0) {
                    hasDiscrepancy = true;
                    discrepancyNotes = discrepancyReasons.join("; ");
                    discrepancies++;
                  }
                } else {
                  hasDiscrepancy = true;
                  discrepancyNotes = "No active subscription found for this customer+product combination";
                  discrepancies++;
                }
              } else {
                hasDiscrepancy = true;
                discrepancyNotes = `Product not found: ${item.sku || item.productName}`;
                discrepancies++;
              }
            } else {
              hasDiscrepancy = true;
              discrepancyNotes = `Customer not found: ${item.customerName}`;
              discrepancies++;
            }

            return {
              customerName: item.customerName,
              productName: item.productName,
              sku: item.sku || null,
              externalQuantity: item.externalQuantity,
              externalAmount: item.externalAmount,
              internalQuantity,
              internalAmount,
              hasDiscrepancy,
              discrepancyNotes,
            };
          }
        )
      );

      // Create the import record with all items
      const reconciliationImport = await tx.reconciliationImport.create({
        data: {
          fileName,
          billingPeriod,
          status: discrepancies > 0 ? "HAS_DISCREPANCIES" : "MATCHED",
          totalRecords: items.length,
          matchedRecords,
          discrepancies,
          items: {
            create: processedItems,
          },
        },
        include: {
          items: true,
        },
      });

      return reconciliationImport;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Error creating reconciliation import:", error);
    return NextResponse.json(
      { error: "Failed to create reconciliation import" },
      { status: 500 }
    );
  }
}
