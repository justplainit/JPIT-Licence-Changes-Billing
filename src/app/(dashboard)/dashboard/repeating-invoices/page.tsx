"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface GracePeriodChange {
  id: string;
  changeType: string;
  effectiveDate: string;
  previousSeatCount: number | null;
  newSeatCount: number | null;
  windowClosesAt: string | null;
}

interface ScheduledChange {
  id: string;
  changeType: string;
  scheduledDate: string;
  targetSeatCount: number | null;
  notes: string | null;
}

interface TrackerItem {
  id: string;
  customer: { id: string; name: string };
  product: { id: string; name: string; sku: string };
  seatCount: number;
  pricePerSeat: number;
  currentMonthlyTotal: number;
  revertSeatCount: number;
  revertMonthlyTotal: number;
  hasOpenWindows: boolean;
  openWindowCount: number;
  earliestWindowClose: string | null;
  windowTimeRemaining: string | null;
  changesInGracePeriod: GracePeriodChange[];
  scheduledChanges: ScheduledChange[];
  status: "confirmed" | "grace_period" | "billing_imminent" | "needs_update";
  termType: string;
  renewalDate: string;
}

interface Summary {
  totalSubscriptions: number;
  confirmed: number;
  inGracePeriod: number;
  billingImminent: number;
  needsUpdate: number;
  daysUntilBilling: string;
  billingDate: string;
}

type FilterStatus = "all" | "grace_period" | "billing_imminent" | "needs_update" | "confirmed";

const statusConfig = {
  confirmed: {
    label: "Confirmed",
    bg: "bg-green-50",
    border: "border-green-200",
    badge: "bg-green-100 text-green-700",
    dot: "bg-green-500",
  },
  grace_period: {
    label: "Grace Period",
    bg: "bg-amber-50",
    border: "border-amber-200",
    badge: "bg-amber-100 text-amber-700",
    dot: "bg-amber-500",
  },
  billing_imminent: {
    label: "Billing Imminent",
    bg: "bg-red-50",
    border: "border-red-200",
    badge: "bg-red-100 text-red-700",
    dot: "bg-red-500",
  },
  needs_update: {
    label: "Needs Update",
    bg: "bg-purple-50",
    border: "border-purple-200",
    badge: "bg-purple-100 text-purple-700",
    dot: "bg-purple-500",
  },
};

