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

interface SubscriptionChange {
  id: string;
  changeType: string;
  status: string;
  effectiveDate: string;
  createdAt: string;
  previousSeatCount: number | null;
  newSeatCount: number | null;
  notes: string | null;
  createdBy: { name: string } | null;
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
  changes: SubscriptionChange[];
}

interface Correction {
  id: string;
  entityId: string;
  details: string | null;
  createdAt: string;
  user: { name: string } | null;
}

interface OpenTask {
  id: string;
  description: string;
  productName: string;
  actionByDate: string;
}

interface HistoryRow {
  key: string;
  date: string;
  productId: string;
  productName: string;
  kind: string;
  seats: string;
  status: string;
  by: string;
  source: string;
  changeId: string | null;
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
  corrections: Correction[];
  openTasks: OpenTask[];
}

const statusColors: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  CANCELLED: "bg-red-100 text-red-700",
  SUSPENDED: "bg-amber-100 text-amber-700",
  EST: "bg-blue-100 text-blue-700",
  PENDING_RENEWAL: "bg-purple-100 text-purple-700",
};

const changeTypeLabels: Record<string, string> = {
  ADD_SEATS: "Add seats",
  REMOVE_SEATS: "Remove seats",
  UPGRADE: "Upgrade",
  DOWNGRADE: "Downgrade",
  CANCELLATION: "Cancellation",
  RENEWAL: "Renewal",
  NEW_SUBSCRIPTION: "New subscription",
  EST_ENTRY: "EST",
};

const historyStatusColors: Record<string, string> = {
  APPLIED: "bg-green-100 text-green-700",
  SCHEDULED: "bg-purple-100 text-purple-700",
  PENDING: "bg-amber-100 text-amber-700",
  CANCELLED: "bg-gray-100 text-gray-500 line-through",
  CORRECTED: "bg-blue-100 text-blue-700",
};

