
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST(req: NextRequest) {
  try {
    const { username } = await req.json();

    if (!username) {
      return NextResponse.json(
        { valid: false, reason: "No username provided" },
        { status: 400 }
      );
    }

    // ✅ Grab the session token from cookies
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("__Secure-better-auth.session_token")?.value;

    if (!sessionToken) {
      return NextResponse.json(
        { valid: false, reason: "No session token" },
        { status: 401 }
      );
    }

    // ✅ Validate the session with Better Auth’s API
    const sessionRes = await fetch(`${process.env.AUTH_URL}/sessions/${sessionToken}`, {
      headers: {
        Authorization: `Bearer ${process.env.AUTH_API_KEY}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!sessionRes.ok) {
      return NextResponse.json(
        { valid: false, reason: "Invalid session" },
        { status: 401 }
      );
    }

    const session = await sessionRes.json();

    // ✅ Fetch the user’s stored username (or replace with direct DB query if you prefer)
    const nameRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/get-name`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: session.user.id }),
      cache: "no-store",
    });

    if (!nameRes.ok) {
      return NextResponse.json(
        { valid: false, reason: "Failed to fetch user name" },
        { status: 500 }
      );
    }

    const { name } = await nameRes.json();

    if (name !== username) {
      return NextResponse.json(
        { valid: false, reason: "Username mismatch" },
        { status: 403 }
      );
    }

    // ✅ All good
    return NextResponse.json({ valid: true });
  } catch (err) {
    console.error("check-session error:", err);
    return NextResponse.json({ valid: false, reason: "Server error" }, { status: 500 });
  }
}
