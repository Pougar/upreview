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

export default async function BusinessName( { children, params }: { children: React.ReactNode, params: Promise<{ username: string }>
}) {

    const { data: session } = await authClient.getSession() // get logged-in user
    const username = await params;
    const name = username.username;


    if (RESERVED_USERNAMES.includes(name)) {
        return <>{children}</>;
    }

    if (!session) {
        console.log("no sesssion found");
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
    if (data.name !== name) {
        console.log("username mismatch");
        redirect("/log-in");
    }
    return <UserProvider value={{ name}}>{children}</UserProvider>;
}