export type OperatorButtonAction = "accept" | "decline" | "counter";

export type OperatorButtonPayload =
  | {
      action: OperatorButtonAction;
      bookingId: string;
      source: "structured_payload";
    }
  | {
      action: OperatorButtonAction;
      bookingId: null;
      source: "button_text";
    };

/**
 * A button payload that can never parse (a foreign app's button, a corrupted
 * tap). Distinct from a transient failure: retrying it can never succeed, so
 * the webhook layer records a terminal failed receipt and answers 200 instead
 * of looping Meta redeliveries.
 */
export class InvalidOperatorButtonPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOperatorButtonPayloadError";
  }
}

const operatorButtonActions = new Set<OperatorButtonAction>([
  "accept",
  "decline",
  "counter",
]);

const buttonTextActionMap: Record<string, OperatorButtonAction> = {
  accept: "accept",
  decline: "decline",
  counter: "counter",
  "counter-offer": "counter",
};

export function parseOperatorButtonPayload(payload: string): OperatorButtonPayload {
  const trimmed = payload.trim();

  if (!trimmed) {
    throw new InvalidOperatorButtonPayloadError("Invalid operator button payload: payload is empty.");
  }

  const separatorIndex = trimmed.indexOf(":");
  if (separatorIndex < 0) {
    const buttonTextAction = buttonTextActionMap[trimmed.toLowerCase()];
    if (!buttonTextAction) {
      throw new InvalidOperatorButtonPayloadError(`Invalid operator button payload action: ${trimmed}.`);
    }

    return {
      action: buttonTextAction,
      bookingId: null,
      source: "button_text",
    };
  }

  const action = trimmed.slice(0, separatorIndex).trim();
  const bookingId = trimmed.slice(separatorIndex + 1).trim();

  if (!operatorButtonActions.has(action as OperatorButtonAction)) {
    throw new InvalidOperatorButtonPayloadError(`Invalid operator button payload action: ${action}.`);
  }

  if (!bookingId) {
    throw new InvalidOperatorButtonPayloadError("Invalid operator button payload: bookingId is required.");
  }

  return {
    action: action as OperatorButtonAction,
    bookingId,
    source: "structured_payload",
  };
}
