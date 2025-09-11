import { NextRequest, NextResponse } from "next/server";
import { authClient } from "@/app/lib/auth-client";


export async function middleware(req: NextRequest) {
  // List of protected paths
  const protectedPaths = ["/dashboard", "/profile"];

  const url = req.nextUrl.clone();
  const isProtected = protectedPaths.some((path) => url.pathname.startsWith(path));

  if (!isProtected) {
    return NextResponse.next(); // allow public paths
  }

  const sessionToken = req.cookies.get("betterauth_session")?.value;

  if (!sessionToken) {
    // Not logged in → redirect to login
    url.pathname = "/log-in";
    return NextResponse.redirect(url);
  }

  try {
    // Verify token with BetterAuth
    const session = await authClient.getSession({
        fetchOptions: {
        headers: {
        cookie: `betterauth_session=${sessionToken}`
            }
        }
        });
    if (!session) {
        console.log("No session found");
      url.pathname = "/log-in";
      return NextResponse.redirect(url);
    }
    // Valid session → continue
    return NextResponse.next();
  } catch (err) {
    url.pathname = "/log-in";
    return NextResponse.redirect(url);
  }
}

// Apply middleware only to these paths
export const config = {
  matcher: ["/dashboard/:path*", "/profile/:path*"],
};
