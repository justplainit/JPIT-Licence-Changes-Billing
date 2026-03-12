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
        <div className="space-y-3">
          {amendments.map((item) => (
            <div
              key={item.id}
              className={`border rounded-lg p-4 ${
                item.isCompleted
                  ? "bg-gray-50 border-gray-200"
                  : isOverdue(item.actionByDate)
                    ? "bg-red-50 border-red-200"
                    : "bg-white border-gray-200"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="font-medium text-slate-900">{item.customer.name}</p>
                  <p className="text-sm text-slate-600">{item.description}</p>
                  <div className="flex gap-4 text-xs text-slate-500">
                    <span>Product: {item.productName}</span>
                    <span>Seats: {item.newSeatCount}</span>
                    <span>Amount: R {item.newMonthlyAmount.toFixed(2)}/mo</span>
                  </div>
                  <p className="text-xs text-slate-500">Reason: {item.reason}</p>
                  <p className={`text-xs font-medium ${isOverdue(item.actionByDate) && !item.isCompleted ? "text-red-600" : "text-slate-500"}`}>
                    Action by: {new Date(item.actionByDate).toLocaleDateString("en-ZA")}
                    {isOverdue(item.actionByDate) && !item.isCompleted && " (OVERDUE)"}
                  </p>
                  {item.completedAt && (
                    <p className="text-xs text-green-600">
                      Completed: {new Date(item.completedAt).toLocaleDateString("en-ZA")}
                    </p>
                  )}
                </div>
                <Button
                  variant={item.isCompleted ? "outline" : "default"}
                  size="sm"
                  disabled={updating === item.id}
                  onClick={() => toggleComplete(item.id, item.isCompleted)}
                >
                  {updating === item.id
                    ? "Updating..."
                    : item.isCompleted
                      ? "Mark Pending"
                      : "Mark Complete"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
