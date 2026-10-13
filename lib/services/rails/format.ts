/**
 * Dates and times as the operator's clock reads them. Every departure is shown in
 * the zone the boat leaves from, never the viewer's: a traveller planning from
 * Sydney for a Bali dive needs to know the boat leaves at 7 in Bali.
 */

export function formatDepartureDay(departsAt: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(departsAt);
}

export function formatDepartureShort(departsAt: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone, weekday: "short", day: "numeric", month: "short",
  }).format(departsAt);
}

export function formatClock(departsAt: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(departsAt).replace(/\s?([ap])\.?m\.?/i, (_, x: string) => `${x.toLowerCase()}m`);
}

/** "8:00am" from "08:00", for times that are already local. */
export function formatLocalTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")}${suffix}`;
}

export function formatDuration(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return h === 1 ? "1 hour" : `${h} hours`;
  return `${h} hr ${m} min`;
}

/** The zone's short name for a moment, e.g. "AEST" or "WITA", for a hint beside a time. */
export function zoneAbbreviation(departsAt: Date, timeZone: string): string {
  const part = new Intl.DateTimeFormat("en-AU", { timeZone, timeZoneName: "short" })
    .formatToParts(departsAt)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}

/** Zones an operator can pick from. Ordered by where Bluepass operates, not alphabetically. */
export const OPERATOR_TIMEZONES: { value: string; label: string }[] = [
  { value: "Australia/Brisbane", label: "Queensland (Brisbane, Cairns, Whitsundays)" },
  { value: "Australia/Sydney", label: "New South Wales (Sydney, Byron)" },
  { value: "Australia/Melbourne", label: "Victoria (Melbourne)" },
  { value: "Australia/Hobart", label: "Tasmania (Hobart)" },
  { value: "Australia/Adelaide", label: "South Australia (Adelaide)" },
  { value: "Australia/Darwin", label: "Northern Territory (Darwin)" },
  { value: "Australia/Perth", label: "Western Australia (Perth, Ningaloo)" },
  { value: "Asia/Makassar", label: "Central Indonesia (Bali, Lombok, Komodo)" },
  { value: "Asia/Jayapura", label: "Eastern Indonesia (Raja Ampat, Papua)" },
  { value: "Asia/Jakarta", label: "Western Indonesia (Java, Sumatra)" },
  { value: "America/Barbados", label: "Barbados" },
  { value: "Pacific/Fiji", label: "Fiji" },
  { value: "Pacific/Auckland", label: "New Zealand" },
];

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Tue, Thu and Sat", "Every day", "Weekends". How an operator would say their own pattern. */
export function describeWeekdays(weekdays: number[]): string {
  const days = [...new Set(weekdays)].sort((a, b) => a - b);
  if (days.length === 0 || days.length === 7) return "Every day";
  if (days.join() === "0,6") return "Weekends";
  if (days.join() === "1,2,3,4,5") return "Weekdays";
  const names = days.map((d) => WEEKDAY_SHORT[d]);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** A CSS background-image value for a URL an operator typed, with anything that could break out of it escaped. */
export function cssImage(url: string): string {
  return `url("${url.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`;
}

/** "Saturday 10 October at 8:00am": a departure in a sentence, as WhatsApp messages use it. */
export function formatWhen(departsAt: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-AU", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(departsAt);
  return `${day} at ${formatClock(departsAt, timeZone)}`;
}

/** "tomorrow at 8:00am", or "on Saturday 10 October at 8:00am" when it is further off. */
export function formatWhenRelative(departsAt: Date, timeZone: string, now: Date): string {
  const local = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const tomorrow = local(new Date(now.getTime() + 86_400_000));
  if (local(departsAt) === local(now)) return `today at ${formatClock(departsAt, timeZone)}`;
  if (local(departsAt) === tomorrow) return `tomorrow at ${formatClock(departsAt, timeZone)}`;
  return `on ${formatWhen(departsAt, timeZone)}`;
}

/** The hour (0 to 23) on the operator's clock right now. */
export function localHour(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).format(now);
  return Number(hour) % 24;
}
