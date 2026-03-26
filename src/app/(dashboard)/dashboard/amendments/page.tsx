"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";

interface Amendment {
  id: string;
  description: string;
  productName: string;
  newMonthlyAmount: number;
  newSeatCount: number;
  actionByDate: string;
  reason: string;
  isCompleted: boolean;
  completedAt: string | null;
  proRataFraction: number | null;
  proRataDays: number | null;
  proRataDaysInMonth: number | null;
  proRataAmount: number | null;
  customer: { id: string; name: string };
}

export default function AmendmentsPage() {
  const [amendments, setAmendments] = useState<Amendment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchAmendments = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/amendments?completed=${showCompleted}`);
      if (res.ok) setAmendments(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [showCompleted]);

  useEffect(() => {
    fetchAmendments();
  }, [fetchAmendments]);

  const toggleComplete = async (id: string, isCompleted: boolean) => {
    setUpdating(id);
    try {
      const res = await fetch("/api/amendments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isCompleted: !isCompleted }),
      });
      if (res.ok) fetchAmendments();
    } catch {
      // ignore
    } finally {
      setUpdating(null);
    }
  };

  const isOverdue = (date: string) => new Date(date) < new Date();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Amendment Queue</h1>
        <p className="mt-1 text-sm text-slate-500">
          Changes that need to be actioned in Crayon/Partner Center and Xero.
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          variant={!showCompleted ? "default" : "outline"}
          onClick={() => setShowCompleted(false)}
        >
          Pending
        </Button>
        <Button
          variant={showCompleted ? "default" : "outline"}
          onClick={() => setShowCompleted(true)}
        >
          Completed
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-sm text-slate-500">Loading amendments...</div>
        </div>
      ) : amendments.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-sm text-slate-500">
            {showCompleted ? "No completed amendments." : "No pending amendments. All caught up!"}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {amendments.map((item) => {
            const isProRataInvoice = item.description.toUpperCase().includes("PRO-RATA INVOICE") || item.description.toUpperCase().includes("PRO RATA INVOICE");
            const isCreditNote = item.description.toUpperCase().includes("CREDIT NOTE");
            const isRepeatingInvoice = item.description.toUpperCase().includes("REPEATING INVOICE");
            const isRemoveLine = item.description.toUpperCase().includes("REMOVE LINE");

            let taskType = "UPDATE";
            let taskColor = "bg-blue-600";
            if (isProRataInvoice) { taskType = "ONE-TIME INVOICE"; taskColor = "bg-amber-600"; }
            else if (isCreditNote) { taskType = "CREDIT NOTE"; taskColor = "bg-red-600"; }
            else if (isRemoveLine) { taskType = "REMOVE FROM BILLING"; taskColor = "bg-red-600"; }
            else if (isRepeatingInvoice) { taskType = "REPEATING INVOICE"; taskColor = "bg-blue-600"; }

            return (
              <div
                key={item.id}
                className={`border rounded-lg overflow-hidden ${
                  item.isCompleted
                    ? "bg-gray-50 border-gray-200 opacity-75"
                    : isOverdue(item.actionByDate)
                      ? "border-red-300"
                      : "border-gray-200"
                }`}
              >
                {/* Header bar */}
                <div className={`flex items-center justify-between px-4 py-2 ${
                  item.isCompleted ? "bg-gray-100" : isOverdue(item.actionByDate) ? "bg-red-100" : "bg-slate-100"
                }`}>
                  <div className="flex items-center gap-2">
                    <span className={`${taskColor} text-white text-xs font-bold px-2 py-0.5 rounded`}>
                      {taskType}
                    </span>
                    <span className="font-semibold text-slate-900">{item.customer.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-medium ${isOverdue(item.actionByDate) && !item.isCompleted ? "text-red-700 font-bold" : "text-slate-500"}`}>
                      {isOverdue(item.actionByDate) && !item.isCompleted ? "OVERDUE - " : "Due: "}
                      {new Date(item.actionByDate).toLocaleDateString("en-ZA")}
                    </span>
                    <Button
                      variant={item.isCompleted ? "outline" : "default"}
                      size="sm"
                      disabled={updating === item.id}
                      onClick={() => toggleComplete(item.id, item.isCompleted)}
                    >
                      {updating === item.id
                        ? "..."
                        : item.isCompleted
                          ? "Mark Pending"
                          : "Mark Complete"}
                    </Button>
                  </div>
                </div>

                <div className="p-4">
                  {/* Xero Quick-Reference Box — only for pro-rata items */}
                  {item.proRataFraction != null && (
                    <div className="mb-4 rounded-lg border-2 border-blue-300 bg-blue-50 p-4">
                      <p className="text-xs font-bold text-blue-800 uppercase tracking-wide mb-2">
                        Xero Invoice Details — Enter these values exactly
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="rounded bg-white p-2 text-center border border-blue-200">
                          <p className="text-[10px] text-slate-500 uppercase">Quantity</p>
                          <p className="text-2xl font-bold text-blue-700">{item.proRataFraction.toFixed(2)}</p>
                          <p className="text-[10px] text-slate-400">{item.proRataDays}/{item.proRataDaysInMonth} days</p>
                        </div>
                        <div className="rounded bg-white p-2 text-center border border-blue-200">
                          <p className="text-[10px] text-slate-500 uppercase">Unit Price</p>
                          <p className="text-2xl font-bold text-slate-900">R{item.proRataAmount != null && item.proRataFraction > 0
                            ? (item.proRataAmount / item.proRataFraction / (item.newSeatCount || 1)).toFixed(2)
                            : "0.00"}</p>
                          <p className="text-[10px] text-slate-400">per seat/month</p>
                        </div>
                        <div className="rounded bg-white p-2 text-center border border-blue-200">
                          <p className="text-[10px] text-slate-500 uppercase">Seats</p>
                          <p className="text-2xl font-bold text-slate-900">{item.newSeatCount}</p>
                          <p className="text-[10px] text-slate-400">additional</p>
                        </div>
                        <div className="rounded bg-white p-2 text-center border border-blue-200">
                          <p className="text-[10px] text-slate-500 uppercase">Total (excl VAT)</p>
                          <p className="text-2xl font-bold text-green-700">R{item.proRataAmount?.toFixed(2) ?? "0.00"}</p>
                          <p className="text-[10px] text-slate-400">one-time charge</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Product & Amount summary for non-pro-rata items */}
                  {item.proRataFraction == null && (
                    <div className="mb-3 flex flex-wrap gap-3 text-sm">
                      <span className="rounded bg-slate-100 px-2 py-1 text-slate-700">
                        <span className="text-slate-500">Product:</span> {item.productName}
                      </span>
                      <span className="rounded bg-slate-100 px-2 py-1 text-slate-700">
                        <span className="text-slate-500">Seats:</span> {item.newSeatCount}
                      </span>
                      <span className="rounded bg-slate-100 px-2 py-1 text-slate-700">
                        <span className="text-slate-500">Monthly:</span> R {item.newMonthlyAmount.toFixed(2)}
                      </span>
                    </div>
                  )}

                  {/* Full instructions — preserved line breaks */}
                  <details className={item.proRataFraction != null ? "" : "open"}>
                    <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700 mb-2">
                      {item.proRataFraction != null ? "Show full instructions" : "Instructions"}
                    </summary>
                    <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed bg-slate-50 rounded-md p-3 border border-slate-200">
                      {item.description}
                    </pre>
                  </details>

                  {/* Reason */}
                  <p className="mt-2 text-xs text-slate-500">
                    {item.reason}
                  </p>

                  {item.completedAt && (
                    <p className="mt-1 text-xs text-green-600 font-medium">
                      Completed: {new Date(item.completedAt).toLocaleDateString("en-ZA")}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
