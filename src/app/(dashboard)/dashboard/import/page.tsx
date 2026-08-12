"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";

interface ImportRow {
  customerName: string;
  domain?: string;
  contactEmail?: string;
  productName: string;
  sku?: string;
  quantity: number;
  assigned?: number;
  surplus?: number;
  termType?: string;
  microsoftSubId?: string;
  pricePerSeat?: number;
  renewalDate?: string;
  currency?: string;
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

interface ImportResponse {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  results: ImportResult[];
}

const SAMPLE_CSV = `Customer Name,Domain,Product Name,Quantity,Term Type,Microsoft Sub Id,Price Per Seat
Dr Christelle Nel,drcnel.onmicrosoft.com,Microsoft 365 Business Premium,2,Annual,b887e192-091c-44da-dfa4-c407cbe3c593,350.00
Acme Corp,acmecorp.onmicrosoft.com,Microsoft 365 Business Basic,10,Annual,,150.00
Smith Consulting,smith.onmicrosoft.com,Microsoft 365 Business Standard,5,Monthly,,250.00`;

export default function ImportPage() {
  const [parsedRows, setParsedRows] = useState<ImportRow[]>([]);
  const [results, setResults] = useState<ImportResponse | null>(null);
  const [importing, setImporting] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseCSV = (text: string) => {
    setParseError(null);
    setResults(null);

    const lines = text.trim().split("\n");
    if (lines.length < 2) {
      setParseError("CSV must have a header row and at least one data row");
      return;
    }

    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());

    // Find column indices by flexible header matching
    // Supports both custom CSV format and Crayon Renewal Report format
    const colMap: Record<string, number> = {};

    headers.forEach((h, i) => {
      // Customer name: "Customer Name", "Customer", "Cloud Account" (Crayon)
      if (h === "cloud account") colMap.customerName = i;
      else if (h.includes("customer") && h.includes("name")) colMap.customerName = i;
      else if (h === "customer" || h === "customer name") colMap.customerName = i;
      // Domain
      else if (h.includes("domain")) colMap.domain = i;
      else if (h.includes("contact") && h.includes("email")) colMap.contactEmail = i;
      // Product name: "Product Name", "Product"
      else if (h.includes("product") && h.includes("name")) colMap.productName = i;
      else if (h === "product" || h === "product name") colMap.productName = i;
      // SKU: "SKU", "SKU Name" (Crayon), "Product SKU"
      else if (h === "sku" || h === "sku name" || h === "product sku") colMap.sku = i;
      // Quantity: "Total Licences" (Crayon), "Quantity", "Seats", etc.
      else if (h === "total licences" || h === "total licenses") colMap.quantity = i;
      else if (
        h.includes("quantity") ||
        h.includes("qty") ||
        h.includes("seats") ||
        h === "licenses" ||
        h === "licence" ||
        h === "licences"
      )
        colMap.quantity = i;
      // Assigned (Crayon)
      else if (h === "assigned") colMap.assigned = i;
      // Surplus (Crayon)
      else if (h === "surplus") colMap.surplus = i;
      // Term type
      else if (h.includes("term") && h.includes("type")) colMap.termType = i;
      else if (h === "term" || h === "term type") colMap.termType = i;
      // Microsoft Sub ID
      else if (
        h.includes("microsoft") ||
        h.includes("sub id") ||
        h.includes("subscription id")
      )
        colMap.microsoftSubId = i;
      // Price per seat: also match Crayon's "Unit Price" columns
      else if (h === "price per seat" || h === "unit price") colMap.pricePerSeat = i;
      else if (h.includes("price") && !h.includes("potential") && !h.includes("sav")) colMap.pricePerSeat = i;
      // Renewal date (Crayon)
      else if (h === "renewal date" || h.includes("renewal")) colMap.renewalDate = i;
      // Currency (Crayon: "Potential Sav Currency" or just "Currency")
      else if (h === "currency") colMap.currency = i;
      else if (h.includes("currency") && colMap.currency === undefined) colMap.currency = i;
    });

    // Fallback: check simpler single-word headers
    headers.forEach((h, i) => {
      if (h === "customer" && colMap.customerName === undefined) colMap.customerName = i;
      if (h === "product" && colMap.productName === undefined) colMap.productName = i;
      if (h === "quantity" && colMap.quantity === undefined) colMap.quantity = i;
      if (h === "term" && colMap.termType === undefined) colMap.termType = i;
      if (h === "sku" && colMap.sku === undefined) colMap.sku = i;
      if (h === "domain" && colMap.domain === undefined) colMap.domain = i;
    });

    if (colMap.customerName === undefined) {
      setParseError(
        'CSV must have a "Customer Name" or "Customer" column. Found headers: ' +
          headers.join(", ")
      );
      return;
    }
    if (colMap.productName === undefined) {
      setParseError(
        'CSV must have a "Product Name" or "Product" column. Found headers: ' +
          headers.join(", ")
      );
      return;
    }
    if (colMap.quantity === undefined) {
      setParseError(
        'CSV must have a "Quantity", "Seats", or "Licences" column. Found headers: ' +
          headers.join(", ")
      );
      return;
    }

    const rows: ImportRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Simple CSV split (handles basic cases)
      const cols = line.split(",").map((c) => c.trim());

      const qty = parseInt(cols[colMap.quantity]) || 0;
      if (!cols[colMap.customerName] || !cols[colMap.productName] || qty <= 0) {
        continue;
      }

      rows.push({
        customerName: cols[colMap.customerName],
        domain: colMap.domain !== undefined ? cols[colMap.domain] : undefined,
        contactEmail:
          colMap.contactEmail !== undefined
            ? cols[colMap.contactEmail]
            : undefined,
        productName: cols[colMap.productName],
        sku: colMap.sku !== undefined ? cols[colMap.sku] : undefined,
        quantity: qty,
        assigned:
          colMap.assigned !== undefined
            ? parseInt(cols[colMap.assigned]) || undefined
            : undefined,
        surplus:
          colMap.surplus !== undefined
            ? parseInt(cols[colMap.surplus]) || undefined
            : undefined,
        termType:
          colMap.termType !== undefined ? cols[colMap.termType] : undefined,
        microsoftSubId:
          colMap.microsoftSubId !== undefined
            ? cols[colMap.microsoftSubId]
            : undefined,
        pricePerSeat:
          colMap.pricePerSeat !== undefined
            ? parseFloat(cols[colMap.pricePerSeat]) || undefined
            : undefined,
        renewalDate:
          colMap.renewalDate !== undefined
            ? cols[colMap.renewalDate] || undefined
            : undefined,
        currency:
          colMap.currency !== undefined
            ? cols[colMap.currency] || undefined
            : undefined,
      });
    }

