"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@/app/[username]/UserContext";
import clsx from "clsx";

export default function SettingsSidebar() {
  const pathname = usePathname();
  const { name: username } = useUser();

  const base = `/${username}/settings`;
  const links = [
    { label: "User Settings", href: `${base}/user-settings` },
    { label: "Email Settings", href: `${base}/service` },
    { label: "Review Settings", href: `${base}/review-settings` },
  ];

  return (
    <aside className="w-56 shrink-0 border-r border-gray-200 bg-white">
      <div className="px-3 py-4">
        <h2 className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Settings
        </h2>

        <nav className="flex flex-col">
          {links.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "relative flex items-center px-3 py-2 text-sm font-medium transition",
                  "text-gray-700 hover:bg-gray-100 hover:text-blue-700",
                  active && "bg-blue-50 text-blue-700"
                )}
              >
                {/* Active left indicator bar */}
                <span
                  aria-hidden="true"
                  className={clsx(
                    "absolute left-0 top-0 h-full w-0.5 bg-transparent",
                    active && "bg-blue-600"
                  )}
                />
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
