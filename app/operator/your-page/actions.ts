"use server";

import { revalidatePath } from "next/cache";
import { currentOperatorAccess } from "@/lib/services/operator/guard";
import { choosePreparedBooking } from "@/lib/services/operators/prepared-booking";
import { addOwnVideo, ownPageFor, removeOwn, setOwnHero } from "@/lib/services/operators/own-media-edits";
import { approvePhotos, operatorCorrectPage, operatorCorrectTrip } from "@/lib/services/operators/prepared-pages";

export type PhotoChoiceState = { status: "idle" } | { status: "done" | "error"; message: string };

/** The operator's choice of photos. The page is found from the signed-in account, never from the form. */
export async function choosePhotosAction(_prev: PhotoChoiceState, form: FormData): Promise<PhotoChoiceState> {
  const access = await currentOperatorAccess();
  if (!access.ok) return { status: "error", message: "Your session has expired. Sign in again and retry. Nothing was changed." };
  const keep = form.getAll("keep").map(String);
  const result = await approvePhotos({ accountId: access.account.id, keep });
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/operator/your-page");
  revalidatePath("/operator");
  return { status: "done", message: result.message };
}

/** The operator's own matches between the trips on their page and their Rezdy trips. */
export async function chooseBookingAction(_prev: PhotoChoiceState, form: FormData): Promise<PhotoChoiceState> {
  const access = await currentOperatorAccess();
  if (!access.ok) return { status: "error", message: "Your session has expired. Sign in again and retry. Nothing was changed." };
  const choices = Object.fromEntries([...form.entries()].filter(([k]) => k.startsWith("trip:")).map(([k, v]) => [k.slice(5), String(v)]));
  const result = await choosePreparedBooking({ accountId: access.account.id, choices });
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/operator/your-page");
  return { status: "done", message: result.message };
}

function formFields(form: FormData) {
  return Object.fromEntries([...form.entries()].filter(([k, v]) => !k.startsWith("$") && typeof v === "string") as [string, string][]);
}

/** The operator correcting a trip on their own page. */
export async function correctTripAction(listingId: string, _prev: PhotoChoiceState, form: FormData): Promise<PhotoChoiceState> {
  const access = await currentOperatorAccess();
  if (!access.ok) return { status: "error", message: "Your session has expired. Sign in again and retry. Nothing was changed." };
  const result = await operatorCorrectTrip({ accountId: access.account.id, listingId, form: formFields(form) });
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/operator/your-page");
  return { status: "done", message: result.message.replace(" Approve the trip when it is right.", "") };
}

/** The operator correcting the details at the top of their page. */
export async function correctPageAction(_prev: PhotoChoiceState, form: FormData): Promise<PhotoChoiceState> {
  const access = await currentOperatorAccess();
  if (!access.ok) return { status: "error", message: "Your session has expired. Sign in again and retry. Nothing was changed." };
  const result = await operatorCorrectPage({ accountId: access.account.id, form: formFields(form) });
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/operator/your-page");
  return { status: "done", message: result.message.replace(" Approve the page when it is right.", "") };
}

async function afterOwnChange(accountId: string) {
  revalidatePath("/operator/your-page");
  const page = await ownPageFor(accountId);
  if (page.ok) revalidatePath(`/operators/${page.slug}`, "layout");
}

/** A video the operator links to, from YouTube, Vimeo or their own site. */
export async function addVideoAction(_prev: PhotoChoiceState, form: FormData): Promise<PhotoChoiceState> {
  const access = await currentOperatorAccess();
  if (!access.ok) return { status: "error", message: "Your session has expired. Sign in again and retry. Nothing was changed." };
  const result = await addOwnVideo({ accountId: access.account.id, url: String(form.get("url") ?? ""), title: String(form.get("title") ?? "") });
  if (!result.ok) return { status: "error", message: result.message };
  await afterOwnChange(access.account.id);
  return { status: "done", message: result.message };
}

/** Takes one of the operator's own photos, their logo or a video off their page. */
export async function removeOwnAction(url: string): Promise<PhotoChoiceState> {
  const access = await currentOperatorAccess();
  if (!access.ok) return { status: "error", message: "Your session has expired. Sign in again and retry. Nothing was changed." };
  const result = await removeOwn({ accountId: access.account.id, url });
  if (!result.ok) return { status: "error", message: result.message };
  await afterOwnChange(access.account.id);
  return { status: "done", message: result.message };
}

/** One of the operator's own photos chosen to lead their page. */
export async function leadPhotoAction(url: string): Promise<PhotoChoiceState> {
  const access = await currentOperatorAccess();
  if (!access.ok) return { status: "error", message: "Your session has expired. Sign in again and retry. Nothing was changed." };
  const result = await setOwnHero({ accountId: access.account.id, url });
  if (!result.ok) return { status: "error", message: result.message };
  await afterOwnChange(access.account.id);
  return { status: "done", message: result.message };
}
