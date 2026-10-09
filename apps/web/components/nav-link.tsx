'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from './ui';

export function NavLink({ href, emoji, label, exact }: { href: string; emoji: string; label: string; exact?: boolean }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition',
        active ? 'bg-ember-500/15 font-semibold text-ember-300' : 'text-coal-300 hover:bg-coal-800 hover:text-coal-100',
      )}
    >
      <span aria-hidden className="w-5 text-center">
        {emoji}
      </span>
      {label}
    </Link>
  );
}
