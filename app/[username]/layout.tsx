// app/[username]/layout.tsx
import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { UserProvider } from "./UserContext";

interface UsernameLayoutProps {
  children: ReactNode;
  params: Promise<{ username: string }>; // ✅ Promise in Next.js 15
}

export default async function UsernameLayout({ children, params }: UsernameLayoutProps) {
  // ✅ Await the promise before destructuring
  const resolvedParams = await params;
  const { username } = resolvedParams;

  // ✅ Call server API to validate session + username
  const res = await fetch(`/api/check-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
    cache: "no-store", // always validate fresh
  });

  if (!res.ok) {
    console.log("check-session API failed in layout");
    redirect("/log-in");
  }

  const data = await res.json();

  if (!data.valid) {
    console.log("Invalid session or username in layout");
    redirect("/log-in");
  }

  // ✅ If valid, wrap children in UserProvider
  return <UserProvider value={{ name: username }}>{children}</UserProvider>;
}
