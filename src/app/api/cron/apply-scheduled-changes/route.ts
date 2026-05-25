import { NextRequest, NextResponse } from "next/server";
import {
  applyAllOverdueScheduledChanges,
  rollForwardOverdueRenewalDates,
} from "@/lib/apply-scheduled-changes";

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

  const [{ processed, errors }, { updated: renewalsRolled }] = await Promise.all([
    applyAllOverdueScheduledChanges(),
    rollForwardOverdueRenewalDates(),
  ]);

  return NextResponse.json({
    message: `Scheduled changes: ${processed.length} applied, ${errors.length} errors. Renewal dates rolled forward: ${renewalsRolled.length}.`,
    processed,
    renewalsRolled,
    ...(errors.length > 0 ? { errors } : {}),
  });
}
