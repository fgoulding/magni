import { NextRequest, NextResponse } from "next/server";

const PUBLIC_FILE_PATTERN = /\.(.*)$/;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("auth_token")?.value;

  if (
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/manifest.json" ||
    pathname === "/sw.js" ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/install") ||
    PUBLIC_FILE_PATTERN.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (!token && pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!token && pathname !== "/login" && pathname !== "/register") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
