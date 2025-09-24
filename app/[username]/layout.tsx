// layout.tsx (server component)
import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { UserProvider } from "./UserContext";
import { checkSessionServer } from "@/app/lib/checkSessionServer";
import { checkOnboardedServer } from "@/app/lib/checkOnboardedServer";
import { checkWelcomedServer } from "@/app/lib/checkWelcomedServer";
import { LogoUrlProvider } from "@/app/lib/logoUrlClient";
import { ensureXeroConnectedOrRedirect } from "@/app/lib/checkXeroConnected";
import TopNav from "@/app/ui/dashboard/topnav";

interface UsernameLayoutProps {
  children: ReactNode;
  params: Promise<{ username: string }>;
}

export default async function UsernameLayout({ children, params }: UsernameLayoutProps) {
  const { username } = await params;

  const result = await checkSessionServer(username);
  if (!result.valid) redirect("/log-in");

  const onboarded = await checkOnboardedServer(result.user_id);
  if (!onboarded) redirect(`/onboarding?userID=${encodeURIComponent(result.user_id)}`);
await ensureXeroConnectedOrRedirect(result.user_id);
const welcomed = await checkWelcomedServer(result.user_id);
console.log("Welcomed:", welcomed);
if (!welcomed) {redirect(`/welcome?userID=${encodeURIComponent(result.user_id)}`);}


  return (
    <UserProvider value={{ name: username, display: result.display_name }}>
      {/* client-side provider that fetches & auto-refreshes the signed URL */}
      <LogoUrlProvider userId={result.user_id}>
        <TopNav />
        <div className="pt-20 px-4 md:px-12 bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">{children}</div>
      </LogoUrlProvider>
    </UserProvider>
  );
}
