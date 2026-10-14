import type { Prisma } from "@/generated/prisma";

/** A SKU made from a product name, e.g. "Planner and Project Plan 3" → "PLANNER-AND-PROJECT-PLAN-3". */
export function generateSku(productName: string): string {
  return productName
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
}

/**
 * Find a product by its exact name (ignoring case), or add it under that
 * name. Used when Cloud-iQ reports a product that isn't in the system yet.
 */
export async function findOrCreateProductByName(
  tx: Prisma.TransactionClient,
  name: string
) {
  const existing = await tx.product.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (existing) return existing;

  const sku = generateSku(name);
  const skuTaken = await tx.product.findUnique({ where: { sku } });
  return tx.product.create({
    data: {
      name,
      sku: skuTaken ? `${sku}-${Date.now()}` : sku,
      category: "Microsoft 365",
      description: "Added automatically from a Cloud-iQ notification",
    },
  });
}
