"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface NotificationResult {
  notification: {
    time: string;
    event: string;
    changedBy: string;
    organization: string;
    cloudAccount: string;
    domain: string;
    subscriptionName: string;
    product: string;
    quantity: number;
    subscriptionId: string;
  };
  match: {
    customerId: string | null;
    customerName: string | null;
    subscriptionDbId: string | null;
    productId: string | null;
    productName: string | null;
    currentSeatCount: number | null;
    seatDifference: number | null;
    status: "matched" | "partial" | "new" | "no_change" | "cancellation" | "suspension" | "reactivation";
    details: string;
  };
}

interface ApplyResult {
  changeType: "ADD_SEATS" | "REMOVE_SEATS" | "CANCELLATION";
  applyType?: "cancellation" | "suspension" | "seat_change";
  customerName: string;
  productName: string;
  previousMonthlyAmount?: number;
  previousSeatCount: number;
  newSeatCount: number;
  proRataAmount?: number;
  creditAmount?: number;
  currency?: string;
  withinWindow?: boolean;
  scheduledFor?: string;
  message?: string;
  tasks: Array<{
    description: string;
    actionByDate: string;
    reason: string;
  }>;
  invoiceDraft?: string;
}

export default function CloudIQPage() {
  const [text, setText] = useState("");
  const [results, setResults] = useState<NotificationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [parsed, setParsed] = useState(false);
  const [applyingIndex, setApplyingIndex] = useState<number | null>(null);
  const [appliedResults, setAppliedResults] = useState<
    Record<number, ApplyResult>
  >({});

  const handleParse = async () => {
    if (!text.trim()) {
      toast.error("Please paste the Cloud-iQ notification email content.");
      return;
    }

    setLoading(true);
    setParsed(false);
    setAppliedResults({});
    try {
      const res = await fetch("/api/cloud-iq/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to parse notification");
        return;
      }

      setResults(data.results);
      setParsed(true);

      const matched = data.results.filter(
        (r: NotificationResult) => r.match.status === "matched"
      ).length;
      const noChange = data.results.filter(
        (r: NotificationResult) => r.match.status === "no_change"
      ).length;

      if (matched > 0) {
        toast.success(
          `Found ${matched} subscription(s) with seat changes.`
        );
      } else if (noChange > 0) {
        toast.info("Notifications parsed. No seat changes detected.");
      } else {
        toast.warning(
          "Notifications parsed but no matching subscriptions found."
        );
      }
    } catch {
      toast.error("Failed to parse notification");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (index: number, result: NotificationResult) => {
    if (!result.match.subscriptionDbId) return;

    const isCancellation = result.match.status === "cancellation";
    const isSuspension = result.match.status === "suspension";
    const isSeatChange = result.match.status === "matched" &&
      result.match.seatDifference !== null &&
      result.match.seatDifference !== 0;

    if (!isCancellation && !isSuspension && !isSeatChange) return;

    setApplyingIndex(index);
    try {
      const res = await fetch("/api/cloud-iq/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscriptionDbId: result.match.subscriptionDbId,
          newQuantity: result.notification.quantity,
          notificationTime: result.notification.time,
          notificationEvent: result.notification.event,
          notificationSubscriptionId: result.notification.subscriptionId,
          applyType: isCancellation ? "cancellation" : isSuspension ? "suspension" : "seat_change",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to apply change");
        return;
      }

      setAppliedResults((prev) => ({ ...prev, [index]: data }));
      toast.success(
        `Change applied for ${result.match.customerName}. ${data.tasks.length} task(s) created for your accounting team.`
      );
    } catch {
      toast.error("Failed to apply change");
    } finally {
      setApplyingIndex(null);
    }
  };

  const handleClear = () => {
    setText("");
    setResults([]);
    setParsed(false);
    setAppliedResults({});
  };

  const statusColors: Record<string, string> = {
    matched: "bg-blue-50 border-blue-200",
    no_change: "bg-gray-50 border-gray-200",
    partial: "bg-amber-50 border-amber-200",
    new: "bg-red-50 border-red-200",
    cancellation: "bg-red-50 border-red-300",
    suspension: "bg-orange-50 border-orange-200",
    reactivation: "bg-green-50 border-green-200",
  };

  const statusLabels: Record<string, string> = {
    matched: "Change Detected",
    no_change: "No Change",
    partial: "Partial Match",
    new: "Not Found",
    cancellation: "Expired / Cancelled",
    suspension: "Suspended",
    reactivation: "Reactivated",
  };

  const statusBadgeColors: Record<string, string> = {
    matched: "bg-blue-100 text-blue-800",
    no_change: "bg-gray-100 text-gray-800",
    partial: "bg-amber-100 text-amber-800",
    new: "bg-red-100 text-red-800",
    cancellation: "bg-red-200 text-red-900",
    suspension: "bg-orange-100 text-orange-800",
    reactivation: "bg-green-100 text-green-800",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Cloud-iQ Notifications
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Paste Cloud-iQ (Crayon) change notification emails to detect licence
          changes, apply them to the database, and generate billing tasks.
        </p>
      </div>

      {/* Input area */}
      <div className="space-y-3">
        <label
          htmlFor="notification-text"
          className="block text-sm font-medium text-slate-700"
        >
          Paste notification email content
        </label>
        <textarea
          id="notification-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Paste the Cloud-iQ notification email here...\n\nExample:\nTime: 2026-03-17 12:31:03 UTC\nEvent: State changed from Pending to Active\nChanged by: Partner Center synchronization by Crayon\nOrganization: MTN – StreamGroup – Just Plain IT (Pty) Ltd\nCloud Account: Dr Christelle Nel\nDomain: drcnel.onmicrosoft.com\nSubscription Name: Microsoft 365 Business Premium\nProduct: Microsoft 365 Business Premium\nQuantity of licenses: 2\nSubscription Id: b887e192-091c-44da-dfa4-c407cbe3c593`}
          rows={12}
          className="w-full rounded-lg border border-slate-300 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
        />
        <div className="flex gap-2">
          <Button onClick={handleParse} disabled={loading || !text.trim()}>
            {loading ? "Parsing..." : "Parse Notification"}
          </Button>
          {(text || parsed) && (
            <Button variant="outline" onClick={handleClear}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Results */}
      {parsed && results.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">
              Results ({results.length} notification
              {results.length !== 1 ? "s" : ""})
            </h2>
            <div className="flex gap-2 text-xs">
              <span className="rounded-full bg-blue-100 px-2 py-1 text-blue-800">
                {results.filter((r) => r.match.status === "matched").length}{" "}
                Changes
              </span>
              <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-800">
                {results.filter((r) => r.match.status === "no_change").length}{" "}
                No Change
              </span>
              <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800">
                {results.filter((r) => r.match.status === "partial").length}{" "}
                Partial
              </span>
              <span className="rounded-full bg-red-200 px-2 py-1 text-red-900">
                {results.filter((r) => r.match.status === "cancellation").length}{" "}
                Expired
              </span>
              <span className="rounded-full bg-red-100 px-2 py-1 text-red-800">
                {results.filter((r) => r.match.status === "new").length} New
              </span>
            </div>
          </div>

          {results.map((result, index) => (
            <div
              key={index}
              className={`rounded-lg border p-4 ${
                appliedResults[index]
                  ? "bg-green-50 border-green-200"
                  : statusColors[result.match.status]
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="space-y-2 flex-1">
                  {/* Header */}
                  <div className="flex items-center gap-2">
                    {appliedResults[index] ? (
                      <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800">
                        Applied
                      </span>
                    ) : (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeColors[result.match.status]}`}
                      >
                        {statusLabels[result.match.status]}
                      </span>
                    )}
                    <span className="text-xs text-slate-500">
                      {result.notification.time}
                    </span>
                  </div>

                  {/* Customer & Product */}
                  <div>
                    <p className="font-medium text-slate-900">
                      {result.notification.cloudAccount}
                    </p>
                    <p className="text-sm text-slate-600">
                      {result.notification.product}
                    </p>
                    <p className="text-xs text-slate-500">
                      {result.notification.domain}
                    </p>
                  </div>

                  {/* Event */}
                  <p className="text-sm text-slate-600">
                    <span className="font-medium">Event:</span>{" "}
                    {result.notification.event}
                  </p>

                  {/* Seat comparison */}
                  {result.match.status === "matched" &&
                    result.match.seatDifference !== null && (
                      <div className="rounded-md bg-white/70 p-3 text-sm">
                        <div className="grid grid-cols-3 gap-4 text-center">
                          <div>
                            <p className="text-xs text-slate-500">
                              Current (App)
                            </p>
                            <p className="text-lg font-bold text-slate-900">
                              {result.match.currentSeatCount}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">
                              Cloud-iQ
                            </p>
                            <p className="text-lg font-bold text-slate-900">
                              {result.notification.quantity}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">
                              Difference
                            </p>
                            <p
                              className={`text-lg font-bold ${
                                result.match.seatDifference > 0
                                  ? "text-green-600"
                                  : "text-red-600"
                              }`}
                            >
                              {result.match.seatDifference > 0 ? "+" : ""}
                              {result.match.seatDifference}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                  {result.match.status === "no_change" &&
                    result.match.currentSeatCount !== null && (
                      <p className="text-sm text-slate-500">
                        Seats: {result.match.currentSeatCount} (matches
                        Cloud-iQ)
                      </p>
                    )}

                  {/* Cancellation/Expiry display */}
                  {(result.match.status === "cancellation" || result.match.status === "suspension") &&
                    result.match.currentSeatCount !== null && (
                      <div className="rounded-md bg-white/70 p-3 text-sm">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs text-slate-500">Product</p>
                            <p className="font-medium text-slate-900">{result.match.productName}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">Seats to remove from billing</p>
                            <p className="text-lg font-bold text-red-600">{result.match.currentSeatCount}</p>
                          </div>
                        </div>
                      </div>
                    )}

                  {/* Match details */}
                  <p className="text-xs text-slate-500">
                    {result.match.details}
                  </p>

                  {/* Subscription ID */}
                  <p className="text-xs text-slate-400 font-mono">
                    Sub ID: {result.notification.subscriptionId}
                  </p>

                  {/* Matched DB info */}
                  {result.match.customerName && (
                    <p className="text-xs text-slate-500">
                      Matched to: {result.match.customerName}
                      {result.match.productName &&
                        ` / ${result.match.productName}`}
                    </p>
                  )}
                </div>

                {/* Action button for seat changes */}
                {result.match.status === "matched" &&
                  result.match.seatDifference !== null &&
                  result.match.seatDifference !== 0 &&
                  !appliedResults[index] && (
                    <div className="ml-4">
                      <Button
                        onClick={() => handleApply(index, result)}
                        disabled={applyingIndex === index}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        {applyingIndex === index
                          ? "Applying..."
                          : "Apply Change"}
                      </Button>
                    </div>
                  )}

                {/* Action button for cancellation/expiry */}
                {result.match.status === "cancellation" &&
                  !appliedResults[index] && (
                    <div className="ml-4">
                      <Button
                        onClick={() => handleApply(index, result)}
                        disabled={applyingIndex === index}
                        className="bg-red-600 hover:bg-red-700 text-white"
                      >
                        {applyingIndex === index
                          ? "Applying..."
                          : "Apply Cancellation"}
                      </Button>
                    </div>
                  )}

                {/* Action button for suspension */}
                {result.match.status === "suspension" &&
                  !appliedResults[index] && (
                    <div className="ml-4">
                      <Button
                        onClick={() => handleApply(index, result)}
                        disabled={applyingIndex === index}
                        className="bg-orange-600 hover:bg-orange-700 text-white"
                      >
                        {applyingIndex === index
                          ? "Applying..."
                          : "Apply Suspension"}
                      </Button>
                    </div>
                  )}
              </div>

              {/* Applied result: Tasks for accounting */}
              {appliedResults[index] && (
                <div className="mt-4 space-y-3 border-t border-green-200 pt-4">
                  {/* Summary */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-green-800">
                      {appliedResults[index].changeType === "CANCELLATION"
                        ? (appliedResults[index].applyType === "suspension"
                          ? "Suspension recorded"
                          : "Cancellation applied — subscription marked as cancelled")
                        : "Change applied successfully"}
                    </span>
                    {appliedResults[index].proRataAmount !== undefined && (
                      <span className="text-xs rounded-full bg-green-100 px-2 py-0.5 text-green-700">
                        Pro-rata: R{appliedResults[index].proRataAmount!.toFixed(2)}
                      </span>
                    )}
                    {appliedResults[index].creditAmount !== undefined && (
                      <span className="text-xs rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">
                        Credit: R{appliedResults[index].creditAmount!.toFixed(2)}
                      </span>
                    )}
                    {appliedResults[index].previousMonthlyAmount !== undefined &&
                      appliedResults[index].previousMonthlyAmount! > 0 && (
                      <span className="text-xs rounded-full bg-red-100 px-2 py-0.5 text-red-700">
                        Remove R{appliedResults[index].previousMonthlyAmount!.toFixed(2)}/mo from billing
                      </span>
                    )}
                    {appliedResults[index].scheduledFor && (
                      <span className="text-xs rounded-full bg-orange-100 px-2 py-0.5 text-orange-700">
                        Scheduled: {appliedResults[index].scheduledFor}
                      </span>
                    )}
                  </div>

                  {appliedResults[index].message && (
                    <p className="text-sm text-amber-700 bg-amber-50 rounded-md p-2">
                      {appliedResults[index].message}
                    </p>
                  )}

                  {/* Tasks */}
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700 mb-2">
                      Billing Tasks Created ({appliedResults[index].tasks.length})
                    </h4>
                    <div className="space-y-2">
                      {appliedResults[index].tasks.map((task, taskIdx) => (
                        <div
                          key={taskIdx}
                          className="rounded-md border border-slate-200 bg-white p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                                {task.description}
                              </pre>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-xs font-medium text-slate-500">
                                Action by
                              </p>
                              <p className="text-xs text-slate-700">
                                {new Date(task.actionByDate).toLocaleDateString("en-ZA")}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      These tasks have been added to the{" "}
                      <a
                        href="/dashboard/amendments"
                        className="text-blue-600 underline hover:text-blue-800"
                      >
                        Amendment Queue
                      </a>
                      . Your accounting team can tick them off as they complete each action.
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {parsed && results.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <div className="text-sm text-slate-500">
            No notifications could be parsed from the text.
          </div>
        </div>
      )}
    </div>
  );
}
