import crypto from "node:crypto";

export type WhatsAppSenderRole = "kai" | "ops";

export type WhatsAppTextMessage = {
  to: string;
  body: string;
  role?: WhatsAppSenderRole;
};

export type WhatsAppTemplateComponent =
  | {
      type: "body";
      /** `parameter_name` is set for templates created with named variables, e.g. {{guest_name}}. */
      parameters: Array<{ type: "text"; text: string; parameter_name?: string }>;
    }
  | {
      type: "button";
      sub_type: "quick_reply";
      index: string;
      parameters: [{ type: "payload"; payload: string }];
    }
  | {
      /** A link button whose URL ends in a variable; `text` is what replaces it. */
      type: "button";
      sub_type: "url";
      index: string;
      parameters: [{ type: "text"; text: string }];
    };

export type WhatsAppTemplateMessage = {
  to: string;
  name: string;
  languageCode?: string;
  role?: WhatsAppSenderRole;
  components?: WhatsAppTemplateComponent[];
};

export type WhatsAppTemplateApiPayload = {
  messaging_product: "whatsapp";
  to: string;
  type: "template";
  template: {
    name: string;
    language: { code: string };
    components?: WhatsAppTemplateComponent[];
  };
};

export type WhatsAppTextApiPayload = {
  messaging_product: "whatsapp";
  to: string;
  type: "text";
  text: {
    preview_url: false;
    body: string;
  };
};

export type WhatsAppSendResult = {
  providerMessageId: string | null;
};

type WhatsAppSendApiResponse = {
  messages?: Array<{ id?: string }>;
};

type WhatsAppErrorApiResponse = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

const DEFAULT_SEND_TIMEOUT_MS = 10_000;

function presentEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function requiredEnvValue(name: string): string {
  const value = presentEnvValue(process.env[name]);
  if (!value) {
    throw new Error(`${name} is required for WhatsApp sends.`);
  }

  return value;
}

function resolveMetaGraphVersion(): string {
  const version = requiredEnvValue("META_GRAPH_VERSION").replace(/^\/+/, "");
  return version.startsWith("v") ? version : `v${version}`;
}

function normalizeRecipientPhone(value: string): string {
  const normalized = value.trim().replace(/[^\d]/g, "");
  if (!normalized) {
    throw new Error("WhatsApp recipient phone number is required.");
  }

  return normalized;
}

export function maskPhoneNumber(value: string): string {
  const digits = normalizeRecipientPhone(value);
  if (digits.length <= 4) {
    return "****";
  }

  return `${"*".repeat(Math.max(digits.length - 4, 4))}${digits.slice(-4)}`;
}

export function buildWhatsAppTemplatePayload(
  message: WhatsAppTemplateMessage,
): WhatsAppTemplateApiPayload {
  const payload: WhatsAppTemplateApiPayload = {
    messaging_product: "whatsapp",
    to: normalizeRecipientPhone(message.to),
    type: "template",
    template: {
      name: message.name.trim(),
      language: { code: message.languageCode?.trim() || "en_US" },
    },
  };

  if (!payload.template.name) {
    throw new Error("WhatsApp template name is required.");
  }

  if (message.components?.length) {
    payload.template.components = message.components;
  }

  return payload;
}

function buildWhatsAppTextPayload(
  message: WhatsAppTextMessage,
): WhatsAppTextApiPayload {
  return {
    messaging_product: "whatsapp",
    to: normalizeRecipientPhone(message.to),
    type: "text",
    text: {
      preview_url: false,
      body: message.body,
    },
  };
}

