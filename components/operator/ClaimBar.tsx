"use client";

import { useState } from "react";

/**
 * Pinned to the foot of the claim review: what the operator is looking at, and the one
 * press that claims and publishes it. A plain form post, so the browser does a full page
 * load into their page in the operator area once it is claimed.
 */
export default function ClaimBar({ token, name, site, error, bare = false }: { token: string; name: string; site: string; error: string | null; bare?: boolean }) {
  const [sending, setSending] = useState(false);
  return (
    <>
      <div className="opp-claimhead">
        <p className="opp-claimhead__eyebrow">Your page on Bluepass</p>
        <p className="opp-claimhead__text">
          This is how {name} will look to travellers, prepared from {site}. Have a look through, including each trip. When it&rsquo;s right, claim it and it goes live. Afterwards you can correct anything and add your own logo, photos and videos.
        </p>
        {bare ? (
          <p className="opp-claimhead__text">
            {site} does not let other sites show its photos, so this page has none yet. Once it&rsquo;s yours, add a few of your own.
          </p>
        ) : null}
      </div>
      <form method="post" action="/operator/claim/confirm" className="opp-claimbar" aria-label="Claim this page" onSubmit={() => setSending(true)}>
        <input type="hidden" name="token" value={token} />
        <span className="opp-claimbar__text">
          <strong>{name}</strong>
          {error
            ? <span className="opp-claimbar__error" role="alert">{error}</span>
            : <span className="opp-claimbar__sub">Claim it to publish it. Free to list, and you set the prices.</span>}
        </span>
        <button type="submit" className="bk-cta opp-claimbar__btn" disabled={sending}>
          {sending ? "Claiming…" : "Claim and publish"}
        </button>
      </form>
    </>
  );
}
