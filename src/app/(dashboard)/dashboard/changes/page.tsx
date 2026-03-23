"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface Subscription {
  id: string;
  seatCount: number;
  status: string;
  customer: { id: string; name: string };
  product: { id: string; name: string; sku: string };
}

interface Product {
  id: string;
  name: string;
  sku: string;
}

interface Change {
  id: string;
  changeType: string;
  status: string;
  effectiveDate: string;
  previousSeatCount: number | null;
  newSeatCount: number | null;
  proRataAmount: number | null;
  notes: string | null;
  subscription: {
    customer: { name: string };
    product: { name: string };
  };
  createdBy: { name: string };
}

export default function ChangesPage() {
  const [changes, setChanges] = useState<Change[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [reverting, setReverting] = useState<string | null>(null);
  const [revertConfirm, setRevertConfirm] = useState<string | null>(null);

  const [form, setForm] = useState({
    subscriptionId: "",
    changeType: "ADD_SEATS",
    effectiveDate: new Date().toISOString().split("T")[0],
    newSeatCount: "",
    newProductId: "",
    notes: "",
  });

  const fetchChanges = useCallback(async () => {
    try {
      const res = await fetch("/api/changes?limit=50");
      if (res.ok) setChanges(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSubscriptions = useCallback(async () => {
    try {
      const res = await fetch("/api/subscriptions?status=ACTIVE");
      if (res.ok) setSubscriptions(await res.json());
    } catch {
      // ignore
    }
  }, []);

  const fetchProducts = useCallback(async () => {
    try {
      const res = await fetch("/api/products");
      if (res.ok) setProducts(await res.json());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchChanges();
    fetchSubscriptions();
    fetchProducts();
  }, [fetchChanges, fetchSubscriptions, fetchProducts]);

  const selectedSub = subscriptions.find((s) => s.id === form.subscriptionId);
  const showSeatCount = ["ADD_SEATS", "REMOVE_SEATS"].includes(form.changeType);
  const showProductSelect = ["UPGRADE", "DOWNGRADE"].includes(form.changeType);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        subscriptionId: form.subscriptionId,
        changeType: form.changeType,
        effectiveDate: form.effectiveDate,
        notes: form.notes || undefined,
      };
      if (showSeatCount) body.newSeatCount = parseInt(form.newSeatCount);
      if (showProductSelect) body.newProductId = form.newProductId;

      const res = await fetch("/api/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to log change");
      }

      setSuccess("Change logged successfully!");
      setShowModal(false);
      setForm({
        subscriptionId: "",
        changeType: "ADD_SEATS",
        effectiveDate: new Date().toISOString().split("T")[0],
        newSeatCount: "",
        newProductId: "",
        notes: "",
      });
      fetchChanges();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevert = async (changeId: string) => {
    setReverting(changeId);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/changes/${changeId}/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Manual revert from Changes page" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to revert change");
      }
      const result = await res.json();
      setSuccess(
        `Reverted ${result.changeType.replace(/_/g, " ")} for ${result.customerName} – ${result.productName}`
      );
      setRevertConfirm(null);
      fetchChanges();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revert");
    } finally {
      setReverting(null);
    }
  };

  const getChangeTypeBadge = (type: string) => {
    const styles: Record<string, string> = {
      ADD_SEATS: "bg-green-100 text-green-800",
      REMOVE_SEATS: "bg-red-100 text-red-800",
      UPGRADE: "bg-blue-100 text-blue-800",
      DOWNGRADE: "bg-orange-100 text-orange-800",
      CANCELLATION: "bg-red-100 text-red-800",
      RENEWAL: "bg-purple-100 text-purple-800",
      NEW_SUBSCRIPTION: "bg-green-100 text-green-800",
      EST_ENTRY: "bg-gray-100 text-gray-800",
    };
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[type] || "bg-gray-100 text-gray-800"}`}
      >
        {type.replace(/_/g, " ")}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Log Change</h1>
        <p className="mt-1 text-sm text-slate-500">
          Record licence changes for M365 NCE subscriptions.
        </p>
      </div>

      <div className="flex justify-between items-center">
        <div />
        <Button onClick={() => setShowModal(true)}>Log New Change</Button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div className="rounded-md bg-green-50 p-4 text-sm text-green-700">{success}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-sm text-slate-500">Loading changes...</div>
        </div>
      ) : changes.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-sm text-slate-500">
            No changes logged yet. Click &quot;Log New Change&quot; to get started.
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Change Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Seats</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pro-Rata</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Logged By</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {changes.map((change) => (
                <tr key={change.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-slate-900">
                    {change.subscription.customer.name}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {change.subscription.product.name}
                  </td>
                  <td className="px-6 py-4 text-sm">{getChangeTypeBadge(change.changeType)}</td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {change.previousSeatCount != null && change.newSeatCount != null
                      ? `${change.previousSeatCount} → ${change.newSeatCount}`
                      : "-"}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {change.proRataAmount != null
                      ? `R ${change.proRataAmount.toFixed(2)}`
                      : "-"}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {new Date(change.effectiveDate).toLocaleDateString("en-ZA")}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {change.createdBy.name}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        change.status === "CANCELLED"
                          ? "bg-gray-100 text-gray-500 line-through"
                          : change.status === "SCHEDULED"
                            ? "bg-purple-100 text-purple-700"
                            : "bg-green-100 text-green-700"
                      }`}
                    >
                      {change.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {change.status !== "CANCELLED" && (
                      revertConfirm === change.id ? (
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={reverting === change.id}
                            onClick={() => handleRevert(change.id)}
                          >
                            {reverting === change.id ? "Reverting..." : "Confirm"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setRevertConfirm(null)}
                          >
                            No
                          </Button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setRevertConfirm(change.id)}
                          className="text-red-600 hover:text-red-800 text-xs font-medium"
                        >
                          Undo
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Log Change Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Log New Change</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Subscription <span className="text-red-500">*</span></Label>
                <select
                  value={form.subscriptionId}
                  onChange={(e) => setForm((p) => ({ ...p, subscriptionId: e.target.value }))}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  required
                >
                  <option value="">Select a subscription...</option>
                  {subscriptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.customer.name} — {s.product.name} ({s.seatCount} seats)
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label>Change Type <span className="text-red-500">*</span></Label>
                <select
                  value={form.changeType}
                  onChange={(e) => setForm((p) => ({ ...p, changeType: e.target.value }))}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="ADD_SEATS">Add Seats</option>
                  <option value="REMOVE_SEATS">Remove Seats</option>
                  <option value="UPGRADE">Upgrade</option>
                  <option value="DOWNGRADE">Downgrade</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label>Effective Date <span className="text-red-500">*</span></Label>
                <input
                  type="date"
                  value={form.effectiveDate}
                  onChange={(e) => setForm((p) => ({ ...p, effectiveDate: e.target.value }))}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  required
                />
              </div>

              {showSeatCount && (
                <div className="space-y-2">
                  <Label>
                    New Seat Count <span className="text-red-500">*</span>
                    {selectedSub && (
                      <span className="text-slate-400 font-normal"> (currently {selectedSub.seatCount})</span>
                    )}
                  </Label>
                  <input
                    type="number"
                    min="1"
                    value={form.newSeatCount}
                    onChange={(e) => setForm((p) => ({ ...p, newSeatCount: e.target.value }))}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                  />
                </div>
              )}

              {showProductSelect && (
                <div className="space-y-2">
                  <Label>New Product <span className="text-red-500">*</span></Label>
                  <select
                    value={form.newProductId}
                    onChange={(e) => setForm((p) => ({ ...p, newProductId: e.target.value }))}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                  >
                    <option value="">Select product...</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-2">
                <Label>Notes</Label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Optional notes..."
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  rows={3}
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Logging..." : "Log Change"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