async function postWhatsAppMessage(
  role: WhatsAppSenderRole,
  payload: WhatsAppTemplateApiPayload | WhatsAppTextApiPayload,
): Promise<WhatsAppSendResult> {
  const phoneId = resolveWhatsAppPhoneId(role);
  const graphVersion = resolveMetaGraphVersion();
  const accessToken = requiredEnvValue("WHATSAPP_ACCESS_TOKEN");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_SEND_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://graph.facebook.com/${graphVersion}/${phoneId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );

    const body = (await response.json().catch(() => undefined)) as
      | WhatsAppSendApiResponse
      | WhatsAppErrorApiResponse
      | undefined;

    if (!response.ok) {
      let metaError = "Meta Graph API rejected the WhatsApp send.";
      if (body && "error" in body) {
        const details = [
          body.error?.code ? `code=${body.error.code}` : undefined,
          body.error?.error_subcode
            ? `subcode=${body.error.error_subcode}`
            : undefined,
          body.error?.type ? `type=${body.error.type}` : undefined,
          body.error?.message ? `message=${body.error.message}` : undefined,
          body.error?.fbtrace_id
            ? `fbtrace_id=${body.error.fbtrace_id}`
            : undefined,
        ].filter(Boolean);

        metaError =
          details.length > 0 ? `${metaError} ${details.join(" ")}` : metaError;
      }

      console.warn("whatsapp.send.failed", {
        role,
        status: response.status,
        to: maskPhoneNumber(payload.to),
        type: payload.type,
        templateName:
          payload.type === "template" ? payload.template.name : undefined,
        templateLanguage:
          payload.type === "template"
            ? payload.template.language.code
            : undefined,
        metaCode: body && "error" in body ? body.error?.code : undefined,
        metaSubcode:
          body && "error" in body ? body.error?.error_subcode : undefined,
        metaMessage: body && "error" in body ? body.error?.message : undefined,
        fbtraceId: body && "error" in body ? body.error?.fbtrace_id : undefined,
      });

      throw new Error(metaError);
    }

    const providerMessageId =
      body && "messages" in body ? (body.messages?.[0]?.id ?? null) : null;

    console.info("whatsapp.send.succeeded", {
      role,
      to: maskPhoneNumber(payload.to),
      type: payload.type,
      providerMessageId: providerMessageId ? "present" : "missing",
    });

    if (
      process.env.NODE_ENV !== "production" ||
      process.env.KAI_DEBUG === "true"
    ) {
      console.info("whatsapp.send.debug", {
        role,
        to: payload.to,
        type: payload.type,
        providerMessageId,
      });
    }

    return { providerMessageId };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("whatsapp.send.timeout", {
        role,
        to: maskPhoneNumber(payload.to),
        type: payload.type,
      });
      throw new Error("WhatsApp send timed out.");
    }

    if (
      error instanceof Error &&
      error.message.startsWith("Meta Graph API rejected")
    ) {
      throw error;
    }

    console.warn("whatsapp.send.error", {
      role,
      to: maskPhoneNumber(payload.to),
      type: payload.type,
    });

    throw new Error("WhatsApp send failed.");
  } finally {
    clearTimeout(timeout);
  }
}

export function resolveWhatsAppPhoneId(role: WhatsAppSenderRole): string {
  const kaiPhoneId = presentEnvValue(process.env.WHATSAPP_PHONE_ID_KAI);

  if (role === "kai") {
    if (!kaiPhoneId) {
      throw new Error(
        "WHATSAPP_PHONE_ID_KAI is required for Kai WhatsApp sends.",
      );
    }

    return kaiPhoneId;
  }

  const opsPhoneId = presentEnvValue(process.env.WHATSAPP_PHONE_ID_OPS);
  if (opsPhoneId) {
    return opsPhoneId;
  }

  if (kaiPhoneId) {
    return kaiPhoneId;
  }

  throw new Error(
    "WHATSAPP_PHONE_ID_OPS is not set and WHATSAPP_PHONE_ID_KAI fallback is unavailable for Ops WhatsApp sends.",
  );
}

export function verifyMetaSignature({
  appSecret,
  rawBody,
  signatureHeader,
}: {
  appSecret: string;
  rawBody: string;
  signatureHeader: string | null;
}): boolean {
  if (!appSecret || !signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const expected = `sha256=${crypto
    .createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex")}`;

  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(signatureHeader, "utf8");

  return (
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

export async function sendTemplateMessage(
  message: WhatsAppTemplateMessage,
): Promise<WhatsAppSendResult> {
  const payload = buildWhatsAppTemplatePayload(message);
  return postWhatsAppMessage(message.role ?? "kai", payload);
}

export async function sendWhatsAppText(
  message: WhatsAppTextMessage,
): Promise<WhatsAppSendResult> {
  const payload = buildWhatsAppTextPayload(message);
  return postWhatsAppMessage(message.role ?? "kai", payload);
}
