"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AuthShell from "@/components/auth/AuthShell";
import Field from "@/components/auth/Field";
import Notice, { type NoticeTone } from "@/components/auth/Notice";
import Button from "@/components/ui/Button";
import { PASSWORD_MIN, resetPassword } from "@/lib/auth-client";

/**
 * The landing page for the link in the password-reset email.
 *
 * This route exists because `lib/services/auth/password-reset.ts` builds its
 * email URL as `${baseUrl}/reset-password?token=…`. Without a page here, every
 * reset email the backend sends would land on a 404.
 *
 * The token is read from `window.location.search` in an effect rather than via
 * `useSearchParams()`, which keeps the page out of a Suspense boundary — and
 * means the token never appears in a server-rendered payload.
 */
export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token")?.trim();
    setToken(t && t.length > 0 ? t : null);
    setReady(true);
  }, []);

  const mismatch = confirm.length > 0 && password !== confirm;
  const valid = password.length >= PASSWORD_MIN && password === confirm && !!token;

  /* No <form> here (see Field.tsx's onKeyDown doc) - wire Enter manually, gated the same as the
     hint text below (2026-08-21: pressing Enter previously did nothing at all). */
  const onFieldEnter = (e: { key: string; preventDefault: () => void }) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (valid) void onSubmit();
  };

  const onSubmit = async () => {
    if (!token) return;
    setBusy(true);
    setNotice(null);

    const res = await resetPassword(token, password);
    setBusy(false);

    if (!res.ok) {
      setNotice({ tone: "error", text: res.error });
      return;
    }

    /* Reset does not create a session, so the visitor still has to sign in —
       the flash flag turns that into a confirmation instead of a bare form. */
    window.location.assign("/login?passwordReset=1");
  };

  const shell = {
    image: "/hervey-bay-2.jpg",
    imageAlt: "Coastline at blue hour, Hervey Bay",
    rail: "Reset",
  };

  if (ready && !token) {
    return (
      <AuthShell
        eyebrow="Link not valid"
        headline={["This link is", "missing its key."]}
        support="Reset links are single-use and time-limited. Ask for a fresh one and it’ll work."
        {...shell}
        footer={
          <>
            Remembered it? <Link href="/login">Sign in</Link>
          </>
        }
      >
        <Notice tone="error">
          No reset token in this URL. Open the link straight from the email, or request a new one.
        </Notice>
        <div className="aactions">
          <Button variant="primary" large magnetic={false} onClick={() => window.location.assign("/login")}>
            Request a new link
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Choose a new password"
      headline={["Set it once.", "You’re back in."]}
      support="Pick something you’d actually remember. This link stops working the moment you’re done."
      {...shell}
      footer={
        <>
          Changed your mind? <Link href="/login">Back to sign in</Link>
        </>
      }
    >
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

      <Field
        label="New password"
        type="password"
        value={password}
        onChange={setPassword}
        placeholder={`At least ${PASSWORD_MIN} characters`}
        autoComplete="new-password"
        hint={`Min ${PASSWORD_MIN}`}
        required
        disabled={busy || !ready}
        reveal
        onKeyDown={onFieldEnter}
      />
      <Field
        label="Confirm new password"
        type="password"
        value={confirm}
        onChange={setConfirm}
        placeholder="Type it again"
        autoComplete="new-password"
        hint={mismatch ? "Doesn’t match" : undefined}
        required
        disabled={busy || !ready}
        reveal
        onKeyDown={onFieldEnter}
      />

      <div className="aactions">
        <Button variant="primary" large magnetic={false} onClick={valid ? onSubmit : () => {}}>
          {busy ? "Saving…" : "Save new password"}
        </Button>
        {!valid && !busy ? (
          <span className="ds-micro aactions__hint">
            {mismatch
              ? "Both fields need to match."
              : `Choose a password of at least ${PASSWORD_MIN} characters.`}
          </span>
        ) : null}
      </div>
    </AuthShell>
  );
}
