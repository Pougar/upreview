import { authClient } from "@/app/lib/auth-client"
import { redirect } from "next/navigation";

const RESERVED_USERNAMES = ["help"];

export default async function BusinessName( { children, params }: { children: React.ReactNode; params: { username: string };}) {

    const { data: session } = await authClient.getSession() // get logged-in user
    const { username } = params;

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
    return <>{children}</>;
}