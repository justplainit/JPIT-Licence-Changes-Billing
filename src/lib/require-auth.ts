import { auth, UserRole } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * Helper for API routes to check auth + role in one call.
 *
 * Usage:
 *   const { session, error } = await requireAuth("BILLING_STAFF");
 *   if (error) return error;
 *   // session is guaranteed to exist here
 */
export async function requireAuth(minimumRole?: "ADMIN" | "BILLING_STAFF") {
  const session = await auth();

  if (!session?.user) {
    return {
      session: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (minimumRole) {
    const role = (session.user as unknown as { role: UserRole }).role;

    const roleHierarchy: Record<string, number> = {
      READ_ONLY: 0,
      BILLING_STAFF: 1,
      ADMIN: 2,
    };

    const userLevel = roleHierarchy[role] ?? 0;
    const requiredLevel = roleHierarchy[minimumRole] ?? 0;

    if (userLevel < requiredLevel) {
      return {
        session: null,
        error: NextResponse.json(
          { error: "Forbidden: insufficient permissions" },
          { status: 403 }
        ),
      };
    }
  }

  return { session, error: null };
}