export default function RepeatingInvoicesPage() {
  const [items, setItems] = useState<TrackerItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/repeating-invoices");
      if (res.ok) {
        const data = await res.json();
        setItems(data.items);
        setSummary(data.summary);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = items.filter((item) => {
    if (filter !== "all" && item.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        item.customer.name.toLowerCase().includes(q) ||
        item.product.name.toLowerCase().includes(q) ||
        item.product.sku.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Sort: billing_imminent first, then needs_update, grace_period, confirmed
  const sortOrder: Record<string, number> = {
    billing_imminent: 0,
    needs_update: 1,
    grace_period: 2,
    confirmed: 3,
  };
  const sorted = [...filtered].sort(
    (a, b) => (sortOrder[a.status] ?? 9) - (sortOrder[b.status] ?? 9)
  );

  const formatCurrency = (amount: number) => `R ${amount.toFixed(2)}`;

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString("en-ZA", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  const formatChangeType = (type: string) => {
    switch (type) {
      case "ADD_SEATS": return "Added seats";
      case "REMOVE_SEATS": return "Removed seats";
      case "UPGRADE": return "Upgrade";
      case "DOWNGRADE": return "Downgrade";
      case "CANCELLATION": return "Cancellation";
      default: return type;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Repeating Invoice Tracker
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          What each repeating invoice should show right now. Items in the 7-day
          grace period may still change.
        </p>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Next Billing</CardDescription>
              <CardTitle className="text-2xl">
                {summary.daysUntilBilling}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Repeating invoices fire on the 26th
              </p>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer transition-colors hover:bg-green-50"
            onClick={() => setFilter(filter === "confirmed" ? "all" : "confirmed")}
          >
            <CardHeader className="pb-2">
              <CardDescription>Confirmed</CardDescription>
              <CardTitle className="text-2xl text-green-600">
                {summary.confirmed}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                No open grace periods
              </p>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer transition-colors hover:bg-amber-50"
            onClick={() => setFilter(filter === "grace_period" ? "all" : "grace_period")}
          >
            <CardHeader className="pb-2">
              <CardDescription>Grace Period</CardDescription>
              <CardTitle className="text-2xl text-amber-600">
                {summary.inGracePeriod}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                May revert within 7-day window
              </p>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer transition-colors hover:bg-red-50"
            onClick={() =>
              setFilter(filter === "billing_imminent" ? "all" : "billing_imminent")
            }
          >
            <CardHeader className="pb-2">
              <CardDescription>Billing Imminent</CardDescription>
              <CardTitle className="text-2xl text-red-600">
                {summary.billingImminent}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Grace period open &amp; 26th within 3 days
              </p>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer transition-colors hover:bg-purple-50"
            onClick={() =>
              setFilter(filter === "needs_update" ? "all" : "needs_update")
            }
          >
            <CardHeader className="pb-2">
              <CardDescription>Needs Update</CardDescription>
              <CardTitle className="text-2xl text-purple-600">
                {summary.needsUpdate}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Scheduled changes overdue
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search and filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2 flex-wrap">
          {(["all", "billing_imminent", "needs_update", "grace_period", "confirmed"] as FilterStatus[]).map(
            (f) => (
              <Button
                key={f}
                variant={filter === f ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(f)}
              >
                {f === "all"
                  ? "All"
                  : f === "billing_imminent"
                    ? "Billing Imminent"
                    : f === "needs_update"
                      ? "Needs Update"
                      : f === "grace_period"
                        ? "Grace Period"
                        : "Confirmed"}
              </Button>
            )
          )}
        </div>
        <input
          type="text"
          placeholder="Search customer or product..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Main tracker list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-sm text-slate-500">
            Loading repeating invoice data...
          </div>
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-sm text-slate-500">
            {filter !== "all"
              ? "No subscriptions match this filter."
              : "No active subscriptions found."}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((item) => {
            const cfg = statusConfig[item.status];
            const isExpanded = expandedId === item.id;
            const seatsChanged = item.seatCount !== item.revertSeatCount;

            return (
              <div
                key={item.id}
                className={`border rounded-lg ${cfg.bg} ${cfg.border} transition-all`}
              >
                {/* Main row */}
                <div
                  className="flex items-center justify-between p-4 cursor-pointer"
                  onClick={() =>
                    setExpandedId(isExpanded ? null : item.id)
                  }
                >
                  <div className="flex items-center gap-4 min-w-0">
                    {/* Status dot */}
                    <div className={`h-3 w-3 rounded-full flex-shrink-0 ${cfg.dot}`} />

                    {/* Customer & product */}
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 truncate">
                        {item.customer.name}
                      </p>
                      <p className="text-sm text-slate-600 truncate">
                        {item.product.name}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 flex-shrink-0">
                    {/* Seat count */}
                    <div className="text-right hidden sm:block">
                      <p className="text-sm font-medium text-slate-900">
                        {item.seatCount} seats
                      </p>
                      {seatsChanged && (
                        <p className="text-xs text-amber-600">
                          Could revert to {item.revertSeatCount}
                        </p>
                      )}
                    </div>

                    {/* Monthly amount */}
                    <div className="text-right hidden md:block">
                      <p className="text-sm font-medium text-slate-900">
                        {formatCurrency(item.currentMonthlyTotal)}/mo
                      </p>
                      {seatsChanged && (
                        <p className="text-xs text-amber-600">
                          Could be {formatCurrency(item.revertMonthlyTotal)}
                        </p>
                      )}
                    </div>

                    {/* Grace period countdown */}
                    <div className="text-right min-w-[100px]">
                      {item.hasOpenWindows ? (
                        <>
                          <p className="text-xs font-medium text-amber-700">
                            {item.windowTimeRemaining}
                          </p>
                          <p className="text-xs text-slate-500">
                            grace remaining
                          </p>
                        </>
                      ) : (
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cfg.badge}`}
                        >
                          {cfg.label}
                        </span>
                      )}
                    </div>

                    {/* Expand chevron */}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-slate-200 px-4 pb-4 pt-3 space-y-4">
                    {/* Key facts */}
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <p className="text-xs text-slate-500">
                          Repeating Invoice Should Show
                        </p>
                        <p className="text-sm font-semibold text-slate-900">
                          {item.seatCount} seats x{" "}
                          {formatCurrency(item.pricePerSeat)} ={" "}
                          {formatCurrency(item.currentMonthlyTotal)}/mo
                        </p>
                      </div>
                      {seatsChanged && (
                        <div>
                          <p className="text-xs text-slate-500">
                            If Grace Period Reversed
                          </p>
                          <p className="text-sm font-semibold text-amber-700">
                            {item.revertSeatCount} seats x{" "}
                            {formatCurrency(item.pricePerSeat)} ={" "}
                            {formatCurrency(item.revertMonthlyTotal)}/mo
                          </p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs text-slate-500">Term / Renewal</p>
                        <p className="text-sm text-slate-700">
                          {item.termType} &middot; Renews{" "}
                          {formatDate(item.renewalDate)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">SKU</p>
                        <p className="text-sm text-slate-700">
                          {item.product.sku}
                        </p>
                      </div>
                    </div>

                    {/* Changes in grace period */}
                    {item.changesInGracePeriod.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-slate-500 mb-2">
                          Changes Still in 7-Day Grace Period
                        </p>
                        <div className="space-y-2">
                          {item.changesInGracePeriod.map((c) => (
                            <div
                              key={c.id}
                              className="flex items-center justify-between rounded border border-amber-200 bg-amber-50 p-2"
                            >
                              <div>
                                <p className="text-sm text-slate-700">
                                  {formatChangeType(c.changeType)}:{" "}
                                  {c.previousSeatCount} &rarr;{" "}
                                  {c.newSeatCount} seats
                                </p>
                                <p className="text-xs text-slate-500">
                                  Effective{" "}
                                  {formatDate(c.effectiveDate)}
                                </p>
                              </div>
                              {c.windowClosesAt && (
                                <p className="text-xs text-amber-700 font-medium">
                                  Window closes{" "}
                                  {formatDate(c.windowClosesAt)}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Scheduled changes */}
                    {item.scheduledChanges.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-slate-500 mb-2">
                          Scheduled for Renewal
                        </p>
                        <div className="space-y-2">
                          {item.scheduledChanges.map((sc) => (
                            <div
                              key={sc.id}
                              className="flex items-center justify-between rounded border border-purple-200 bg-purple-50 p-2"
                            >
                              <div>
                                <p className="text-sm text-slate-700">
                                  {formatChangeType(sc.changeType)}
                                  {sc.targetSeatCount != null &&
                                    ` to ${sc.targetSeatCount} seats`}
                                </p>
                                {sc.notes && (
                                  <p className="text-xs text-slate-500">
                                    {sc.notes}
                                  </p>
                                )}
                              </div>
                              <p className="text-xs text-purple-700 font-medium">
                                Scheduled {formatDate(sc.scheduledDate)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Status explanation */}
                    {item.status === "billing_imminent" && (
                      <div className="rounded border border-red-300 bg-red-50 p-3">
                        <p className="text-sm font-medium text-red-800">
                          Warning: The 26th is approaching and this subscription
                          has changes still in the 7-day grace period. The
                          repeating invoice will fire with the current seat
                          count. If the customer reverses, you will need to
                          issue a credit note and update the repeating invoice
                          again.
                        </p>
                      </div>
                    )}

                    {item.status === "confirmed" &&
                      item.scheduledChanges.length === 0 && (
                        <div className="rounded border border-green-300 bg-green-50 p-3">
                          <p className="text-sm text-green-800">
                            All good. No open grace periods and no pending
                            changes. The repeating invoice amount is confirmed.
                          </p>
                        </div>
                      )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
