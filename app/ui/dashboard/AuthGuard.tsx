import { authClient } from "@/app/lib/auth-client";
import { redirect } from "next/navigation";
import { useRouter} from "next/navigation";

const RESERVED_USERNAMES = ["help"];

export async function checkUserSession(username: string) {
    const router = useRouter();
  const { data: session } = await authClient.getSession();

  if (RESERVED_USERNAMES.includes(username)) {
    return; // allow reserved pages without checks
  }

  if (!session) {
    redirect("/log-in");
  }

  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/get-name`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: session.user.id }),
    cache: "no-store",
  });

  const data = await res.json();

  if (data.name !== username) {
    router.push("/log-in");
  }
}
