// app/[username]/layout.tsx
import { cookies } from "next/headers";
import { ReactNode } from "react";
import { authClient } from "@/app/lib/auth-client";
import { redirect } from "next/navigation";
import { UserProvider } from "./UserContext";

const RESERVED_USERNAMES = ["help"];

interface UsernameLayoutProps {
  children: ReactNode;
  params: Promise<{ username: string }>; // <-- params is a Promise
}

export default async function UsernameLayout({ children, params }: UsernameLayoutProps) {
  const { username } = await params;

  // Skip reserved usernames
  if (RESERVED_USERNAMES.includes(username)) {
    return <>{children}</>;
  }

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("__Secure-better-auth.session_token")?.value;

  if (!sessionToken) {
    console.log("No session token in layout");
    redirect("/log-in");
  }

  // Verify session server-side
  const {data: session, error } = await authClient.getSession({
    fetchOptions: {
      headers: { cookie: `__Secure-better-auth.session_token=${sessionToken}` }
    }
  });


if (!session || !session.user) {
    console.log("No session or user in layout");
  redirect("/log-in"); // user not logged in
}

  if (!session) {
    console.log("No session in layout");
    redirect("/log-in");
  }

  // Verify the username matches the session user
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/get-name`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: session.user.id }),
    cache: "no-store",
  });

  const data = await res.json();

  if (data.name !== username) {
    console.log("Username does not match session user in layout");
    redirect("/log-in");
  }

  // Wrap children in UserProvider
  return <UserProvider value={{ name: username }}>{children}</UserProvider>;
}
