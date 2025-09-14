"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { authClient } from "@/app/lib/auth-client";

const RESERVED_USERNAMES = ["help"];

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useParams();
  const rawUsername = params.username;
  const username = Array.isArray(rawUsername) ? rawUsername[0] : rawUsername;

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      // If param is missing, just redirect
      if (!username) {
        router.replace("/log-in");
        return;
      }

      // Reserved usernames skip checks
      if (RESERVED_USERNAMES.includes(username)) {
        setLoading(false);
        return;
      }

      const { data: session } = await authClient.getSession();
      if (!session) {
        router.replace("/log-in");
        return;
      }

      try {
        const res = await fetch("/api/get-name", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: session.user.id }),
        });

        const data = await res.json();

        if (data.name !== username) {
          router.replace("/log-in");
          return;
        }
      } catch (err) {
        console.error("Error verifying user:", err);
        router.replace("/log-in");
        return;
      }

      setLoading(false);
    };

    checkSession();
  }, [router, username]);

  if (loading) {
    return <p>Loading...</p>;
  }

  return <>{children}</>;
}
