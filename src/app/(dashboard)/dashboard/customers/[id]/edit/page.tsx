"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Customer {
  id: string;
  name: string;
  accountNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  currency: string;
  notes: string | null;
}

export default function EditCustomerPage() {
  const params = useParams();
  const router = useRouter();
  const customerId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    accountNumber: "",
    contactEmail: "",
    contactPhone: "",
    notes: "",
    currency: "ZAR",
  });

  const fetchCustomer = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/customers/${customerId}`);
      if (!res.ok) throw new Error("Failed to fetch customer");
      const customer: Customer = await res.json();
      setFormData({
        name: customer.name,
        accountNumber: customer.accountNumber || "",
        contactEmail: customer.contactEmail || "",
        contactPhone: customer.contactPhone || "",
        notes: customer.notes || "",
        currency: customer.currency,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load customer");
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    fetchCustomer();
  }, [fetchCustomer]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/customers/${customerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name.trim(),
          accountNumber: formData.accountNumber.trim() || null,
          contactEmail: formData.contactEmail.trim() || null,
          contactPhone: formData.contactPhone.trim() || null,
          notes: formData.notes.trim() || null,
          currency: formData.currency,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update customer");
      }

      router.push(`/dashboard/customers/${customerId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-sm text-slate-500">Loading customer...</div>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <button
          onClick={() => router.push(`/dashboard/customers/${customerId}`)}
          className="text-sm text-blue-600 hover:underline mb-1 block"
        >
          &larr; Back to Customer
        </button>
        <h1 className="text-2xl font-bold text-slate-900">Edit Customer</h1>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">
            Name <span className="text-red-500">*</span>
          </Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, name: e.target.value }))
            }
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="accountNumber">Account Number</Label>
          <Input
            id="accountNumber"
            value={formData.accountNumber}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, accountNumber: e.target.value }))
            }
            placeholder="Account number"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="contactEmail">Contact Email</Label>
          <Input
            id="contactEmail"
            type="email"
            value={formData.contactEmail}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, contactEmail: e.target.value }))
            }
            placeholder="email@example.com"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="contactPhone">Contact Phone</Label>
          <Input
            id="contactPhone"
            value={formData.contactPhone}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, contactPhone: e.target.value }))
            }
            placeholder="Phone number"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="currency">Currency</Label>
          <select
            id="currency"
            value={formData.currency}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, currency: e.target.value }))
            }
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="ZAR">ZAR</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <textarea
            id="notes"
            value={formData.notes}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, notes: e.target.value }))
            }
            placeholder="Optional notes..."
            rows={3}
            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/dashboard/customers/${customerId}`)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </div>
  );
}
