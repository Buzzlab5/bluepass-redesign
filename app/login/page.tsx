"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AuthShell from "@/components/auth/AuthShell";
import Field from "@/components/auth/Field";
import Notice, { type NoticeTone } from "@/components/auth/Notice";
import Button from "@/components/ui/Button";
import { useSession } from "@/components/auth/SessionProvider";
import { forgotPassword, login, resendVerification } from "@/lib/auth-client";

/**
 * Sign in, plus the two dead ends that hang off it:
 *
 * - an unverified account (login answers 403 `EMAIL_NOT_VERIFIED`) needs a
 *   resend, not just an error, or the visitor is stuck;
 * - `/api/auth/verify-email` bounces failures here as `?verification=…`.
 *
 * Forgot-password lives in this page as a mode swap rather than its own route.
 * It is one field and one call, and keeping it here means the visitor never
 * loses the email they already typed.
 */
type Mode = "signin" | "forgot";

/**
 * `?next=` is attacker-supplied — anyone can mail out a Bluepass login link
 * carrying someone else's destination. Only a single-slash relative path is
 * allowed through: "//evil.com" and "https://evil.com" are both absolute to the
 * browser and would turn this page into an open redirect.
 *
 * Returns null rather than "/" for "no usable destination", so the caller can
 * tell an explicit request apart from the default and pick a landing page by
 * role instead of overriding somewhere the visitor actually asked for.
 */
function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : null;
}

/**
 * Why the operator area bounced someone back here, per
 * `requireOperatorOrRedirect`. Sending an already-signed-in person to a login
 * form only makes sense with the reason attached — and in the commonest case it
 * is the right destination, because they are signed in as their own traveller
 * account rather than the operator one the invite was sent to.
 */
const OPERATOR_NOTICES: Record<string, { tone: NoticeTone; text: string }> = {
  "signed-out": {
    tone: "info",
    text: "Sign in to reach your operator dashboard.",
  },
  "not-operator": {
    tone: "error",
    text: "That account isn’t set up as an operator. If Bluepass sent you a login invite, sign in with the address it was sent to.",
  },
  "no-profile": {
    tone: "error",
    text: "Your account is marked as an operator but has no operator profile attached, so there’s nothing for us to show you. Your Bluepass contact needs to fix that — signing in again won’t.",
  },
};

/** Same idea as OPERATOR_NOTICES, for `requirePartnerOrRedirect`. */
const PARTNER_NOTICES: Record<string, { tone: NoticeTone; text: string }> = {
  "signed-out": {
    tone: "info",
    text: "Sign in to reach your partner dashboard.",
  },
  "not-partner": {
    tone: "error",
    text: "That account isn’t set up as a partner. If Bluepass sent you a login invite, sign in with the address it was sent to.",
  },
  "no-profile": {
    tone: "error",
    text: "Your account is marked as a partner but has no partner profile attached, so there’s nothing for us to show you. Your Bluepass contact needs to fix that — signing in again won’t.",
  },
};

/**
 * Where a freshly signed-in account belongs when it didn't ask for anywhere.
 *
 * Only operators are redirected: an operator's whole reason for having a login
 * is `/operator`, and the homepage is a traveller's marketing page, so landing
 * them there means every sign-in starts with a hunt for a link that isn't in
 * the nav. Travellers keep the homepage, and an account that is both admin and
 * operator lands in the admin console — the more privileged surface is the one
 * they signed in to use, and `/operator` stays one click away.
 *
 * The ADMIN test is the roles array only. `requireCurrentAdmin` also honours
 * `BLUEPASS_ADMIN_EMAILS`, which the browser cannot see and which names Bluepass
 * staff — none of whom hold an `OperatorProfile`, so this branch never reaches
 * them.
 */
function landingFor(roles: string[]) {
  if (roles.includes("ADMIN")) return "/admin";
  if (roles.includes("OPERATOR")) return "/operator";
  if (roles.includes("PARTNER")) return "/partner-portal";
  return "/";
}

