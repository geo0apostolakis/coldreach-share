"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, ScrollText, Settings, LogOut, Radar, TrendingUp } from "lucide-react";

const ENVIRONMENTS = [
  { id: "email", label: "Cold Email", home: "/" },
  { id: "machine", label: "Lead Machine", home: "/machine" },
] as const;

type NavItem = { href: string; label: string; short: string; icon: typeof LayoutGrid };

const NAV: Record<(typeof ENVIRONMENTS)[number]["id"], NavItem[]> = {
  email: [
    { href: "/", label: "Campaigns", short: "Campaigns", icon: LayoutGrid },
    { href: "/metrics", label: "Business", short: "Business", icon: TrendingUp },
    { href: "/logs", label: "Activity", short: "Activity", icon: ScrollText },
    { href: "/settings", label: "Settings", short: "Settings", icon: Settings },
  ],
  machine: [{ href: "/machine", label: "Pipeline", short: "Pipeline", icon: Radar }],
};

function useEnvironment() {
  const pathname = usePathname();
  return {
    pathname,
    environment: pathname.startsWith("/machine") ? ("machine" as const) : ("email" as const),
  };
}

function isActive(href: string, pathname: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
}

/** Desktop only. The phone gets MobileTopBar plus MobileNav instead. */
export default function Sidebar() {
  const { pathname, environment } = useEnvironment();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-ink-700 bg-ink-950 px-3 py-5 md:flex">
      <Link href="/" className="mb-7 flex items-center gap-2.5 px-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/automatesphere-logo.png" alt="Automatesphere" className="h-8 w-8 shrink-0" />
        <span className="flex flex-col leading-tight">
          <span className="text-[14px] font-semibold tracking-tight">Automatesphere</span>
          <span className="text-[11px] text-ink-400">AI Console</span>
        </span>
      </Link>

      <div className="mb-4 flex gap-1 rounded-lg bg-ink-900 p-1">
        {ENVIRONMENTS.map((env) => (
          <Link
            key={env.id}
            href={env.home}
            className={`flex-1 rounded-md px-2 py-1.5 text-center text-[11px] font-medium transition-colors ${
              environment === env.id ? "bg-ink-800 text-ink-100" : "text-ink-400 hover:text-ink-200"
            }`}
          >
            {env.label}
          </Link>
        ))}
      </div>

      <nav className="flex flex-col gap-1">
        {NAV[environment].map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
              isActive(href, pathname)
                ? "bg-ink-800 font-medium text-ink-100"
                : "text-ink-300 hover:bg-ink-850 hover:text-ink-100"
            }`}
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}
      </nav>

      <button
        onClick={logout}
        className="mt-auto flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-400 transition-colors hover:bg-ink-850 hover:text-ink-100"
      >
        <LogOut size={16} />
        Sign out
      </button>
    </aside>
  );
}

/** Phone header: identity, environment switch and sign out, in one thin row. */
export function MobileTopBar() {
  const { environment } = useEnvironment();

  return (
    <header className="safe-top sticky top-0 z-30 flex items-center gap-3 border-b border-ink-700 bg-ink-950/95 px-4 pb-2 backdrop-blur md:hidden">
      <Link href="/" className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/automatesphere-logo.png" alt="Automatesphere" className="h-7 w-7 shrink-0" />
        <span className="text-[13px] font-semibold tracking-tight">Automatesphere</span>
      </Link>

      <div className="ml-auto flex gap-1 rounded-lg bg-ink-900 p-0.5">
        {ENVIRONMENTS.map((env) => (
          <Link
            key={env.id}
            href={env.home}
            className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium ${
              environment === env.id ? "bg-ink-800 text-ink-100" : "text-ink-400"
            }`}
          >
            {env.id === "email" ? "Email" : "Machine"}
          </Link>
        ))}
      </div>

      <button onClick={logout} className="grid h-9 w-9 place-items-center text-ink-400" aria-label="Sign out">
        <LogOut size={17} />
      </button>
    </header>
  );
}

/**
 * Bottom tab bar, because the top of a phone screen is the hardest place to
 * reach one-handed and this is used on the move.
 */
export function MobileNav() {
  const { pathname, environment } = useEnvironment();
  const items = NAV[environment];

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex border-t border-ink-700 bg-ink-950/95 pt-1 backdrop-blur md:hidden">
      {items.map(({ href, short, icon: Icon }) => {
        const active = isActive(href, pathname);
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-1 flex-col items-center gap-1 px-1 py-1.5 text-[10px] font-medium ${
              active ? "text-brand-400" : "text-ink-400"
            }`}
          >
            <Icon size={20} />
            {short}
          </Link>
        );
      })}
    </nav>
  );
}
