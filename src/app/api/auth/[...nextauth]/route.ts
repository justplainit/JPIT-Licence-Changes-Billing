import { handlers } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export const GET = handlers.GET;

// In-memory rate limiter for login attempts (per IP, resets every 15 minutes)
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

export async function POST(req: NextRequest) {
  const url = new URL(req.url);

  if (url.pathname.includes("/callback/credentials")) {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";

    const now = Date.now();
    const entry = loginAttempts.get(ip);

    if (entry && now < entry.resetAt) {
      if (entry.count >= MAX_ATTEMPTS) {
        return NextResponse.json(
          { error: "Too many login attempts. Please try again in 15 minutes." },
          { status: 429 }
        );
      }
      entry.count++;
    } else {
      loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    }
  }

  return handlers.POST(req);
}
