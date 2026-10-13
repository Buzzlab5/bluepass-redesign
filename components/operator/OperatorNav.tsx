"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeOperatorSection, operatorSections } from "@/lib/services/operator/sections";

/**
 * The operator area's rail.
 *
 * Deliberately the admin rail's markup and classes, down to the `adm-nav` names: an operator and an
 * admin are looking at variations of the same kind of page, and a second visual language for it
 * would be two sets of console styles to keep in step for no gain. Only the eyebrow and the
 * sections differ.
 */
export default function OperatorNav({
  companyName,
  email,
  railsEnabled = false,
  hasPreparedPage = false,
}: {
  companyName: string | null;
  email: string;
  railsEnabled?: boolean;
  hasPreparedPage?: boolean;
}) {
  const pathname = usePathname();
  const sections = operatorSections(railsEnabled, hasPreparedPage);
  const active = activeOperatorSection(pathname, sections);

  return (
    <nav className="adm-nav" aria-label="Operator sections">
      <Link href="/operator" className="adm-nav__brand">
        <span className="adm-nav__mark" aria-hidden>
          <Image src="/bluepass-logo-transparent.png" alt="" width={28} height={28} />
        </span>
        <span className="adm-nav__brand-text">
          <span className="ds-body-sm adm-nav__wordmark">Bluepass</span>
          <span className="ds-micro adm-nav__eyebrow">Operator</span>
        </span>
      </Link>

      <ul className="adm-nav__list">
        {sections.map((section) => {
          const isActive = active?.href === section.href;

          return (
            <li key={section.href}>
              <Link
                href={section.href}
                className={`adm-nav__link ds-body-sm ${isActive ? "is-active" : ""}`}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="adm-nav__label">{section.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="adm-nav__foot">
        <span className="ds-micro adm-nav__foot-label">Signed in as</span>
        <span className="ds-caption adm-nav__foot-value">{companyName ?? email}</span>
        <Link href="/" className="ds-micro adm-nav__exit">
          ← Back to the site
        </Link>
      </div>
    </nav>
  );
}
