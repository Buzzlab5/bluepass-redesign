import type { ReactNode } from "react";

/**
 * The masthead every console page opens with: the title, one plain sentence on what the page is for,
 * and, when it helps, a quiet chip beside the title naming the page's state or subject ("Draft",
 * an operator's name). No all-capitals label above the title.
 */
export default function AdminPageHeader({
  title,
  context,
  support,
  aside,
}: {
  title: string;
  context?: string;
  support?: string;
  aside?: ReactNode;
}) {
  return (
    <header className="adm-head">
      <div className="adm-head__copy">
        <h1 className="ds-display-md adm-head__title">
          {title}
          {context ? <span className="adm-head__context">{context}</span> : null}
        </h1>
        {support ? <p className="ds-body adm-head__support">{support}</p> : null}
      </div>
      {aside ? <div className="adm-head__aside">{aside}</div> : null}
    </header>
  );
}
