import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  applyScheduledChange,
  applyAllOverdueScheduledChanges,
} from "@/lib/apply-scheduled-changes";

// POST /api/scheduled-changes/apply
// Body: { scheduledChangeId: string }  → apply one specific change
// Body: {}                              → apply all overdue changes
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { scheduledChangeId } = body as { scheduledChangeId?: string };

  if (scheduledChangeId) {
    const result = await applyScheduledChange(scheduledChangeId);
    return NextResponse.json(result, { status: 200 });
  }

  const { processed, errors } = await applyAllOverdueScheduledChanges();
  return NextResponse.json({ processed, errors }, { status: 200 });
}
