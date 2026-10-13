import { after } from "next/server";
import { googleCalendarApi } from "@/lib/services/rails/google/api";
import { syncOperatorCalendar } from "@/lib/services/rails/google/sync";

/**
 * Work that should happen soon but must not hold up the person waiting: writing a
 * booking into Google Calendar after the traveller has their confirmation.
 *
 * Runs after the response with Next's after(). Outside a request (a script, a test)
 * there is no "after", so nothing runs here and the scheduled sync picks it up
 * within a quarter of an hour; the departure stays marked as changed until then.
 */
function afterResponse(label: string, task: () => Promise<unknown>) {
  try {
    after(async () => {
      try {
        await task();
      } catch (error) {
        console.warn(`rails.${label}_failed`, { error: error instanceof Error ? error.message : String(error) });
      }
    });
  } catch {
    // Not inside a request.
  }
}

export function syncCalendarSoon(operatorProfileId: string) {
  const api = googleCalendarApi();
  if (!api) return;
  afterResponse("calendar_sync", () => syncOperatorCalendar(operatorProfileId, { api }));
}
