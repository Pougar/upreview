'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useUser } from '@/app/[username]/UserContext'; // ✅ import context

// List of links without the username — we'll inject it at runtime
const links = [
  { name: 'Home', path: '/dashboard' },
  { name: 'Statistics', path: '/dashboard/statistics' },
  { name: 'Service', path: '/dashboard/service' },
  { name: 'Settings', path: '/settings' },
  { name: 'Clients', path: '/dashboard/clients' },
];

export default function NavLinks() {
  const pathname = usePathname();
  const { name: username } = useUser(); // ✅ get username from context

  return (
    <>
      {links.map((link) => {
        const href = `/${username}${link.path}`; // ✅ build concrete URL
        return (
          <Link
            key={link.name}
            href={href}
            className={clsx(
              'flex h-[48px] grow items-center justify-center gap-2 rounded-md bg-gray-50 p-3 text-sm font-medium hover:bg-sky-100 hover:text-blue-600 md:flex-none md:justify-start md:p-2 md:px-3',
              {
                'bg-sky-100 text-blue-600': pathname === href,
              },
            )}
          >
            <p className="hidden md:block">{link.name}</p>
          </Link>
        );
      })}
    </>
  );
}
