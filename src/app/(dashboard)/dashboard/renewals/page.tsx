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

interface Subscription {
  id: string;
  seatCount: number;
  termType: string;
  billingFrequency: string;
  renewalDate: string;
  autoRenew: boolean;
  status: string;
  customer: { id: string; name: string };
  product: { name: string; sku: string };
  scheduledChanges: Array<{
    id: string;
    changeType: string;
    targetSeatCount: number | null;
    status: string;
    scheduledDate: string;
  }>;
}

type ViewMode = "list" | "calendar";

export default function RenewalsPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applySuccess, setApplySuccess] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [termTypeFilter, setTermTypeFilter] = useState<"ALL" | "MONTHLY" | "ANNUAL" | "THREE_YEAR">("ALL");
  const [staleCount, setStaleCount] = useState<number | null>(null);
  const [fixingDates, setFixingDates] = useState(false);
  const [fixResult, setFixResult] = useState<{ fixed: number } | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const fetchStaleCount = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/renewal-dates");
      if (res.ok) {
        const data = await res.json();
        setStaleCount(data.count);
      }
    } catch {
      // ignore
    }
  }, []);

  const fixRenewalDates = async () => {
    setFixingDates(true);
    setFixResult(null);
    try {
      const res = await fetch("/api/admin/renewal-dates", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setFixResult({ fixed: data.fixed });
        setStaleCount(0);
        fetchRenewals();
      }
    } catch {
      // ignore
    } finally {
      setFixingDates(false);
    }
  };

  const fetchRenewals = useCallback(async () => {
    try {
      const res = await fetch("/api/subscriptions?status=ACTIVE");
      if (res.ok) {
        const data = await res.json();
        setSubscriptions(
          data.sort(
            (a: Subscription, b: Subscription) =>
              new Date(a.renewalDate).getTime() -
              new Date(b.renewalDate).getTime()
          )
        );
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRenewals();
    fetchStaleCount();
  }, [fetchRenewals, fetchStaleCount]);

  const applyChange = async (scheduledChangeId: string, label: string) => {
    setApplying(scheduledChangeId);
    setApplyError(null);
    setApplySuccess(null);
    try {
      const res = await fetch("/api/scheduled-changes/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledChangeId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to apply change");
      }
      const data = await res.json();
      setApplySuccess(
        `Applied: ${data.customerName} — ${data.productName} reduced to ${data.newSeatCount} seats. Renewal rolled to ${new Date(data.newRenewalDate).toLocaleDateString("en-ZA")}.`
      );
      fetchRenewals();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Failed to apply");
    } finally {
      setApplying(null);
    }
  };

  const now = new Date();

  const getDaysUntilRenewal = (renewalDate: string) => {
    const renewal = new Date(renewalDate);
    const diffMs = renewal.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  };

  const getRenewalBadge = (daysUntil: number) => {
    if (daysUntil <= 0)
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
          Overdue
        </span>
      );
    if (daysUntil <= 7)
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
          {daysUntil}d
        </span>
      );
    if (daysUntil <= 14)
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
          {daysUntil}d
        </span>
      );
    if (daysUntil <= 30)
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
          {daysUntil}d
        </span>
      );
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
        {daysUntil}d
      </span>
    );
  };

  const getCalendarDays = () => {
    const [year, month] = selectedMonth.split("-").map(Number);
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const days: Array<{
      day: number | null;
      renewals: Subscription[];
    }> = [];

    for (let i = 0; i < startDayOfWeek; i++) {
      days.push({ day: null, renewals: [] });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dayRenewals = subscriptions.filter((s) => {
        const rd = new Date(s.renewalDate);
        return (
          rd.getFullYear() === year &&
          rd.getMonth() === month - 1 &&
          rd.getDate() === d
        );
      });
      days.push({ day: d, renewals: dayRenewals });
    }

    return days;
  };

  const termTypeCounts = {
    MONTHLY: subscriptions.filter((s) => s.termType === "MONTHLY").length,
    ANNUAL: subscriptions.filter((s) => s.termType === "ANNUAL").length,
    THREE_YEAR: subscriptions.filter((s) => s.termType === "THREE_YEAR").length,
  };

  const termTypeFiltered = termTypeFilter !== "ALL"
    ? subscriptions.filter((s) => s.termType === termTypeFilter)
    : [];

  const upcomingRenewals = subscriptions.filter(
    (s) => getDaysUntilRenewal(s.renewalDate) <= 60 && getDaysUntilRenewal(s.renewalDate) > 0
  );
  const withScheduledChanges = subscriptions.filter(
    (s) =>
      s.scheduledChanges &&
      s.scheduledChanges.some((sc) => sc.status === "PENDING")
  );
  const overdueScheduledChanges = subscriptions.filter((s) =>
    s.scheduledChanges?.some(
      (sc) => sc.status === "PENDING" && new Date(sc.scheduledDate) < now
    )
  );

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Renewal Management
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Track upcoming renewals and scheduled changes across all customers
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={viewMode === "list" ? "default" : "outline"}
            onClick={() => setViewMode("list")}
          >
            List View
          </Button>
          <Button
            variant={viewMode === "calendar" ? "default" : "outline"}
            onClick={() => setViewMode("calendar")}
          >
            Calendar View
          </Button>
        </div>
      </div>

      {/* Stale Renewal Date Banner */}
      {staleCount !== null && staleCount > 0 && (
        <div className="rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-amber-900">
              {staleCount} subscription{staleCount !== 1 ? "s have" : " has"} a stale renewal date
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              These dates are in the past and need to be rolled forward to enable correct grace-period detection and accurate renewal tracking.
            </p>
            {fixResult && (
              <p className="text-xs text-green-700 font-medium mt-1">
                Fixed {fixResult.fixed} subscription{fixResult.fixed !== 1 ? "s" : ""} successfully.
              </p>
            )}
          </div>
          <Button
            onClick={fixRenewalDates}
            disabled={fixingDates}
            className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white"
          >
            {fixingDates ? "Fixing…" : "Fix All Now"}
          </Button>
        </div>
      )}
      {fixResult && staleCount === 0 && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800">
          All renewal dates are now current. Fixed {fixResult.fixed} subscription{fixResult.fixed !== 1 ? "s" : ""}.
        </div>
      )}

      {/* Term Type Filter */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500 mr-1">Filter by term:</span>
        {(["ALL", "MONTHLY", "ANNUAL", "THREE_YEAR"] as const).map((t) => {
          const count = t === "ALL" ? subscriptions.length : termTypeCounts[t];
          const label = t === "ALL" ? "All" : t === "THREE_YEAR" ? "3-Year" : t === "ANNUAL" ? "Annual" : "Monthly";
          const active = termTypeFilter === t;
          const highlight = t === "ANNUAL" && termTypeCounts.ANNUAL > 0;
          return (
            <button
              key={t}
              onClick={() => setTermTypeFilter(t)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? t === "ANNUAL"
                    ? "bg-amber-600 text-white"
                    : "bg-slate-800 text-white"
                  : highlight
                    ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                active ? "bg-white/25 text-white" : "bg-white text-slate-600"
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Term Type Report — shown when a specific term type is selected */}
      {termTypeFilter !== "ALL" && (
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between bg-slate-50 px-4 py-3 border-b border-slate-200">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                {termTypeFilter === "THREE_YEAR" ? "3-Year" : termTypeFilter === "ANNUAL" ? "Annual" : "Monthly (M2M)"} subscriptions — {termTypeFiltered.length} total
              </h2>
              {termTypeFilter === "ANNUAL" && (
                <p className="text-xs text-amber-700 mt-0.5">
                  Review these — most subscriptions should be Monthly. Click Edit on the customer page to correct any that were set to Annual by mistake.
                </p>
              )}
            </div>
            <button
              onClick={() => setTermTypeFilter("ALL")}
              className="text-xs text-slate-500 hover:text-slate-700 underline"
            >
              Clear filter
            </button>
          </div>
          {termTypeFiltered.length === 0 ? (
            <p className="text-sm text-slate-500 p-4">No subscriptions with this term type.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Seats</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Billing Freq</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Renewal Date</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Time Left</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {termTypeFiltered.map((sub) => {
                    const daysUntil = getDaysUntilRenewal(sub.renewalDate);
                    return (
                      <tr key={sub.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-sm font-medium text-slate-900">
                          <a href={`/dashboard/customers/${sub.customer.id}`} className="hover:underline text-blue-600">
                            {sub.customer.name}
                          </a>
                        </td>
                        <td className="px-4 py-2.5 text-sm text-slate-600">{sub.product.name}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600">{sub.seatCount}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-500">{sub.billingFrequency}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600">
                          {new Date(sub.renewalDate).toLocaleDateString("en-ZA")}
                        </td>
                        <td className="px-4 py-2.5 text-sm">
                          {getRenewalBadge(daysUntil)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className={overdueScheduledChanges.length > 0 ? "border-red-400 bg-red-50" : ""}>
          <CardHeader className="pb-2">
            <CardDescription className={overdueScheduledChanges.length > 0 ? "text-red-700 font-semibold" : ""}>
              Overdue — Action Required
            </CardDescription>
            <CardTitle className="text-3xl text-red-600">
              {overdueScheduledChanges.length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Renewing in 7 days</CardDescription>
            <CardTitle className="text-3xl text-red-600">
              {
                subscriptions.filter(
                  (s) => getDaysUntilRenewal(s.renewalDate) <= 7 && getDaysUntilRenewal(s.renewalDate) > 0
                ).length
              }
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Renewing in 30 days</CardDescription>
            <CardTitle className="text-3xl text-orange-600">
              {
                subscriptions.filter(
                  (s) => getDaysUntilRenewal(s.renewalDate) <= 30 && getDaysUntilRenewal(s.renewalDate) > 0
                ).length
              }
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>With Scheduled Changes</CardDescription>
            <CardTitle className="text-3xl text-blue-600">
              {withScheduledChanges.length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {viewMode === "calendar" ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Renewal Calendar</CardTitle>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="border rounded px-3 py-1.5 text-sm"
              />
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-px bg-gray-200">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div
                  key={d}
                  className="bg-gray-50 p-2 text-center text-xs font-medium text-gray-500"
                >
                  {d}
                </div>
              ))}
              {getCalendarDays().map((cell, i) => (
                <div
                  key={i}
                  className={`bg-white p-2 min-h-[80px] ${cell.day === null ? "bg-gray-50" : ""}`}
                >
                  {cell.day && (
                    <>
                      <span
                        className={`text-sm ${cell.day === 26 ? "font-bold text-blue-600" : "text-gray-700"}`}
                      >
                        {cell.day}
                        {cell.day === 26 && (
                          <span className="text-[10px] block text-blue-500">
                            Billing
                          </span>
                        )}
                      </span>
                      {cell.renewals.map((r) => (
                        <div
                          key={r.id}
                          className="mt-1 text-[10px] bg-orange-100 text-orange-800 rounded px-1 py-0.5 truncate"
                          title={`${r.customer.name} - ${r.product.name}`}
                        >
                          {r.customer.name}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Overdue Scheduled Changes — ACTION REQUIRED */}
          {overdueScheduledChanges.length > 0 && (
            <Card className="border-red-400">
              <CardHeader>
                <CardTitle className="text-red-700">
                  ⚠ Overdue — Action Required ({overdueScheduledChanges.length})
                </CardTitle>
                <CardDescription className="text-red-600">
                  These scheduled changes are past their action date. Once you have applied the
                  reduction in Crayon/Partner Center and updated Xero, click &quot;Mark Applied&quot;
                  to update the system.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {applySuccess && (
                  <div className="mb-3 rounded bg-green-50 border border-green-300 px-3 py-2 text-sm text-green-800">
                    {applySuccess}
                  </div>
                )}
                {applyError && (
                  <div className="mb-3 rounded bg-red-100 border border-red-300 px-3 py-2 text-sm text-red-800">
                    {applyError}
                  </div>
                )}
                <div className="space-y-3">
                  {overdueScheduledChanges.map((sub) =>
                    sub.scheduledChanges
                      ?.filter(
                        (sc) =>
                          sc.status === "PENDING" &&
                          new Date(sc.scheduledDate) < now
                      )
                      .map((sc) => (
                        <div
                          key={sc.id}
                          className="border border-red-300 rounded-lg p-4 bg-red-50"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-gray-900">
                                {sub.customer.name} — {sub.product.name}
                              </p>
                              <p className="text-sm text-gray-700 mt-1">
                                {sc.changeType === "REMOVE_SEATS"
                                  ? `Decrease from ${sub.seatCount} to ${sc.targetSeatCount} seats`
                                  : sc.changeType}
                              </p>
                              <p className="text-sm text-red-600 font-medium mt-1">
                                Was due:{" "}
                                {new Date(sc.scheduledDate).toLocaleDateString("en-ZA")}
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-2 flex-shrink-0">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-200 text-red-800">
                                Overdue
                              </span>
                              <Button
                                size="sm"
                                disabled={applying === sc.id}
                                onClick={() =>
                                  applyChange(
                                    sc.id,
                                    `${sub.customer.name} – ${sub.product.name}`
                                  )
                                }
                              >
                                {applying === sc.id ? "Applying…" : "Mark Applied"}
                              </Button>
                            </div>
                          </div>
                          <div className="mt-3 text-xs text-gray-600 bg-white rounded p-2 border border-red-200">
                            <strong>Steps:</strong> (1) Reduce to {sc.targetSeatCount} seats in
                            Crayon/Partner Center · (2) Update the repeating invoice in Xero ·
                            (3) Click <em>Mark Applied</em> — the system will update the seat count
                            and roll the renewal date forward automatically.
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Upcoming Renewals Table */}
          <Card>
            <CardHeader>
              <CardTitle>Upcoming Renewals (Next 60 Days)</CardTitle>
              <CardDescription>
                Review and prepare for upcoming subscription renewals
              </CardDescription>
            </CardHeader>
            <CardContent>
              {upcomingRenewals.length === 0 ? (
                <p className="text-gray-500 text-sm">
                  No renewals in the next 60 days.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Customer
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Product
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Term
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Seats
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Renewal Date
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Time Left
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Auto-Renew
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Scheduled Changes
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Checklist
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {upcomingRenewals.map((sub) => {
                        const daysUntil = getDaysUntilRenewal(sub.renewalDate);
                        const pendingChanges = sub.scheduledChanges?.filter(
                          (sc) => sc.status === "PENDING"
                        );
                        return (
                          <tr key={sub.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">
                              {sub.customer.name}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500">
                              {sub.product.name}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500">
                              {sub.termType}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500">
                              {sub.seatCount}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500">
                              {new Date(sub.renewalDate).toLocaleDateString(
                                "en-ZA"
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {getRenewalBadge(daysUntil)}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {sub.autoRenew ? (
                                <span className="text-green-600">Yes</span>
                              ) : (
                                <span className="text-red-600 font-medium">
                                  No
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {pendingChanges && pendingChanges.length > 0 ? (
                                <div className="space-y-1">
                                  {pendingChanges.map((sc) => (
                                    <span
                                      key={sc.id}
                                      className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-800"
                                    >
                                      {sc.changeType === "REMOVE_SEATS"
                                        ? `Reduce to ${sc.targetSeatCount} seats`
                                        : sc.changeType}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-gray-400">None</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              <div className="space-y-1 text-xs">
                                <label className="flex items-center gap-1">
                                  <input type="checkbox" className="rounded" />
                                  <span>Seat count</span>
                                </label>
                                <label className="flex items-center gap-1">
                                  <input type="checkbox" className="rounded" />
                                  <span>Term type</span>
                                </label>
                                <label className="flex items-center gap-1">
                                  <input type="checkbox" className="rounded" />
                                  <span>Auto-renew</span>
                                </label>
                                <label className="flex items-center gap-1">
                                  <input type="checkbox" className="rounded" />
                                  <span>Pricing</span>
                                </label>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Scheduled Changes for Renewal */}
          {withScheduledChanges.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Scheduled Changes Due at Renewal</CardTitle>
                <CardDescription>
                  These changes need to be applied in Crayon/Partner Center at
                  renewal and the repeating invoice updated
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {withScheduledChanges.map((sub) =>
                    sub.scheduledChanges
                      ?.filter((sc) => sc.status === "PENDING")
                      .map((sc) => (
                        <div
                          key={sc.id}
                          className="border rounded-lg p-4 bg-blue-50"
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="font-medium text-gray-900">
                                {sub.customer.name} — {sub.product.name}
                              </p>
                              <p className="text-sm text-gray-600 mt-1">
                                {sc.changeType === "REMOVE_SEATS"
                                  ? `Decrease from ${sub.seatCount} to ${sc.targetSeatCount} seats`
                                  : sc.changeType}
                              </p>
                              <p className="text-sm text-gray-500 mt-1">
                                Scheduled for:{" "}
                                {new Date(sc.scheduledDate).toLocaleDateString(
                                  "en-ZA"
                                )}
                              </p>
                            </div>
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                              Pending
                            </span>
                          </div>
                          <div className="mt-3 text-xs text-gray-500 bg-white rounded p-2">
                            <strong>Action required:</strong> Apply the change
                            in Crayon/Partner Center, then update the repeating
                            invoice in Xero before the 26th of{" "}
                            {new Date(sc.scheduledDate).toLocaleDateString(
                              "en-ZA",
                              { month: "long", year: "numeric" }
                            )}
                            .
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
