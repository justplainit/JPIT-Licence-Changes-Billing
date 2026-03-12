"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          System configuration and preferences.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Billing Configuration</CardTitle>
            <CardDescription>Default billing settings for the system.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Default Currency</span>
              <span className="font-medium">ZAR</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Billing Day</span>
              <span className="font-medium">26th of each month</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">FX Source Currency</span>
              <span className="font-medium">USD</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">7-Day Window Duration</span>
              <span className="font-medium">7 calendar days</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>NCE Policy Settings</CardTitle>
            <CardDescription>Microsoft NCE programme rules.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Mid-term seat additions</span>
              <span className="font-medium text-green-600">Allowed (pro-rated)</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Mid-term seat removals</span>
              <span className="font-medium text-red-600">Only at renewal</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Cancellation window</span>
              <span className="font-medium">7 days from change</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Upgrade mid-term</span>
              <span className="font-medium text-green-600">Allowed</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Downgrade mid-term</span>
              <span className="font-medium text-red-600">Only at renewal</span>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>System Information</CardTitle>
            <CardDescription>Application details.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Application</span>
              <span className="font-medium">M365 NCE Billing Management</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Version</span>
              <span className="font-medium">0.1.0</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Framework</span>
              <span className="font-medium">Next.js 16</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
