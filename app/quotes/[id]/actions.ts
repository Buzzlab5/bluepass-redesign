"use server";

import { redirect } from "next/navigation";
import { approveKaiCoreBluePassQuote, QUOTE_ID_PATTERN, startKaiCoreBluePassQuoteCheckout } from "@/lib/services/kai-core/quotes";

function quoteIdFrom(formData: FormData) {
  const id = String(formData.get("quoteId") ?? "");
  if (!QUOTE_ID_PATTERN.test(id)) redirect("/");
  return id;
}

export async function approveQuoteAction(formData: FormData) {
  const id = quoteIdFrom(formData);
  let ok = false;
  try {
    ok = Boolean(await approveKaiCoreBluePassQuote(id));
  } catch (error) {
    console.warn("quotes.approve_failed", { reason: error instanceof Error ? error.message : "unknown" });
  }
  redirect(ok ? `/quotes/${id}` : `/quotes/${id}?notice=approve_failed`);
}

export async function payQuoteAction(formData: FormData) {
  const id = quoteIdFrom(formData);
  let checkoutUrl: string | null = null;
  try {
    checkoutUrl = await startKaiCoreBluePassQuoteCheckout(id);
  } catch (error) {
    console.warn("quotes.checkout_failed", { reason: error instanceof Error ? error.message : "unknown" });
  }
  // redirect() throws, so it stays outside the try.
  redirect(checkoutUrl ?? `/quotes/${id}?notice=pay_failed`);
}
