"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Product {
  id: string;
  name: string;
  sku: string;
}

interface ScheduledChange {
  id: string;
  changeType: string;
  scheduledDate: string;
  targetSeatCount: number | null;
  status: string;
}

interface Subscription {
  id: string;
  productId: string;
  product: Product;
  seatCount: number;
  termType: string;
  billingFrequency: string;
  status: string;
  startDate: string;
  renewalDate: string;
  termEndDate: string;
  autoRenew: boolean;
  microsoftSubId: string | null;
  notes: string | null;
  scheduledChanges: ScheduledChange[];
}

interface PriceEntry {
  id: string;
  productId: string;
  product: Product;
  pricePerSeat: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

interface Customer {
  id: string;
  name: string;
  accountNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  currency: string;
  notes: string | null;
  subscriptions: Subscription[];
  prices: PriceEntry[];
}

const statusColors: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  CANCELLED: "bg-red-100 text-red-700",
  SUSPENDED: "bg-amber-100 text-amber-700",
  EST: "bg-blue-100 text-blue-700",
  PENDING_RENEWAL: "bg-purple-100 text-purple-700",
};

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const customerId = params.id as string;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchCustomer = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/customers/${customerId}`);
      if (!res.ok) throw new Error("Failed to fetch customer");
      setCustomer(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    fetchCustomer();
  }, [fetchCustomer]);

  const startEditing = (sub: Subscription) => {
    setEditingSubId(sub.id);
    setEditValues({
      seatCount: String(sub.seatCount),
      status: sub.status,
      autoRenew: String(sub.autoRenew),
      microsoftSubId: sub.microsoftSubId || "",
      notes: sub.notes || "",
    });
    setSuccessMsg(null);
  };

  const cancelEditing = () => {
    setEditingSubId(null);
    setEditValues({});
  };

  const saveSubscription = async (subId: string) => {
    setSaving(subId);
    setError(null);
    try {
      const seatCount = parseInt(editValues.seatCount, 10);
      if (isNaN(seatCount) || seatCount < 0) {
        throw new Error("Seat count must be a valid number >= 0");
      }

      const res = await fetch(`/api/subscriptions/${subId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seatCount,
          status: editValues.status,
          autoRenew: editValues.autoRenew === "true",
          microsoftSubId: editValues.microsoftSubId || null,
          notes: editValues.notes || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update subscription");
      }

      setEditingSubId(null);
      setEditValues({});
      setSuccessMsg(`Updated successfully`);
      setTimeout(() => setSuccessMsg(null), 3000);
      fetchCustomer();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(null);
    }
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString("en-ZA", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  const getPrice = (productId: string): PriceEntry | undefined => {
    return customer?.prices.find(
      (p) => p.productId === productId && !p.effectiveTo
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-sm text-slate-500">Loading customer...</div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-red-600">{error || "Customer not found"}</div>
        <Button variant="outline" onClick={() => router.push("/dashboard/customers")}>
          Back to Customers
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => router.push("/dashboard/customers")}
            className="text-sm text-blue-600 hover:underline mb-1 block"
          >
            &larr; Back to Customers
          </button>
          <h1 className="text-2xl font-bold text-slate-900">{customer.name}</h1>
          <div className="flex gap-4 mt-1 text-sm text-slate-500">
            {customer.accountNumber && <span>Account: {customer.accountNumber}</span>}
            {customer.contactEmail && <span>{customer.contactEmail}</span>}
            <span>Currency: {customer.currency}</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
      {successMsg && (
        <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">{successMsg}</div>
      )}

      {/* Subscriptions */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900 mb-3">
          Subscriptions ({customer.subscriptions.length})
        </h2>

        {customer.subscriptions.length === 0 ? (
          <p className="text-sm text-slate-500">No subscriptions found.</p>
        ) : (
          <div className="space-y-3">
            {customer.subscriptions.map((sub) => {
              const isEditing = editingSubId === sub.id;
              const price = getPrice(sub.productId);
              const monthlyTotal = price
                ? price.pricePerSeat * sub.seatCount
                : null;

              return (
                <div
                  key={sub.id}
                  className="rounded-lg border border-gray-200 bg-white overflow-hidden"
                >
                  {/* Subscription header row */}
                  <div className="flex items-center justify-between p-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-slate-900">
                          {sub.product.name}
                        </p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[sub.status] || "bg-gray-100 text-gray-700"}`}
                        >
                          {sub.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        SKU: {sub.product.sku}
                      </p>
                    </div>

                    <div className="flex items-center gap-6 flex-shrink-0">
                      <div className="text-right">
                        <p className="text-sm font-semibold text-slate-900">
                          {sub.seatCount} seats
                        </p>
                        {monthlyTotal !== null && price && (
                          <p className="text-xs text-slate-500">
                            {sub.seatCount} x {price.currency === "USD" ? "$" : "R"}
                            {price.pricePerSeat.toFixed(2)} ={" "}
                            {price.currency === "USD" ? "$" : "R"}
                            {monthlyTotal.toFixed(2)}/mo
                          </p>
                        )}
                      </div>

                      <div className="text-right hidden sm:block">
                        <p className="text-xs text-slate-500">
                          {sub.termType} &middot;{" "}
                          {sub.autoRenew ? "Auto-renew" : "No auto-renew"}
                        </p>
                        <p className="text-xs text-slate-500">
                          Renews {formatDate(sub.renewalDate)}
                        </p>
                      </div>

                      {isEditing ? (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={saving === sub.id}
                            onClick={() => saveSubscription(sub.id)}
                          >
                            {saving === sub.id ? "Saving..." : "Save"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={cancelEditing}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => startEditing(sub)}
                        >
                          Edit
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Inline edit form */}
                  {isEditing && (
                    <div className="border-t border-gray-200 bg-slate-50 p-4 space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">
                            Seat Count
                          </label>
                          <Input
                            type="number"
                            min="0"
                            value={editValues.seatCount}
                            onChange={(e) =>
                              setEditValues((prev) => ({
                                ...prev,
                                seatCount: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">
                            Status
                          </label>
                          <select
                            value={editValues.status}
                            onChange={(e) =>
                              setEditValues((prev) => ({
                                ...prev,
                                status: e.target.value,
                              }))
                            }
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          >
                            <option value="ACTIVE">Active</option>
                            <option value="CANCELLED">Cancelled</option>
                            <option value="SUSPENDED">Suspended</option>
                            <option value="EST">EST</option>
                            <option value="PENDING_RENEWAL">Pending Renewal</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">
                            Auto Renew
                          </label>
                          <select
                            value={editValues.autoRenew}
                            onChange={(e) =>
                              setEditValues((prev) => ({
                                ...prev,
                                autoRenew: e.target.value,
                              }))
                            }
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          >
                            <option value="true">Yes</option>
                            <option value="false">No</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">
                            Microsoft Sub ID
                          </label>
                          <Input
                            value={editValues.microsoftSubId}
                            onChange={(e) =>
                              setEditValues((prev) => ({
                                ...prev,
                                microsoftSubId: e.target.value,
                              }))
                            }
                            placeholder="Optional"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                          Notes
                        </label>
                        <textarea
                          value={editValues.notes}
                          onChange={(e) =>
                            setEditValues((prev) => ({
                              ...prev,
                              notes: e.target.value,
                            }))
                          }
                          placeholder="Optional notes..."
                          rows={2}
                          className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </div>
                      <p className="text-xs text-slate-400">
                        This is a direct data correction. It updates the seat count in the database
                        without creating a billing change record. Use the &quot;Log Change&quot; page for
                        actual mid-month licence changes that need pro-rata invoicing.
                      </p>
                    </div>
                  )}

                  {/* Scheduled changes */}
                  {sub.scheduledChanges.length > 0 && !isEditing && (
                    <div className="border-t border-gray-100 bg-gray-50 px-4 py-2">
                      <p className="text-xs text-slate-500">
                        Scheduled:{" "}
                        {sub.scheduledChanges.map((sc) => (
                          <span key={sc.id} className="font-medium">
                            {sc.changeType.replace("_", " ").toLowerCase()}
                            {sc.targetSeatCount != null &&
                              ` to ${sc.targetSeatCount} seats`}{" "}
                            on {formatDate(sc.scheduledDate)}
                          </span>
                        ))}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pricing */}
      {customer.prices.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-slate-900 mb-3">
            Customer Pricing
          </h2>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Product
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Price/Seat
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Currency
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Effective From
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {customer.prices.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 text-sm text-slate-900">
                      {p.product.name}
                    </td>
                    <td className="px-4 py-2 text-sm text-slate-700">
                      {p.currency === "USD" ? "$" : "R"}
                      {p.pricePerSeat.toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-sm text-slate-600">
                      {p.currency}
                    </td>
                    <td className="px-4 py-2 text-sm text-slate-600">
                      {formatDate(p.effectiveFrom)}
                    </td>
                    <td className="px-4 py-2 text-sm">
                      {p.effectiveTo ? (
                        <span className="text-xs text-gray-400">
                          Ended {formatDate(p.effectiveTo)}
                        </span>
                      ) : (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          Current
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
