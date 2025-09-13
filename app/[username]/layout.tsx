import { authClient } from "@/app/lib/auth-client"
import { redirect } from "next/navigation";
import { UserProvider } from "./UserContext"

const RESERVED_USERNAMES = ["help"];

type LayoutParams = {
  username: string; // must match your folder [username]
};

interface UserLayoutProps {
  children: React.ReactNode;
  params: Record<string, string | string[]>; // generic object
}

export default async function BusinessName( { children, params }: UserLayoutProps) {

    const { data: session } = await authClient.getSession() // get logged-in user
    const usernameParam = params.username;
    const username = Array.isArray(usernameParam) ? usernameParam[0] : usernameParam;

    if (RESERVED_USERNAMES.includes(username)) {
        return <>{children}</>;
    }

    if (!session) {
    redirect("/log-in");
    }
    const res = await fetch("/api/get-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        id: session.user.id
        })
    });
    const data = await res.json();
    if (data.name !== username) {
        redirect("/log-in");
    }
    return <UserProvider value={{ username }}>{children}</UserProvider>;
}