import { NextRequest, NextResponse } from "next/server";
import { forwardWhatsAppWebhookToKaiCore, shouldUseKaiCore } from "@/lib/services/kai-core/client";
import { sendWhatsAppText, verifyMetaSignature } from "@/lib/services/whatsapp/client";
import { handleWhatsAppWebhook } from "@/lib/services/whatsapp/webhook-handler";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (
    mode === "subscribe" &&
    token &&
    token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN &&
    challenge
  ) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Webhook verification failed." }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-hub-signature-256");
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? "";

  if (!appSecret) {
    console.warn("whatsapp.webhook.missing_app_secret", {
      note: "WHATSAPP_APP_SECRET is required to verify Meta webhook signatures.",
    });
  }

  const validSignature = verifyMetaSignature({
    appSecret,
    rawBody,
    signatureHeader,
  });

  if (!validSignature) {
    console.warn("whatsapp.webhook.invalid_signature", {
      hasSignatureHeader: Boolean(signatureHeader),
      hasAppSecret: Boolean(appSecret),
    });
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: unknown;

  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  try {
    if (shouldUseKaiCore()) {
      await forwardWhatsAppWebhookToKaiCore(payload).catch((error) => {
        console.warn("whatsapp.webhook.kai_core_forward_failed", {
          message: error instanceof Error ? error.message : "Unable to forward webhook to Kai Core",
        });
      });
    }

    await handleWhatsAppWebhook(payload, {
      onOperatorFollowUp: async (message, context) => {
        if (!context.to) {
          return;
        }

        await sendWhatsAppText({
          to: context.to,
          role: "ops",
          body: message.body,
        });
      },
      onTravellerReply: async (message, context) => {
        await sendWhatsAppText({
          to: context.to,
          role: "kai",
          body: message.body,
        });
      },
    });
  } catch (error) {
    console.warn("whatsapp.webhook.handler_failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unable to process webhook",
    });
    return NextResponse.json({ error: "Unable to process webhook." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
