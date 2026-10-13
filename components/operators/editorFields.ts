import type { EditorField } from "@/components/admin/FactEditor";
import { PAGE_FIELDS, TRIP_FIELDS, fieldText } from "@/lib/services/operators/prepared-edits";
import type { LoadedPage } from "@/lib/services/operators/prepared-pages";

/**
 * The correction form's fields for a prepared page and its trips, filled as the page shows
 * them now, with the website's own value beside anything already corrected. Shared by the
 * checking screen and the operator's own page, so both correct facts the same way.
 */

/** What the website says for a field that was corrected, or null when it was not. */
export function wasFor(edits: Record<string, unknown> | null, website: object, name: string) {
  if (!edits || !(name in edits)) return null;
  const field = [...TRIP_FIELDS, ...PAGE_FIELDS].find((f) => f.name === name);
  return field ? fieldText(field.kind, (website as Record<string, unknown>)[name]) : null;
}

export function tripEditor(t: LoadedPage["trips"][number]): EditorField[] {
  const shown = t.trip as unknown as Record<string, unknown>;
  return TRIP_FIELDS.map((f) => ({
    name: f.name, label: f.label, kind: f.kind, hint: f.hint,
    // The From price starts empty unless set by hand, so leaving it alone keeps it worked out.
    value: f.name === "priceFrom" ? fieldText("money", t.edits?.priceFrom) : fieldText(f.kind, shown[f.name]),
    website: wasFor(t.edits as Record<string, unknown> | null, t.website, f.name),
  }));
}

export function pageEditor(loaded: LoadedPage): EditorField[] {
  const shown = { summary: loaded.page.summary, standouts: loaded.page.standouts, phone: loaded.page.contact?.phone, email: loaded.page.contact?.email, address: loaded.page.contact?.address };
  const website = { summary: loaded.website.summary, standouts: loaded.website.standouts, phone: loaded.website.contact?.phone, email: loaded.website.contact?.email, address: loaded.website.contact?.address };
  const edited = { ...loaded.edits, ...loaded.edits?.contact } as Record<string, unknown>;
  return PAGE_FIELDS.map((f) => ({
    name: f.name, label: f.label, kind: f.kind, hint: f.hint,
    value: fieldText(f.kind, (shown as Record<string, unknown>)[f.name]),
    website: loaded.edits ? wasFor(edited, website, f.name) : null,
  }));
}

