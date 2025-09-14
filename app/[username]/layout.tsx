import AuthGuard from "@/app/ui/dashboard/AuthGuard";

export default function UsernameLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      {children}
    </AuthGuard>
  );
}