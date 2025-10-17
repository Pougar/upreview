// layout.tsx (server component)
import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { UserProvider } from "./UserContext";
import { checkSessionServer } from "@/app/lib/checkSessionServer";
import { LogoUrlProvider } from "@/app/lib/logoUrlClient";
import TopNav from "@/app/ui/dashboard/topnav";
import { enforceOnboardingOrRedirect } from "@/app/lib/onboarding-flow-guard";

interface UsernameLayoutProps {
  children: ReactNode;
  params: Promise<{ username: string }>;
}

export default async function UsernameLayout({ children, params }: UsernameLayoutProps) {
  const { username } = await params;

  const result = await checkSessionServer(username);
  if (!result.valid) redirect("/log-in");

  await enforceOnboardingOrRedirect(result.user_id);


  return (
    <UserProvider value={{ name: username, display: result.display_name }}>
      {/* client-side provider that fetches & auto-refreshes the signed URL */}
      <LogoUrlProvider userId={result.user_id}>
        <TopNav />
        <div className="pt-20 px-4 md:px-12">{children}</div>
      </LogoUrlProvider>
    </UserProvider>
  );
}
