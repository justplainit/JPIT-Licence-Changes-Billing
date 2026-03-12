"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ReconciliationImport {
  id: string;
  fileName: string;
  billingPeriod: string;
  status: string;
  totalRecords: number;
  matchedRecords: number;
  discrepancies: number;
  createdAt: string;
  _count: { items: number };
}

export default function ReconciliationPage() {
  const [imports, setImports] = useState<ReconciliationImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchImports = useCallback(async () => {
    try {
      const res = await fetch("/api/reconciliation");
      if (res.ok) setImports(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchImports();
  }, [fetchImports]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const text = await file.text();
      const lines = text.trim().split("\n");
      if (lines.length < 2) throw new Error("CSV file must have a header row and at least one data row");

      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
      const customerIdx = headers.findIndex((h) => h.includes("customer"));
      const productIdx = headers.findIndex((h) => h.includes("product"));
      const qtyIdx = headers.findIndex((h) => h.includes("quantity") || h.includes("qty") || h.includes("seats"));
      const amountIdx = headers.findIndex((h) => h.includes("amount") || h.includes("total") || h.includes("price"));
      const skuIdx = headers.findIndex((h) => h.includes("sku"));

      if (customerIdx === -1 || productIdx === -1 || qtyIdx === -1 || amountIdx === -1) {
        throw new Error("CSV must have columns: customer, product, quantity/seats, and amount/total");
      }

      const items = lines.slice(1).filter((l) => l.trim()).map((line) => {
        const cols = line.split(",").map((c) => c.trim());
        return {
          customerName: cols[customerIdx],
          productName: cols[productIdx],
          sku: skuIdx !== -1 ? cols[skuIdx] : undefined,
          externalQuantity: parseInt(cols[qtyIdx]) || 0,
          externalAmount: parseFloat(cols[amountIdx]) || 0,
        };
      });

      const now = new Date();
      const billingPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      const res = await fetch("/api/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          billingPeriod,
          items,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      fetchImports();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Reconciliation</h1>
        <p className="mt-1 text-sm text-slate-500">
          Compare Microsoft billing data against internal records to find discrepancies.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <label className="cursor-pointer">
          <Button asChild disabled={uploading}>
            <span>{uploading ? "Processing..." : "Upload CSV"}</span>
          </Button>
          <input
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            className="hidden"
            disabled={uploading}
          />
        </label>
        <p className="text-xs text-slate-500">
          CSV should have columns: customer, product, quantity/seats, amount/total
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-sm text-slate-500">Loading imports...</div>
        </div>
      ) : imports.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-sm text-slate-500">
            No reconciliation imports yet. Upload a CSV to get started.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {imports.map((imp) => (
            <Card key={imp.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">{imp.fileName}</CardTitle>
                    <CardDescription>
                      Period: {imp.billingPeriod} | Imported: {new Date(imp.createdAt).toLocaleDateString("en-ZA")}
                    </CardDescription>
                  </div>
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      imp.status === "MATCHED"
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {imp.status === "MATCHED" ? "All Matched" : "Has Discrepancies"}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-6 text-sm">
                  <span className="text-slate-600">
                    Total Records: <span className="font-medium">{imp.totalRecords}</span>
                  </span>
                  <span className="text-green-600">
                    Matched: <span className="font-medium">{imp.matchedRecords}</span>
                  </span>
                  {imp.discrepancies > 0 && (
                    <span className="text-red-600">
                      Discrepancies: <span className="font-medium">{imp.discrepancies}</span>
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
