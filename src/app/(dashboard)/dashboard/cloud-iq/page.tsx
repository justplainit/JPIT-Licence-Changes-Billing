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
    status: "matched" | "partial" | "new" | "no_change";
    details: string;
  };
}

export default function CloudIQPage() {
  const [text, setText] = useState("");
  const [results, setResults] = useState<NotificationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [parsed, setParsed] = useState(false);

  const handleParse = async () => {
    if (!text.trim()) {
      toast.error("Please paste the Cloud-iQ notification email content.");
      return;
    }

    setLoading(true);
    setParsed(false);
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

  const handleClear = () => {
    setText("");
    setResults([]);
    setParsed(false);
  };

  const statusColors: Record<string, string> = {
    matched: "bg-blue-50 border-blue-200",
    no_change: "bg-gray-50 border-gray-200",
    partial: "bg-amber-50 border-amber-200",
    new: "bg-red-50 border-red-200",
  };

  const statusLabels: Record<string, string> = {
    matched: "Change Detected",
    no_change: "No Change",
    partial: "Partial Match",
    new: "Not Found",
  };

  const statusBadgeColors: Record<string, string> = {
    matched: "bg-blue-100 text-blue-800",
    no_change: "bg-gray-100 text-gray-800",
    partial: "bg-amber-100 text-amber-800",
    new: "bg-red-100 text-red-800",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Cloud-iQ Notifications
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Paste Cloud-iQ (Crayon) change notification emails to detect licence
          changes and compare against your subscriptions.
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
              <span className="rounded-full bg-red-100 px-2 py-1 text-red-800">
                {results.filter((r) => r.match.status === "new").length} New
              </span>
            </div>
          </div>

          {results.map((result, index) => (
            <div
              key={index}
              className={`rounded-lg border p-4 ${statusColors[result.match.status]}`}
            >
              <div className="flex items-start justify-between">
                <div className="space-y-2 flex-1">
                  {/* Header */}
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeColors[result.match.status]}`}
                    >
                      {statusLabels[result.match.status]}
                    </span>
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

                {/* Action button for matched changes */}
                {result.match.status === "matched" &&
                  result.match.seatDifference !== null &&
                  result.match.seatDifference !== 0 && (
                    <div className="ml-4">
                      <a
                        href="/dashboard/changes"
                        className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                      >
                        Log Change
                      </a>
                    </div>
                  )}
              </div>
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
