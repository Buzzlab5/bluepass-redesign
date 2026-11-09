import {
  buildKaiCoreHeaders,
  fetchKaiCoreWithRetry,
  resolveKaiCoreConfig,
  type KaiCoreClientEnv,
} from "@/lib/services/kai-core/client";
import type { KaiCoreBluePassQuote } from "@/lib/services/kai-core/quote-view";

/**
 * A quote is Kai's: it lives in Kai's database under the inquiry id, and Kai's
 * /api/bluepass/quotes/{id} is the same capability link the traveller was sent (the id is the
 * secret, so it never goes into a log line or a referrer). This page only reads it and posts the
 * traveller's two actions, server to server.
 */
export const QUOTE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

type FetchLike = typeof fetch;

function quoteUrl(id: string, env: KaiCoreClientEnv) {
  return `${resolveKaiCoreConfig(env).baseUrl}/api/bluepass/quotes/${encodeURIComponent(id)}`;
}

/** The quote, null when Kai has none under this id, and an error when Kai cannot be reached. */
export async function getKaiCoreBluePassQuote(
  id: string,
  env: KaiCoreClientEnv = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<KaiCoreBluePassQuote | null> {
  const config = resolveKaiCoreConfig(env);
  const response = await fetchKaiCoreWithRetry(fetchImpl, quoteUrl(id, env), {
    method: "GET",
    headers: buildKaiCoreHeaders(config),
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Kai Core quote request failed.");
  const data = (await response.json()) as { quote?: KaiCoreBluePassQuote };
  return data.quote ?? null;
}

async function postQuoteAction(id: string, action: "approve" | "checkout", env: KaiCoreClientEnv, fetchImpl: FetchLike) {
  const config = resolveKaiCoreConfig(env);
  const response = await fetchKaiCoreWithRetry(fetchImpl, quoteUrl(id, env), {
    method: "POST",
    headers: buildKaiCoreHeaders(config),
    body: JSON.stringify({ action }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Kai Core quote ${action} failed (${response.status}).`);
  return (await response.json()) as { quote?: KaiCoreBluePassQuote; checkoutUrl?: string };
}

export async function approveKaiCoreBluePassQuote(id: string, env: KaiCoreClientEnv = process.env, fetchImpl: FetchLike = fetch) {
  return (await postQuoteAction(id, "approve", env, fetchImpl)).quote ?? null;
}

/** Stripe's hosted checkout URL for an approved, payment-ready quote. */
export async function startKaiCoreBluePassQuoteCheckout(id: string, env: KaiCoreClientEnv = process.env, fetchImpl: FetchLike = fetch) {
  const { checkoutUrl } = await postQuoteAction(id, "checkout", env, fetchImpl);
  if (!checkoutUrl) throw new Error("Kai Core returned no checkout URL.");
  return checkoutUrl;
}