/** Every change and direct correction recorded for the customer, newest first. */
function buildHistory(customer: Customer): HistoryRow[] {
  const subById = new Map(customer.subscriptions.map((s) => [s.id, s]));
  const rows: HistoryRow[] = [];

  for (const sub of customer.subscriptions) {
    for (const c of sub.changes) {
      // Cloud-iQ changes keep the original email's event in their notes.
      const event = c.notes?.match(/Event: ([^\n]+)/)?.[1]?.trim();
      const origin = c.notes?.includes("Cloud-iQ") ? "Cloud-iQ" : "Log Change";
      rows.push({
        key: c.id,
        date: c.effectiveDate,
        productId: sub.productId,
        productName: sub.product.name,
        kind: changeTypeLabels[c.changeType] ?? c.changeType,
        seats: `${c.previousSeatCount ?? "–"} → ${c.newSeatCount ?? "–"}`,
        status: c.status,
        by: c.createdBy?.name ?? "",
        source: event ? `${origin} · ${event}` : origin,
        changeId: c.id,
      });
    }
  }

  for (const corr of customer.corrections) {
    const sub = subById.get(corr.entityId);
    if (!sub) continue;
    rows.push({
      key: corr.id,
      date: corr.createdAt,
      productId: sub.productId,
      productName: sub.product.name,
      kind: "Correction",
      seats: corr.details?.split(": ").slice(1).join(": ") ?? "",
      status: "CORRECTED",
      by: corr.user?.name ?? "",
      source: "Edited on this page",
      changeId: null,
    });
  }

  return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

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
  const [historyProduct, setHistoryProduct] = useState("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Price editing state
  const [editingPriceFor, setEditingPriceFor] = useState<string | null>(null); // productId
  const [priceEditValues, setPriceEditValues] = useState<{
    pricePerSeat: string;
    currency: string;
  }>({ pricePerSeat: "", currency: "USD" });
  const [savingPrice, setSavingPrice] = useState(false);

  // New subscription modal state
  const [showNewSubModal, setShowNewSubModal] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [newSubForm, setNewSubForm] = useState({
    productId: "",
    termType: "ANNUAL",
    billingFrequency: "MONTHLY",
    seatCount: "1",
    startDate: new Date().toISOString().split("T")[0],
    autoRenew: "true",
  });
  const [savingNewSub, setSavingNewSub] = useState(false);

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
      termType: sub.termType,
      renewalDate: sub.renewalDate.slice(0, 10),
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
          termType: editValues.termType,
          ...(editValues.renewalDate && {
            renewalDate: editValues.renewalDate,
            termEndDate: editValues.renewalDate,
          }),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update subscription");
      }

      setEditingSubId(null);
      setEditValues({});
      setSuccessMsg(`Subscription updated successfully`);
      setTimeout(() => setSuccessMsg(null), 3000);
      fetchCustomer();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(null);
    }
  };

  const undoChange = async (changeId: string) => {
    if (!window.confirm("Undo this change? Its seat count and pending schedule are reverted.")) return;
    setBusyId(changeId);
    setError(null);
    try {
      const res = await fetch(`/api/changes/${changeId}/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Manual revert from customer history" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to undo change");
      }
      setSuccessMsg("Change undone");
      setTimeout(() => setSuccessMsg(null), 3000);
      fetchCustomer();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to undo change");
    } finally {
      setBusyId(null);
    }
  };

  const completeTask = async (taskId: string) => {
    setBusyId(taskId);
    setError(null);
    try {
      const res = await fetch("/api/amendments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, isCompleted: true }),
      });
      if (!res.ok) throw new Error("Failed to complete task");
      fetchCustomer();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete task");
    } finally {
      setBusyId(null);
    }
  };

  const startEditingPrice = (sub: Subscription) => {
    const price = getPrice(sub.productId);
    setEditingPriceFor(sub.productId);
    setPriceEditValues({
      pricePerSeat: price ? String(price.pricePerSeat) : "",
      currency: price?.currency || "USD",
    });
    setSuccessMsg(null);
  };

  const cancelEditingPrice = () => {
    setEditingPriceFor(null);
    setPriceEditValues({ pricePerSeat: "", currency: "USD" });
  };

  const savePrice = async (productId: string) => {
    setSavingPrice(true);
    setError(null);
    try {
      const pricePerSeat = parseFloat(priceEditValues.pricePerSeat);
      if (isNaN(pricePerSeat) || pricePerSeat < 0) {
        throw new Error("Price must be a valid number >= 0");
      }

      const res = await fetch("/api/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          productId,
          pricePerSeat,
          currency: priceEditValues.currency,
          notes: "Price updated from customer detail page",
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update price");
      }

      setEditingPriceFor(null);
      setPriceEditValues({ pricePerSeat: "", currency: "USD" });
      setSuccessMsg("Price updated successfully");
      setTimeout(() => setSuccessMsg(null), 3000);
      fetchCustomer();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save price");
    } finally {
      setSavingPrice(false);
    }
  };

  const openNewSubModal = async () => {
    setShowNewSubModal(true);
    setLoadingProducts(true);
    try {
      const res = await fetch("/api/products");
      if (res.ok) {
        const data = await res.json();
        setProducts(data);
        if (data.length > 0) {
          setNewSubForm((prev) => ({ ...prev, productId: data[0].id }));
        }
      }
    } finally {
      setLoadingProducts(false);
    }
  };

  const closeNewSubModal = () => {
    setShowNewSubModal(false);
    setNewSubForm({
      productId: "",
      termType: "ANNUAL",
      billingFrequency: "MONTHLY",
      seatCount: "1",
      startDate: new Date().toISOString().split("T")[0],
      autoRenew: "true",
    });
  };

  const saveNewSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingNewSub(true);
    setError(null);
    try {
      const seatCount = parseInt(newSubForm.seatCount, 10);
      if (isNaN(seatCount) || seatCount < 1) {
        throw new Error("Seat count must be at least 1");
      }

      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          productId: newSubForm.productId,
          termType: newSubForm.termType,
          billingFrequency: newSubForm.billingFrequency,
          seatCount,
          startDate: newSubForm.startDate,
          autoRenew: newSubForm.autoRenew === "true",
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create subscription");
      }

      closeNewSubModal();
      setSuccessMsg("Subscription created successfully");
      setTimeout(() => setSuccessMsg(null), 3000);
      fetchCustomer();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create subscription");
    } finally {
      setSavingNewSub(false);
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

  const historyRows = buildHistory(customer).filter(
    (r) => historyProduct === "all" || r.productId === historyProduct
  );
  const historyProducts = Array.from(
    new Map(customer.subscriptions.map((s) => [s.productId, s.product.name])).entries()
  );

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
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Subscriptions ({customer.subscriptions.length})
          </h2>
          <Button size="sm" onClick={openNewSubModal}>
            + New Subscription
          </Button>
        </div>

        {customer.subscriptions.length === 0 ? (
          <p className="text-sm text-slate-500">No subscriptions found.</p>
        ) : (
          <div className="space-y-3">
            {customer.subscriptions.map((sub) => {
              const isEditing = editingSubId === sub.id;
              const isEditingPrice = editingPriceFor === sub.productId;
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
                      {/* Price per seat */}
                      <div className="text-right">
                        {isEditingPrice ? (
                          <div className="flex items-center gap-2">
                            <select
                              value={priceEditValues.currency}
                              onChange={(e) =>
                                setPriceEditValues((prev) => ({
                                  ...prev,
                                  currency: e.target.value,
                                }))
                              }
                              className="h-8 w-16 rounded border border-input bg-background px-1 text-xs"
                            >
                              <option value="USD">USD</option>
                              <option value="ZAR">ZAR</option>
                              <option value="EUR">EUR</option>
                              <option value="GBP">GBP</option>
                            </select>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={priceEditValues.pricePerSeat}
                              onChange={(e) =>
                                setPriceEditValues((prev) => ({
                                  ...prev,
                                  pricePerSeat: e.target.value,
                                }))
                              }
                              className="h-8 w-24 text-xs"
                              placeholder="Price/seat"
                            />
                            <Button
                              size="sm"
                              className="h-8 text-xs"
                              disabled={savingPrice}
                              onClick={() => savePrice(sub.productId)}
                            >
                              {savingPrice ? "..." : "Save"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs"
                              onClick={cancelEditingPrice}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEditingPrice(sub)}
                            className="text-right group"
                            title="Click to edit price"
                          >
                            {price ? (
                              <>
                                <p className="text-sm font-semibold text-slate-900 group-hover:text-blue-600">
                                  {price.currency === "USD" ? "$" : "R"}
                                  {price.pricePerSeat.toFixed(2)}/seat
                                </p>
                                <p className="text-xs text-slate-400 group-hover:text-blue-500">
                                  click to edit
                                </p>
                              </>
                            ) : (
                              <p className="text-xs text-amber-600 group-hover:text-blue-600">
                                No price set — click to add
                              </p>
                            )}
                          </button>
                        )}
                      </div>

                      {/* Seat count & monthly total */}
                      <div className="text-right">
                        <p className="text-sm font-semibold text-slate-900">
                          {sub.seatCount} seats
                        </p>
                        {monthlyTotal !== null && price && (
                          <p className="text-xs text-slate-500">
                            = {price.currency === "USD" ? "$" : "R"}
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
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">
                            Term
                          </label>
                          <select
                            value={editValues.termType}
                            onChange={(e) =>
                              setEditValues((prev) => ({
                                ...prev,
                                termType: e.target.value,
                              }))
                            }
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          >
                            <option value="MONTHLY">Monthly</option>
                            <option value="ANNUAL">Annual</option>
                            <option value="THREE_YEAR">3 years</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">
                            Renewal Date
                          </label>
                          <Input
                            type="date"
                            value={editValues.renewalDate}
                            onChange={(e) =>
                              setEditValues((prev) => ({
                                ...prev,
                                renewalDate: e.target.value,
                              }))
                            }
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
                        This is a direct data correction. It updates the subscription without creating
                        billing tasks, and is recorded in this customer&apos;s History. Use the &quot;Log
                        Change&quot; page for actual mid-month licence changes that need pro-rata invoicing.
                        Renewal date: any anniversary of the term (e.g. the 1st for a monthly term
                        renewing on the 1st).
                      </p>
                    </div>
                  )}

                  {/* Scheduled changes */}
                  {sub.scheduledChanges.length > 0 && !isEditing && (
                    <div className="border-t border-gray-100 bg-gray-50 px-4 py-2">
                      <p className="text-xs text-slate-500">
                        Scheduled:{" "}
                        {sub.scheduledChanges.map((sc, i) => (
                          <span key={sc.id}>
                            {i > 0 && " · "}
                            <span className="font-medium">
                              {sc.changeType.replace("_", " ").toLowerCase()}
                              {sc.targetSeatCount != null &&
                                ` to ${sc.targetSeatCount} seats`}{" "}
                              on {formatDate(sc.scheduledDate)}
                            </span>
                            {new Date(sc.scheduledDate) < new Date() && (
                              <span className="text-amber-700"> (date passed — never actioned)</span>
                            )}
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

      {/* New Subscription Modal */}
      {showNewSubModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold text-slate-900">
                New Subscription
              </h3>
              <button
                onClick={closeNewSubModal}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <form onSubmit={saveNewSubscription} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Product
                </label>
                {loadingProducts ? (
                  <p className="text-sm text-slate-500">Loading products...</p>
                ) : (
                  <select
                    value={newSubForm.productId}
                    onChange={(e) =>
                      setNewSubForm((prev) => ({ ...prev, productId: e.target.value }))
                    }
                    required
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="" disabled>
                      Select a product
                    </option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Term Type
                  </label>
                  <select
                    value={newSubForm.termType}
                    onChange={(e) =>
                      setNewSubForm((prev) => ({ ...prev, termType: e.target.value }))
                    }
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="ANNUAL">Annual</option>
                    <option value="THREE_YEAR">Three Year</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Billing Frequency
                  </label>
                  <select
                    value={newSubForm.billingFrequency}
                    onChange={(e) =>
                      setNewSubForm((prev) => ({
                        ...prev,
                        billingFrequency: e.target.value,
                      }))
                    }
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="ANNUAL">Annual</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Seat Count
                  </label>
                  <Input
                    type="number"
                    min="1"
                    required
                    value={newSubForm.seatCount}
                    onChange={(e) =>
                      setNewSubForm((prev) => ({
                        ...prev,
                        seatCount: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Start Date
                  </label>
                  <Input
                    type="date"
                    required
                    value={newSubForm.startDate}
                    onChange={(e) =>
                      setNewSubForm((prev) => ({
                        ...prev,
                        startDate: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Auto Renew
                </label>
                <select
                  value={newSubForm.autoRenew}
                  onChange={(e) =>
                    setNewSubForm((prev) => ({
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

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeNewSubModal}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={savingNewSub || !newSubForm.productId}>
                  {savingNewSub ? "Creating..." : "Create Subscription"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Open billing tasks */}
      {customer.openTasks.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-slate-900 mb-3">
            Open Billing Tasks ({customer.openTasks.length})
          </h2>
          <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {customer.openTasks.map((task) => (
              <div key={task.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">
                    {task.description.split("\n")[0]}
                  </p>
                  <p className="text-xs text-slate-500">
                    {task.productName} · Due {formatDate(task.actionByDate)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === task.id}
                  onClick={() => completeTask(task.id)}
                >
                  {busyId === task.id ? "..." : "Mark Complete"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History: every change and correction recorded for this customer */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">History</h2>
          <select
            value={historyProduct}
            onChange={(e) => setHistoryProduct(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
          >
            <option value="all">All products</option>
            {historyProducts.map(([productId, name]) => (
              <option key={productId} value={productId}>
                {name}
              </option>
            ))}
          </select>
        </div>
        {historyRows.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing recorded yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {["Date", "Product", "Change", "Seats", "Status", "By", "Source", ""].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {historyRows.map((row) => (
                  <tr key={row.key} className={row.status === "CANCELLED" ? "text-slate-400" : "text-slate-700"}>
                    <td className="whitespace-nowrap px-4 py-2 text-sm">{formatDate(row.date)}</td>
                    <td className="px-4 py-2 text-sm">{row.productName}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm">{row.kind}</td>
                    <td className="px-4 py-2 text-sm">{row.seats}</td>
                    <td className="px-4 py-2 text-sm">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${historyStatusColors[row.status] ?? "bg-gray-100 text-gray-700"}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm">{row.by}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{row.source}</td>
                    <td className="px-4 py-2 text-right">
                      {row.changeId && row.status !== "CANCELLED" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === row.changeId}
                          onClick={() => undoChange(row.changeId!)}
                        >
                          {busyId === row.changeId ? "..." : "Undo"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pricing History */}
      {customer.prices.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-slate-900 mb-3">
            Pricing History
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
