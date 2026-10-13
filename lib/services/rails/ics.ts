/**
 * iCalendar text, written by hand because the format is small and the details that
 * matter are easy to get wrong: CRLF line endings, escaping of commas and semicolons,
 * and folding long lines at 75 octets, which Outlook in particular insists on.
 */

export type IcsEvent = {
  uid: string;
  startsAt: Date;
  endsAt: Date;
  summary: string;
  location?: string | null;
  description?: string | null;
  url?: string | null;
};

function stamp(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function escapeIcs(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Splits a content line into 75-octet pieces, never through the middle of a character. */
export function foldLine(line: string) {
  const out: string[] = [];
  let current = "";
  let octets = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, "utf8");
    if (octets + size > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = "";
      octets = 0;
    }
    current += char;
    octets += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function buildCalendar(input: { name?: string; events: IcsEvent[]; refreshMinutes?: number; now?: Date }) {
  const now = input.now ?? new Date();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bluepass//Bookings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...(input.name ? [`X-WR-CALNAME:${escapeIcs(input.name)}`] : []),
    // Hints only. Apple Calendar and Outlook honour them; Google keeps its own schedule.
    ...(input.refreshMinutes ? [`REFRESH-INTERVAL;VALUE=DURATION:PT${input.refreshMinutes}M`, `X-PUBLISHED-TTL:PT${input.refreshMinutes}M`] : []),
  ];
  for (const e of input.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@bluepass.co`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(e.startsAt)}`,
      `DTEND:${stamp(e.endsAt)}`,
      `SUMMARY:${escapeIcs(e.summary)}`,
      ...(e.location ? [`LOCATION:${escapeIcs(e.location)}`] : []),
      ...(e.description ? [`DESCRIPTION:${escapeIcs(e.description)}`] : []),
      ...(e.url ? [`URL:${e.url}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
