import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { TermType } from "@/generated/prisma";

interface ImportRow {
  customerName: string;
  domain?: string;
  contactEmail?: string;
  productName: string;
  sku?: string;
  quantity: number;
  termType?: string;
  microsoftSubId?: string;
  pricePerSeat?: number;
}

interface ImportResult {
  row: number;
  customerName: string;
  productName: string;
  quantity: number;
  status: "created" | "updated" | "skipped" | "error";
  details: string;
  customerCreated: boolean;
  productCreated: boolean;
  subscriptionCreated: boolean;
}

function normaliseTermType(raw?: string): TermType {
  if (!raw) return "ANNUAL";
  const upper = raw.toUpperCase().replace(/[^A-Z0-9_]/g, "");
  if (upper.includes("MONTH") || upper === "P1M") return "MONTHLY";
  if (upper.includes("THREE") || upper === "P3Y" || upper === "3YEAR") return "THREE_YEAR";
  return "ANNUAL";
}

function generateSku(productName: string): string {
  return productName
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { rows } = (await request.json()) as { rows: ImportRow[] };

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { error: "No import rows provided" },
        { status: 400 }
      );
    }

    const results: ImportResult[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const result: ImportResult = {
        row: i + 1,
        customerName: row.customerName,
        productName: row.productName,
        quantity: row.quantity,
        status: "created",
        details: "",
        customerCreated: false,
        productCreated: false,
        subscriptionCreated: false,
      };

      try {
        if (!row.customerName || !row.productName || !row.quantity) {
          result.status = "error";
          result.details = "Missing required fields: customerName, productName, quantity";
          results.push(result);
          continue;
        }

        await prisma.$transaction(async (tx) => {
          // 1. Find or create customer
          let customer = await tx.customer.findFirst({
            where: { name: { equals: row.customerName, mode: "insensitive" } },
          });

          if (!customer) {
            customer = await tx.customer.create({
              data: {
                name: row.customerName,
                contactEmail: row.contactEmail || null,
                notes: row.domain ? `Domain: ${row.domain}` : null,
              },
            });
            result.customerCreated = true;
          }

          // 2. Find or create product
          const sku = row.sku || generateSku(row.productName);
          let product = await tx.product.findFirst({
            where: {
              OR: [
                { name: { equals: row.productName, mode: "insensitive" } },
                { sku: { equals: sku, mode: "insensitive" } },
              ],
            },
          });

          if (!product) {
            // Check if SKU already exists (different product name)
            const existingSku = await tx.product.findUnique({
              where: { sku },
            });
            product = await tx.product.create({
              data: {
                name: row.productName,
                sku: existingSku ? `${sku}-${Date.now()}` : sku,
                category: "Microsoft 365",
              },
            });
            result.productCreated = true;
          }

          // 3. Find existing subscription or create new one
          let subscription = null;

          // Try matching by Microsoft Sub ID first
          if (row.microsoftSubId) {
            subscription = await tx.subscription.findFirst({
              where: { microsoftSubId: row.microsoftSubId },
            });
          }

          // Then try matching by customer + product + active status
          if (!subscription) {
            subscription = await tx.subscription.findFirst({
              where: {
                customerId: customer.id,
                productId: product.id,
                status: "ACTIVE",
              },
            });
          }

          if (subscription) {
            // Update existing subscription
            const oldSeatCount = subscription.seatCount;
            const updateData: Record<string, unknown> = {};

            if (subscription.seatCount !== row.quantity) {
              updateData.seatCount = row.quantity;
            }
            if (row.microsoftSubId && !subscription.microsoftSubId) {
              updateData.microsoftSubId = row.microsoftSubId;
            }

            if (Object.keys(updateData).length > 0) {
              await tx.subscription.update({
                where: { id: subscription.id },
                data: updateData,
              });
              result.status = "updated";
              result.details = `Updated subscription: seats ${oldSeatCount} → ${row.quantity}`;
              if (updateData.microsoftSubId) {
                result.details += `, added Microsoft Sub ID`;
              }
            } else {
              result.status = "skipped";
              result.details = `Already exists with ${subscription.seatCount} seats (no changes needed)`;
            }
          } else {
            // Create new subscription
            const termType = normaliseTermType(row.termType);
            const now = new Date();
            let renewalDate: Date;
            let termEndDate: Date;

            switch (termType) {
              case "MONTHLY":
                renewalDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                termEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                break;
              case "THREE_YEAR":
                renewalDate = new Date(now.getFullYear() + 3, now.getMonth(), 1);
                termEndDate = new Date(now.getFullYear() + 3, now.getMonth(), 1);
                break;
              default: // ANNUAL
                renewalDate = new Date(now.getFullYear() + 1, now.getMonth(), 1);
                termEndDate = new Date(now.getFullYear() + 1, now.getMonth(), 1);
            }

            await tx.subscription.create({
              data: {
                customerId: customer.id,
                productId: product.id,
                termType,
                billingFrequency: "MONTHLY",
                seatCount: row.quantity,
                status: "ACTIVE",
                startDate: now,
                renewalDate,
                termEndDate,
                autoRenew: true,
                microsoftSubId: row.microsoftSubId || null,
              },
            });
            result.subscriptionCreated = true;
            result.details = `Created subscription: ${row.quantity} seats, ${termType}`;
          }

          // 4. Set customer price if provided
          if (row.pricePerSeat && row.pricePerSeat > 0) {
            const existingPrice = await tx.customerPrice.findFirst({
              where: {
                customerId: customer.id,
                productId: product.id,
                effectiveTo: null,
              },
            });

            if (!existingPrice) {
              await tx.customerPrice.create({
                data: {
                  customerId: customer.id,
                  productId: product.id,
                  pricePerSeat: row.pricePerSeat,
                  currency: "ZAR",
                },
              });
              result.details += `. Price set: R${row.pricePerSeat}/seat`;
            }
          }
        });
      } catch (err) {
        result.status = "error";
        result.details = err instanceof Error ? err.message : "Unknown error";
      }

      results.push(result);
    }

    // Audit log
    const created = results.filter((r) => r.status === "created").length;
    const updated = results.filter((r) => r.status === "updated").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const errors = results.filter((r) => r.status === "error").length;

    await prisma.auditLog.create({
      data: {
        userId: session.user!.id!,
        action: "BULK_IMPORT",
        entityType: "Import",
        entityId: "batch",
        details: `Bulk import: ${rows.length} rows. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`,
      },
    });

    return NextResponse.json({
      total: rows.length,
      created,
      updated,
      skipped,
      errors,
      results,
    });
  } catch (error) {
    console.error("Error processing import:", error);
    return NextResponse.json(
      { error: "Failed to process import" },
      { status: 500 }
    );
  }
}
