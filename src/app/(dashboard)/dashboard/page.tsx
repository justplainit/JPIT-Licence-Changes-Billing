import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

export default function DashboardPage() {
  // Placeholder counts - will be replaced with real queries later
  const stats = {
    totalCustomers: 42,
    activeSubscriptions: 187,
    openWindows: 5,
    pendingAmendments: 12,
  };

  return (
    <div className="space-y-8">
      {/* Page heading */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Overview of your M365 NCE billing operations.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Total Customers</CardDescription>
            <CardTitle className="text-3xl">{stats.totalCustomers}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Active customer tenants
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Active Subscriptions</CardDescription>
            <CardTitle className="text-3xl">
              {stats.activeSubscriptions}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Across all customers
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Open 7-Day Windows</CardDescription>
            <CardTitle className="text-3xl">{stats.openWindows}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Cancellation windows currently open
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Pending Amendments</CardDescription>
            <CardTitle className="text-3xl">
              {stats.pendingAmendments}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Awaiting processing in Partner Center
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Content sections */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Subscriptions Approaching Renewal */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Subscriptions Approaching Renewal</CardTitle>
            <CardDescription>
              Subscriptions renewing in the next 30 days that may need attention.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left">
                    <th className="pb-3 pr-4 font-medium text-slate-500">
                      Customer
                    </th>
                    <th className="pb-3 pr-4 font-medium text-slate-500">
                      Subscription
                    </th>
                    <th className="pb-3 pr-4 font-medium text-slate-500">
                      Seats
                    </th>
                    <th className="pb-3 pr-4 font-medium text-slate-500">
                      Renewal Date
                    </th>
                    <th className="pb-3 font-medium text-slate-500">Status</th>
                  </tr>
                </thead>
                <tbody className="text-slate-600">
                  <tr className="border-b border-slate-100">
                    <td className="py-3 pr-4">Contoso Ltd</td>
                    <td className="py-3 pr-4">Microsoft 365 Business Basic</td>
                    <td className="py-3 pr-4">25</td>
                    <td className="py-3 pr-4">2026-04-01</td>
                    <td className="py-3">
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        Upcoming
                      </span>
                    </td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="py-3 pr-4">Fabrikam Inc</td>
                    <td className="py-3 pr-4">
                      Microsoft 365 Business Premium
                    </td>
                    <td className="py-3 pr-4">50</td>
                    <td className="py-3 pr-4">2026-04-05</td>
                    <td className="py-3">
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        Upcoming
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4">Northwind Traders</td>
                    <td className="py-3 pr-4">Exchange Online Plan 1</td>
                    <td className="py-3 pr-4">10</td>
                    <td className="py-3 pr-4">2026-04-12</td>
                    <td className="py-3">
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        Reviewed
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Open 7-Day Windows */}
        <Card>
          <CardHeader>
            <CardTitle>Open 7-Day Windows</CardTitle>
            <CardDescription>
              Subscriptions within the 7-day cancellation/adjustment window.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              <li className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div>
                  <p className="font-medium text-slate-900">Contoso Ltd</p>
                  <p className="text-xs text-slate-500">
                    M365 Business Basic &middot; +5 seats
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-red-600">
                    Expires in 2 days
                  </p>
                  <p className="text-xs text-slate-400">Opened 2026-03-09</p>
                </div>
              </li>
              <li className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div>
                  <p className="font-medium text-slate-900">
                    Adventure Works
                  </p>
                  <p className="text-xs text-slate-500">
                    Exchange Online P1 &middot; New subscription
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-amber-600">
                    Expires in 5 days
                  </p>
                  <p className="text-xs text-slate-400">Opened 2026-03-06</p>
                </div>
              </li>
            </ul>
          </CardContent>
        </Card>

        {/* Recent Changes */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Changes</CardTitle>
            <CardDescription>
              Latest licence changes logged in the system.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              <li className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div>
                  <p className="font-medium text-slate-900">Fabrikam Inc</p>
                  <p className="text-xs text-slate-500">
                    Increased seats: 50 &rarr; 55
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400">2026-03-10</p>
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                    Completed
                  </span>
                </div>
              </li>
              <li className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div>
                  <p className="font-medium text-slate-900">Contoso Ltd</p>
                  <p className="text-xs text-slate-500">
                    Added M365 Business Basic
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400">2026-03-09</p>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    Pending
                  </span>
                </div>
              </li>
              <li className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div>
                  <p className="font-medium text-slate-900">
                    Northwind Traders
                  </p>
                  <p className="text-xs text-slate-500">
                    Decreased seats: 15 &rarr; 10
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400">2026-03-08</p>
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                    Completed
                  </span>
                </div>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
