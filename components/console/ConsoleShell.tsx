"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import ConsoleIcon, { type ConsoleIconName } from "./ConsoleIcon";

export type ConsoleNavItem = {
  href: string;
  label: string;
  icon: ConsoleIconName;
  /** A number waiting behind this item (e.g. approvals), shown as a badge when above zero. */
  count?: number;
  /** Only lights up on this exact page, for an index page whose path prefixes every other one. */
  exact?: boolean;
};

export type ConsoleNavGroup = { label: string; items: ConsoleNavItem[] };

function isActive(item: ConsoleNavItem, pathname: string) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * The shell every console shares (admin, CRM, operator, partner): a top bar, a side menu card and
 * the page. Groups and items are data, so each console only says what it contains. The most
 * specific matching item is the one lit up.
 */
export default function ConsoleShell({
  area,
  groups,
  person,
  role,
  exit = { href: "/", label: "Back to bluepass.co" },
  children,
}: {
  /** What this console is, shown beside the logo: "Admin", "Operator", "Partner", "Outreach CRM". */
  area: string;
  groups: ConsoleNavGroup[];
  person: string;
  role: string;
  exit?: { href: string; label: string };
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = groups
    .flatMap((group) => group.items)
    .filter((item) => isActive(item, pathname))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const home = groups[0]?.items[0]?.href ?? "/";

  return (
    <div className="cshell">
      <header className="cshell-top">
        <Link href={home} className="cshell-brand">
          <span className="cshell-brand__mark" aria-hidden>
            <Image src="/bluepass-logo-transparent.png" alt="" width={22} height={22} />
          </span>
          <span className="cshell-brand__name">Bluepass</span>
          <span className="cshell-brand__area">{area}</span>
        </Link>
        <span className="cshell-top__spacer" />
        <span className="cshell-user">
          <span className="cshell-user__avatar" aria-hidden>
            {person.trim().charAt(0).toUpperCase() || "B"}
          </span>
          <span className="cshell-user__text">
            <span className="cshell-user__name">{person}</span>
            <span className="cshell-user__role">{role}</span>
          </span>
        </span>
      </header>

      <div className="cshell-body">
        <nav className="cshell-side" aria-label={`${area} menu`}>
          {groups.map((group) => (
            <div className="cshell-side__group" key={group.label}>
              <span className="cshell-side__label">{group.label}</span>
              {group.items.map((item) => {
                const current = item === active;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={current ? "cshell-side__link is-active" : "cshell-side__link"}
                    aria-current={current ? "page" : undefined}
                  >
                    <ConsoleIcon name={item.icon} />
                    <span className="cshell-side__text">{item.label}</span>
                    {item.count && item.count > 0 ? (
                      <span className="cshell-side__count" aria-label={`${item.count} waiting`}>
                        {item.count > 99 ? "99+" : item.count}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          ))}
          <div className="cshell-side__foot">
            <Link href={exit.href} className="cshell-side__link">
              <ConsoleIcon name="external" />
              <span className="cshell-side__text">{exit.label}</span>
            </Link>
          </div>
        </nav>
        <main className="cshell-main">{children}</main>
      </div>
    </div>
  );
}
