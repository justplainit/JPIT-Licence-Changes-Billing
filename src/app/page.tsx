import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function Home() {
  const session = await auth();

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50">
      <div className="w-full max-w-md space-y-8 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900">M365 Billing</h1>
          <p className="mt-2 text-sm text-slate-500">
            NCE Licence Changes &amp; Billing Management System
          </p>
        </div>

        <div className="space-y-4">
          <p className="text-center text-sm text-slate-600">
            Sign in to manage Microsoft 365 NCE subscriptions, licence changes,
            and billing operations.
          </p>

          <Link
            href="/login"
            className="flex h-10 w-full items-center justify-center rounded-lg bg-slate-900 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            Sign in
          </Link>
        </div>

        <p className="text-center text-xs text-slate-400">
          Authorised personnel only
        </p>
      </div>
    </div>
  );
}
