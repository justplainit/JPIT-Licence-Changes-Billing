import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { format, differenceInDays } from "date-fns";

async function getDashboardData() {
  const today = new Date();
  const thirtyDaysFromNow = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [
    totalCustomers,
    activeSubscriptions,
    openWindows,
    pendingAmendments,
    upcomingRenewals,
    openSevenDayWindows,
    recentChanges,
  ] = await Promise.all([
    prisma.customer.count(),
    prisma.subscription.count({ where: { status: "ACTIVE" } }),
    prisma.sevenDayWindow.count({ where: { isClosed: false } }),
    prisma.amendmentQueueItem.count({ where: { isCompleted: false } }),
    prisma.subscription.findMany({
      where: {
        renewalDate: { gte: today, lte: thirtyDaysFromNow },
        status: "ACTIVE",
      },
      include: { customer: true, product: true },
      orderBy: { renewalDate: "asc" },
      take: 10,
    }),
    prisma.sevenDayWindow.findMany({
      where: { isClosed: false },
      include: {
        subscription: { include: { customer: true, product: true } },
      },
      orderBy: { closesAt: "asc" },
      take: 5,
    }),
    prisma.subscriptionChange.findMany({
      include: {
        subscription: { include: { customer: true, product: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  return {
    totalCustomers,
    activeSubscriptions,
    openWindows,
    pendingAmendments,
    upcomingRenewals,
    openSevenDayWindows,
    recentChanges,
  };
}

function changeLabel(type: string, prev: number | null, next: number | null): string {
  switch (type) {
    case "ADD_SEATS":
      return `Increased seats: ${prev} → ${next}`;
    case "REMOVE_SEATS":
      return `Decreased seats: ${prev} → ${next}`;
    case "UPGRADE":
      return "Product upgraded";
    case "DOWNGRADE":
      return "Product downgraded";
    case "CANCELLATION":
      return "Subscription cancelled";
    case "RENEWAL":
      return "Subscription renewed";
    case "NEW_SUBSCRIPTION":
      return "New subscription added";
    default:
      return type.replace(/_/g, " ");
  }
}

export default async function DashboardPage() {
  const {
    totalCustomers,
    activeSubscriptions,
    openWindows,
    pendingAmendments,
    upcomingRenewals,
    openSevenDayWindows,
    recentChanges,
  } = await getDashboardData();

  const today = new Date();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Overview of your M365 NCE billing operations.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Total Customers</CardDescription>
            <CardTitle className="text-3xl">{totalCustomers}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Active customer tenants</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Active Subscriptions</CardDescription>
            <CardTitle className="text-3xl">{activeSubscriptions}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Across all customers</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Open 7-Day Windows</CardDescription>
            <CardTitle className="text-3xl">{openWindows}</CardTitle>
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
            <CardTitle className="text-3xl">{pendingAmendments}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Awaiting processing in Partner Center
            </p>
          </CardContent>
        </Card>
      </div>

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
            {upcomingRenewals.length === 0 ? (
              <p className="text-sm text-slate-500">No renewals due in the next 30 days.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left">
                      <th className="pb-3 pr-4 font-medium text-slate-500">Customer</th>
                      <th className="pb-3 pr-4 font-medium text-slate-500">Subscription</th>
                      <th className="pb-3 pr-4 font-medium text-slate-500">Seats</th>
                      <th className="pb-3 pr-4 font-medium text-slate-500">Renewal Date</th>
                      <th className="pb-3 font-medium text-slate-500">Auto-Renew</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-600">
                    {upcomingRenewals.map((sub) => (
                      <tr key={sub.id} className="border-b border-slate-100">
                        <td className="py-3 pr-4">{sub.customer.name}</td>
                        <td className="py-3 pr-4">{sub.product.name}</td>
                        <td className="py-3 pr-4">{sub.seatCount}</td>
                        <td className="py-3 pr-4">
                          {format(new Date(sub.renewalDate), "yyyy-MM-dd")}
                        </td>
                        <td className="py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              sub.autoRenew
                                ? "bg-green-100 text-green-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {sub.autoRenew ? "Yes" : "No"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
            {openSevenDayWindows.length === 0 ? (
              <p className="text-sm text-slate-500">No open cancellation windows.</p>
            ) : (
              <ul className="space-y-3">
                {openSevenDayWindows.map((w) => {
                  const daysLeft = differenceInDays(new Date(w.closesAt), today);
                  return (
                    <li
                      key={w.id}
                      className="flex items-center justify-between rounded-lg border border-slate-200 p-3"
                    >
                      <div>
                        <p className="font-medium text-slate-900">
                          {w.subscription.customer.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {w.subscription.product.name} &middot;{" "}
                          {w.windowType.replace(/_/g, " ")}
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className={`text-xs font-medium ${
                            daysLeft <= 2 ? "text-red-600" : "text-amber-600"
                          }`}
                        >
                          {daysLeft <= 0
                            ? "Expires today"
                            : `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}
                        </p>
                        <p className="text-xs text-slate-400">
                          Opened {format(new Date(w.opensAt), "yyyy-MM-dd")}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
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
            {recentChanges.length === 0 ? (
              <p className="text-sm text-slate-500">No changes recorded yet.</p>
            ) : (
              <ul className="space-y-3">
                {recentChanges.map((change) => (
                  <li
                    key={change.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 p-3"
                  >
                    <div>
                      <p className="font-medium text-slate-900">
                        {change.subscription.customer.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {changeLabel(
                          change.changeType,
                          change.previousSeatCount,
                          change.newSeatCount
                        )}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-400">
                        {format(new Date(change.createdAt), "yyyy-MM-dd")}
                      </p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          change.status === "APPLIED"
                            ? "bg-blue-100 text-blue-700"
                            : change.status === "PENDING"
                            ? "bg-amber-100 text-amber-700"
                            : change.status === "CANCELLED"
                            ? "bg-red-100 text-red-700"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {change.status.charAt(0) + change.status.slice(1).toLowerCase()}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
