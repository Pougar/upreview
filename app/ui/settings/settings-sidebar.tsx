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
  ];

  return (
    <aside className="w-56 shrink-0 rounded-2xl bg-white shadow-sm overflow-hidden">
      <div className="p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Settings
        </h2>
        <nav className="flex flex-col gap-1">
          {links.map((l) => {
            const active =
              pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "rounded-md px-3 py-2 text-sm font-medium",
                  active
                    ? "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200"
                    : "text-gray-700 hover:bg-gray-100"
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