    if (rows.length === 0) {
      setParseError("No valid data rows found in the CSV");
      return;
    }

    setParsedRows(rows);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      parseCSV(text);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleImport = async () => {
    if (parsedRows.length === 0) return;

    setImporting(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsedRows }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Import failed");
        return;
      }

      setResults(data);
      toast.success(
        `Import complete: ${data.created} created, ${data.updated} updated, ${data.skipped} unchanged, ${data.errors} errors`
      );
    } catch {
      toast.error("Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleClear = () => {
    setParsedRows([]);
    setResults(null);
    setParseError(null);
  };

  const downloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusColors: Record<string, string> = {
    created: "text-green-700 bg-green-50",
    updated: "text-blue-700 bg-blue-50",
    skipped: "text-gray-700 bg-gray-50",
    error: "text-red-700 bg-red-50",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Bulk Import
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Import customers, products, and subscriptions from a CSV file. Existing
          records are matched and updated — duplicates are safely skipped.
        </p>
      </div>

      {/* CSV Format Guide */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Supported Formats</CardTitle>
          <CardDescription>
            Upload a Crayon Renewal Report directly, or use a custom CSV.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Crayon format */}
            <div>
              <p className="text-sm font-medium text-slate-900 mb-1">
                Crayon Renewal Report (recommended)
              </p>
              <p className="text-xs text-slate-500 mb-2">
                Export directly from Cloud-iQ and upload the CSV as-is. These columns are automatically detected:
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div><span className="font-medium text-slate-900">Cloud Account</span> <span className="text-red-500">*</span></div>
                <div className="text-slate-500">Customer name (e.g. &quot;121 Drilling&quot;)</div>
                <div><span className="font-medium text-slate-900">Product Name</span> <span className="text-red-500">*</span></div>
                <div className="text-slate-500">e.g. &quot;Exchange Online (Plan 1)&quot;</div>
                <div><span className="font-medium text-slate-900">Total Licences</span> <span className="text-red-500">*</span></div>
                <div className="text-slate-500">Number of purchased seats</div>
                <div><span className="font-medium text-slate-900">SKU Name</span></div>
                <div className="text-slate-500">Product SKU identifier</div>
                <div><span className="font-medium text-slate-900">Assigned</span></div>
                <div className="text-slate-500">Licences currently assigned to users</div>
                <div><span className="font-medium text-slate-900">Surplus</span></div>
                <div className="text-slate-500">Unassigned licences (highlighted if &gt; 0)</div>
                <div><span className="font-medium text-slate-900">Renewal Date</span></div>
                <div className="text-slate-500">DD/MM/YYYY — sets the subscription renewal date</div>
                <div><span className="font-medium text-slate-900">Unit Price</span></div>
                <div className="text-slate-500">Sets customer price per seat</div>
              </div>
            </div>

            <hr className="border-slate-200" />

            {/* Custom format */}
            <div>
              <p className="text-sm font-medium text-slate-900 mb-1">
                Custom CSV
              </p>
              <p className="text-xs text-slate-500 mb-2">
                Minimum columns: Customer Name, Product Name, Quantity.
                Optional: Domain, Term Type, Microsoft Sub Id, Price Per Seat, Renewal Date.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={downloadSample}>
                  Download Template CSV
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Upload area */}
      {!results && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose CSV File
            </Button>
            {parsedRows.length > 0 && (
              <>
                <Button onClick={handleImport} disabled={importing}>
                  {importing
                    ? "Importing..."
                    : `Import ${parsedRows.length} Row${parsedRows.length !== 1 ? "s" : ""}`}
                </Button>
                <Button variant="outline" onClick={handleClear}>
                  Clear
                </Button>
              </>
            )}
          </div>

          {parseError && (
            <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
              {parseError}
            </div>
          )}
        </div>
      )}

      {/* Preview table */}
      {parsedRows.length > 0 && !results && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">
            Preview ({parsedRows.length} rows)
          </h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">
                    #
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">
                    Customer
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">
                    Product
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-slate-700">
                    Licences
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-slate-700">
                    Assigned
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-slate-700">
                    Surplus
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">
                    Renewal
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-slate-700">
                    Price/Seat
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {parsedRows.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                    <td className="px-3 py-2 text-slate-900">
                      {row.customerName}
                      {row.domain && (
                        <span className="ml-1 text-xs text-slate-400">
                          ({row.domain})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-900">
                      {row.productName}
                      {row.sku && row.sku !== row.productName && (
                        <span className="ml-1 text-xs text-slate-400">
                          ({row.sku})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-slate-900">
                      {row.quantity}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">
                      {row.assigned ?? "—"}
                    </td>
                    <td className={`px-3 py-2 text-right ${row.surplus && row.surplus > 0 ? "text-amber-600 font-medium" : "text-slate-600"}`}>
                      {row.surplus ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {row.renewalDate || "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">
                      {row.pricePerSeat ? `R${row.pricePerSeat}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Results */}
      {results && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-2xl font-bold text-green-600">
                  {results.created}
                </p>
                <p className="text-xs text-slate-500">Created</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-2xl font-bold text-blue-600">
                  {results.updated}
                </p>
                <p className="text-xs text-slate-500">Updated</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-2xl font-bold text-gray-600">
                  {results.skipped}
                </p>
                <p className="text-xs text-slate-500">Unchanged</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-2xl font-bold text-red-600">
                  {results.errors}
                </p>
                <p className="text-xs text-slate-500">Errors</p>
              </CardContent>
            </Card>
          </div>

          {/* Detail table */}
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">
                    Row
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">
                    Status
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">
                    Customer
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">
                    Product
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-slate-700">
                    Qty
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {results.results.map((r) => (
                  <tr key={r.row} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-500">{r.row}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[r.status]}`}
                      >
                        {r.status}
                        {r.customerCreated && " +cust"}
                        {r.productCreated && " +prod"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-900">
                      {r.customerName}
                    </td>
                    <td className="px-3 py-2 text-slate-900">
                      {r.productName}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-slate-900">
                      {r.quantity}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {r.details}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClear}>
              Import More
            </Button>
            <a href="/dashboard/customers">
              <Button variant="outline">View Customers</Button>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
