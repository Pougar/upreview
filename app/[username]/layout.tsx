// app/[username]/layout.tsx
import { ReactNode } from "react";
import { authClient } from "@/app/lib/auth-client";
import { redirect } from "next/navigation";
import { UserProvider } from "./UserContext";

const RESERVED_USERNAMES = ["help"];

interface UsernameLayoutProps {
  children: ReactNode;
  params: { username: string };
}

export default async function UsernameLayout({ children, params }: UsernameLayoutProps) {
  const { username } = params;

  // Skip reserved usernames
  if (RESERVED_USERNAMES.includes(username)) {
    return <>{children}</>;
  }

  // Get session from BetterAuth
  const { data: session } = await authClient.getSession();

  if (!session) {
    redirect("/log-in"); // server-side redirect
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
    redirect("/log-in");
  }

  // Wrap children in UserProvider
  return <UserProvider value={{ name: username }}>{children}</UserProvider>;
}