export default function LoginPage() {
  const { refresh } = useSession();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  /** Set when login 403s — drives the resend affordance. */
  const [unverified, setUnverified] = useState<string | null>(null);
  /* Where to land after signing in, when the visitor asked for somewhere
     specific. The admin and operator gates send people here with the page they
     actually wanted, so honouring it is what stops a deep link into /admin
     dumping them on the home page. Null means "nobody asked" — see onSignIn. */
  const [next, setNext] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNext(safeNext(params.get("next")));

    const operatorReason = params.get("operator");
    if (operatorReason && OPERATOR_NOTICES[operatorReason]) {
      setNotice(OPERATOR_NOTICES[operatorReason]);
      return;
    }

    const partnerReason = params.get("partner");
    if (partnerReason && PARTNER_NOTICES[partnerReason]) {
      setNotice(PARTNER_NOTICES[partnerReason]);
      return;
    }

    const reason = params.get("verification");
    if (!reason) return;
    setNotice({
      tone: "error",
      text:
        reason === "invalid-token"
          ? "That verification link has expired or was already used. Sign in and we’ll send a fresh one."
          : "That verification link was incomplete. Sign in and we’ll send a fresh one.",
    });
  }, []);

  const onSignIn = async () => {
    setBusy(true);
    setNotice(null);
    setUnverified(null);

    const res = await login(email.trim(), password);

    if (!res.ok) {
      if (res.code === "EMAIL_NOT_VERIFIED") {
        setUnverified(res.email ?? email.trim());
        setNotice({ tone: "info", text: res.error });
      } else {
        setNotice({ tone: "error", text: res.error });
      }
      setBusy(false);
      return;
    }

    /* The cookie is set — pull the session before navigating so the nav is
       already showing the signed-in state when the next page paints. */
    const me = await refresh();
    // A full page load, so the browser shows its own loading spinner while the next page loads.
    window.location.assign(next ?? landingFor(me?.roles ?? []));
  };

  const onResend = async () => {
    if (!unverified) return;
    setBusy(true);
    await resendVerification(unverified);
    setBusy(false);
    setNotice({
      tone: "success",
      text: `Verification sent to ${unverified}. Open it and you’ll be signed straight in.`,
    });
    setUnverified(null);
  };

  const onForgot = async () => {
    setBusy(true);
    setNotice(null);
    const res = await forgotPassword(email.trim());
    setBusy(false);

    if (!res.ok) {
      setNotice({ tone: "error", text: res.error });
      return;
    }

    /* The route answers identically whether or not the account exists, so the
       copy must not imply one — it would leak which emails are registered. */
    setNotice({
      tone: "success",
      text: `If ${email.trim()} has a Bluepass account, a reset link is on its way.`,
    });

    if (res.developmentResetUrl) {
      // eslint-disable-next-line no-console
      console.info("[dev] password reset URL:", res.developmentResetUrl);
    }
  };

  const canSignIn = email.trim().length > 3 && password.length >= 8 && !busy;
  const canForgot = email.trim().length > 3 && !busy;

  /* No <form> here (see Field.tsx's onKeyDown doc) - wire Enter manually, gated the same as the
     hint text below (2026-08-21: pressing Enter previously did nothing at all). */
  const onFieldEnter = (e: { key: string; preventDefault: () => void }) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (mode === "signin") {
      if (canSignIn) void onSignIn();
    } else if (canForgot) {
      void onForgot();
    }
  };

  return (
    <AuthShell
      eyebrow={mode === "signin" ? "Welcome back" : "Reset your password"}
      headline={mode === "signin" ? ["Back to the", "water."] : ["Let’s get you", "back in."]}
      support={
        mode === "signin"
          ? "Your saved trips, your enquiries, and every booking’s 5%, all where you left them."
          : "We’ll email you a link. It expires shortly, so use it while it’s warm."
      }
      image="/whitsundays-1.jpg"
      imageAlt="Whitehaven sandbar, Whitsundays"
      rail={mode === "signin" ? "Sign in" : "Reset"}
      footer={
        <>
          New to Bluepass? <Link href="/register">Create an account</Link>
        </>
      }
    >
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

      {unverified ? (
        <button type="button" className="alink-btn ds-body-sm" onClick={onResend} disabled={busy}>
          Resend the verification email →
        </button>
      ) : null}

      <Field
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
        placeholder="you@example.com"
        autoComplete="email"
        required
        disabled={busy}
        onKeyDown={onFieldEnter}
      />

      {mode === "signin" ? (
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="At least 8 characters"
          autoComplete="current-password"
          required
          disabled={busy}
          reveal
          hint="Min 8"
          onKeyDown={onFieldEnter}
        />
      ) : null}

      <div className="aactions">
        <Button
          variant="primary"
          large
          magnetic={false}
          onClick={mode === "signin" ? onSignIn : onForgot}
        >
          {busy
            ? "One moment…"
            : mode === "signin"
              ? "Sign in"
              : "Email me a reset link"}
        </Button>
        {mode === "signin" && !canSignIn && !busy ? (
          <span className="ds-micro aactions__hint">Enter your email and password to continue.</span>
        ) : null}
        {mode === "forgot" && !canForgot && !busy ? (
          <span className="ds-micro aactions__hint">Enter the email on your account.</span>
        ) : null}
      </div>

      <button
        type="button"
        className="alink-btn alink-btn--quiet ds-body-sm"
        onClick={() => {
          setMode((m) => (m === "signin" ? "forgot" : "signin"));
          setNotice(null);
          setUnverified(null);
        }}
      >
        {mode === "signin" ? "Forgot your password?" : "← Back to sign in"}
      </button>
    </AuthShell>
  );
}
