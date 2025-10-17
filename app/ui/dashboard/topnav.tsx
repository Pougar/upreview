"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "@/app/[username]/UserContext";
import { authClient } from "@/app/lib/auth-client";
import clsx from "clsx";
import { useLogoUrl } from "@/app/lib/logoUrlClient";

function resolveLogo(input: any): { url: string | null; isLoading: boolean; error: unknown | null } {
  if (typeof input === "string" || input == null) return { url: input ?? null, isLoading: false, error: null };
  if (typeof input === "object") {
    const url =
      typeof input.url === "string" ? input.url :
      typeof input.signedUrl === "string" ? input.signedUrl : null;
    const isLoading =
      typeof input.isLoading === "boolean" ? input.isLoading :
      typeof input.loading === "boolean" ? input.loading : false;
    const error = "error" in input ? (input as any).error : null;
    return { url, isLoading, error };
  }
  return { url: null, isLoading: false, error: null };
}

export default function TopNav() {
  const { name: username } = useUser() as { name: string };
  const pathname = usePathname();
  const router = useRouter();

  const links = [
    { name: "Home", path: "/dashboard" },
    { name: "Analytics", path: "/dashboard/analytics" },
    { name: "Clients", path: "/dashboard/clients" },
  ];

  const rawLogo = typeof useLogoUrl === "function" ? useLogoUrl() : null;
  const { url: resolvedLogoUrl, isLoading: logoLoading, error: logoError } = useMemo(() => resolveLogo(rawLogo as any), [rawLogo]);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [imgBroken, setImgBroken] = useState(false);

  useEffect(() => {
    setAvatarUrl(resolvedLogoUrl ?? null);
    setImgBroken(false);
  }, [resolvedLogoUrl]);

  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };

  const handleSignOut = async () => {
    await authClient.signOut({
      fetchOptions: { onSuccess: () => router.push("/log-in") },
    });
  };

  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-zinc-50 border-b border-zinc-200 shadow-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-stretch px-6">
        {/* Left: Brand */}
        <Link href={`/${username}/dashboard`} className="flex items-center gap-2 pr-6">
          <span className="text-base font-semibold text-gray-800">Review Remind</span>
        </Link>

        {/* Center: Nav links (no gaps between items) */}
        <nav className="flex items-stretch gap-0 overflow-hidden">
          {links.map((l) => {
            const href = `/${username}${l.path}`;
            const active = pathname === href || (l.path !== "/dashboard" && pathname.startsWith(href));
            return (
              <Link
                key={l.name}
                href={href}
                className={clsx(
                  "flex items-center px-6 text-base font-medium transition-colors",
                  "text-gray-700 hover:bg-gray-200 hover:text-gray-900", // visible on grey header
                  active && "text-blue-700 bg-blue-50"
                )}
              >
                {l.name}
              </Link>
            );
          })}
        </nav>

        {/* Right: Avatar dropdown */}
        <div className="ml-auto flex items-center">
          <div ref={menuRef} className="relative" onKeyDown={handleKeyDown}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className={clsx(
                "flex h-12.5 w-12.5 items-center justify-center rounded-full border transition",
                open
                  ? "ring-2 ring-blue-400 ring-offset-2 ring-offset-zinc-50 border-blue-300"
                  : "border-gray-200 hover:ring-2 hover:ring-blue-300/50 hover:ring-offset-0 hover:ring-offset-zinc-50",
                "bg-white focus:outline-none"
              )}
              title="Account menu"
            >
              {logoLoading && !avatarUrl ? (
                <div className="h-9 w-9 animate-pulse rounded-full bg-gray-200" />
              ) : avatarUrl && !imgBroken ? (
                <div className="h-9 w-9 overflow-hidden rounded-full bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={avatarUrl ?? "/DefaultPic.png"}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      e.currentTarget.src = "/snakepic.png";
                    }}
                  />
                </div>
              ) : (
                <svg viewBox="0 0 24 24" className="h-6 w-6 text-gray-500" aria-hidden="true">
                  <path fill="currentColor" d="M12 12a5 5 0 1 0-5-5a5 5 0 0 0 5 5Zm0 2c-4.418 0-8 2.239-8 5v1h16v-1c0-2.761-3.582-5-8-5Z" />
                </svg>
              )}
            </button>

            {open && (
              <div role="menu" className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                <Link
                  role="menuitem"
                  href={`/${username}/settings/user-settings`}
                  className={clsx(
                    "block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50",
                    pathname.startsWith(`/${username}/settings/user-settings`) && "bg-blue-50 text-blue-700"
                  )}
                  onClick={() => setOpen(false)}
                >
                  Settings
                </Link>
                <button
                  role="menuitem"
                  type="button"
                  onClick={handleSignOut}
                  className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  Sign out
                </button>
                {logoError ? <div className="px-4 py-2 text-xs text-red-600/80">Couldn’t load logo.</div> : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
