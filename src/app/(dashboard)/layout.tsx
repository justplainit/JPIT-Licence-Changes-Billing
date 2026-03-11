import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DashboardNav } from "@/components/dashboard-nav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Sidebar navigation (client component) */}
      <DashboardNav />

      {/* Main content area */}
      <div className="lg:pl-60">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6 shadow-sm">
          {/* Spacer for mobile menu button */}
          <div className="lg:hidden w-10" />

          <div className="hidden lg:block">
            <h2 className="text-sm font-medium text-slate-600">
              M365 NCE Billing Management
            </h2>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600">
              {session.user.name || session.user.email}
            </span>
            <form
              action={async () => {
                "use server";
                const { signOut } = await import("@/lib/auth");
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>

        {/* Page content */}
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
