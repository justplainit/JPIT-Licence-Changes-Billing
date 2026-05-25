import { NextRequest, NextResponse } from "next/server";
import { applyAllOverdueScheduledChanges } from "@/lib/apply-scheduled-changes";

// Called daily by Vercel Cron (see vercel.json).
// Also callable manually with the correct CRON_SECRET.
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { processed, errors } = await applyAllOverdueScheduledChanges();

  return NextResponse.json({
    message:
      processed.length === 0 && errors.length === 0
        ? "No overdue scheduled changes found"
        : `Processed ${processed.length}, errors: ${errors.length}`,
    processed,
    ...(errors.length > 0 ? { errors } : {}),
  });
}
