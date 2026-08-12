export { auth as proxy } from "@/lib/auth";

export const config = {
  matcher: [
    // Protect dashboard and API routes (except auth endpoints)
    "/dashboard/:path*",
    "/api/((?!auth).*)",
  ],
};
