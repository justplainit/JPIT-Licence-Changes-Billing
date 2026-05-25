import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { format } from "date-fns";
import Link from "next/link";

export default async function DashboardPage() {
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [
    totalCustomers,
    activeSubscriptions,
    openWindows,
    pendingAmendments,
    overdueScheduledCount,
  ] = await Promise.all([
    prisma.customer.count(),
    prisma.subscription.count({ where: { status: "ACTIVE" } }),
    prisma.sevenDayWindow.count({
      where: { isClosed: false, closesAt: { gte: now } },
    }),
    prisma.amendmentQueueItem.count({ where: { isCompleted: false } }),
    prisma.scheduledChange.count({
      where: { status: "PENDING", scheduledDate: { lt: now } },
    }),
  ]);

  const [overdueChanges, upcomingRenewals] = await Promise.all([
    overdueScheduledCount > 0
      ? prisma.scheduledChange.findMany({
          where: { status: "PENDING", scheduledDate: { lt: now } },
          include: {
            subscription: { include: { customer: true, product: true } },
          },
          orderBy: { scheduledDate: "asc" },
          take: 20,
        })
      : Promise.resolve([]),
    prisma.subscription.findMany({
      where: {
        status: "ACTIVE",
        renewalDate: { gte: now, lte: in30Days },
      },
      include: {
        customer: true,
        product: true,
        scheduledChanges: { where: { status: "PENDING" } },
      },
      orderBy: { renewalDate: "asc" },
      take: 10,
    }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Overview of your M365 NCE billing operations.
        </p>
      </div>

      {/* Overdue alert banner */}
      {overdueScheduledCount > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 text-red-600 text-lg font-bold leading-none mt-0.5">
              ⚠
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-red-800">
                {overdueScheduledCount} Overdue Scheduled Change
                {overdueScheduledCount !== 1 ? "s" : ""} — Action Required
              </h3>
              <p className="text-sm text-red-700 mt-1">
                These seat reductions were scheduled at renewal but have not
                been actioned. Update Crayon/Partner Center and Xero
                immediately.
              </p>
              <div className="mt-3 space-y-2">
                {overdueChanges.map((sc) => (
                  <div
                    key={sc.id}
                    className="rounded bg-white border border-red-200 px-3 py-2 text-sm flex items-center justify-between gap-4"
                  >
                    <div>
                      <Link
                        href={`/dashboard/customers/${sc.subscription.customerId}`}
                        className="font-medium text-red-900 hover:underline"
                      >
                        {sc.subscription.customer.name}
                      </Link>
                      <span className="text-red-700">
                        {" — "}
                        {sc.subscription.product.name}
                        {sc.changeType === "REMOVE_SEATS" &&
                        sc.targetSeatCount != null
                          ? `: reduce to ${sc.targetSeatCount} seats`
                          : `: ${sc.changeType.replace("_", " ").toLowerCase()}`}
                      </span>
                    </div>
                    <span className="text-xs text-red-500 whitespace-nowrap flex-shrink-0">
                      Due{" "}
                      {format(new Date(sc.scheduledDate), "d MMM yyyy")}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3">
                <Link
                  href="/dashboard/renewals"
                  className="text-sm font-medium text-red-700 underline hover:text-red-900"
                >
                  Go to Renewals page →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Total Customers</CardDescription>
            <CardTitle className="text-3xl">{totalCustomers}</CardTitle>
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
            <CardTitle className="text-3xl">{activeSubscriptions}</CardTitle>
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
            <CardTitle className="text-3xl">{openWindows}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Cancellation windows currently open
            </p>
          </CardContent>
        </Card>

        <Card className={pendingAmendments > 0 ? "border-amber-300" : ""}>
          <CardHeader>
            <CardDescription>Pending Amendments</CardDescription>
            <CardTitle
              className={`text-3xl ${pendingAmendments > 0 ? "text-amber-600" : ""}`}
            >
              {pendingAmendments}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Awaiting processing in Xero
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Content sections */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Subscriptions Renewing in the Next 30 Days</CardTitle>
            <CardDescription>
              Subscriptions renewing soon that may need attention.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {upcomingRenewals.length === 0 ? (
              <p className="text-sm text-slate-500">
                No renewals in the next 30 days.
              </p>
            ) : (
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
                      <th className="pb-3 font-medium text-slate-500">
                        Scheduled Changes
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-600">
                    {upcomingRenewals.map((sub) => (
                      <tr key={sub.id} className="border-b border-slate-100">
                        <td className="py-3 pr-4 font-medium text-slate-900">
                          <Link
                            href={`/dashboard/customers/${sub.customerId}`}
                            className="hover:underline text-blue-600"
                          >
                            {sub.customer.name}
                          </Link>
                        </td>
                        <td className="py-3 pr-4">{sub.product.name}</td>
                        <td className="py-3 pr-4">{sub.seatCount}</td>
                        <td className="py-3 pr-4">
                          {format(new Date(sub.renewalDate), "d MMM yyyy")}
                        </td>
                        <td className="py-3">
                          {sub.scheduledChanges.length > 0 ? (
                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                              {sub.scheduledChanges.length} pending
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">
                              None
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
