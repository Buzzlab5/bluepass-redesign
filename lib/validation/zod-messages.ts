import { z } from "zod";

/**
 * Plain-English wording for the validation failures Zod would otherwise report as "Invalid input".
 *
 * A form that answers a typo with "Invalid input" leaves the person to guess which box, and what is
 * wrong with it. Rules that already carry their own message (`.min(1, "Name this price")`) are left
 * alone: this only fills in the ones that were written without one. The field itself is named by the
 * server (`field`) and marked on the page, so these say what to do, not which box.
 *
 * Importing this module installs the wording for every schema in the process. It is imported by each
 * service that turns a form into a schema, so it is in place before the first parse.
 */
export function friendlyIssue(issue: {
  code: string;
  expected?: unknown;
  origin?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  format?: unknown;
}): string | undefined {
  switch (issue.code) {
    case "invalid_type":
      if (issue.expected === "number" || issue.expected === "int") return "Enter a number, like 120 or 95.50.";
      if (issue.expected === "boolean") return "Choose yes or no.";
      return "This is required.";
    case "too_small":
      if (issue.origin === "string") return issue.minimum === 1 ? "This is required." : `Use at least ${String(issue.minimum)} characters.`;
      if (issue.origin === "array") return "Pick at least one.";
      return `Must be at least ${String(issue.minimum)}.`;
    case "too_big":
      if (issue.origin === "string") return `Keep this to ${String(issue.maximum)} characters or fewer.`;
      return `Must be ${String(issue.maximum)} or less.`;
    case "invalid_format":
      if (issue.format === "email") return "That email address does not look right.";
      if (issue.format === "url") return "That link does not look right. Start it with https://.";
      return "That does not look right. Check the format and try again.";
    case "invalid_value":
      return "Pick one of the options.";
    case "not_multiple_of":
    case "invalid_union":
      return "That does not look right.";
    default:
      return undefined;
  }
}

z.config({ customError: (issue) => friendlyIssue(issue as Parameters<typeof friendlyIssue>[0]) });
