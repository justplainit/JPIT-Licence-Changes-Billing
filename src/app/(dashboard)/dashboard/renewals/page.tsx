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
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

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
  }, [fetchRenewals]);

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

  const upcomingRenewals = subscriptions.filter(
    (s) => getDaysUntilRenewal(s.renewalDate) <= 60
  );
  const withScheduledChanges = subscriptions.filter(
    (s) =>
      s.scheduledChanges &&
      s.scheduledChanges.some((sc) => sc.status === "PENDING")
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

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
