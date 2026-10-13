"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { whatsappDigits } from "@/lib/services/rails/links";

export type TripWhatsAppState = { status: "idle" } | { status: "done"; on: boolean } | { status: "error"; message: string };

/**
 * A guest turning WhatsApp updates for their booking on or off. The token in the
 * page address is the only key, the same one that opened the page.
 */
export async function setTripWhatsAppAction(token: string, on: boolean, _prev: TripWhatsAppState): Promise<TripWhatsAppState> {
  const booking = await prisma.listingBooking.findUnique({ where: { guestToken: token }, select: { id: true, leadPhone: true } });
  if (!booking) return { status: "error", message: "That booking could not be found." };
  if (on && !whatsappDigits(booking.leadPhone)) {
    return { status: "error", message: "This booking has no mobile number with a country code. Ask the operator to add one." };
  }
  await prisma.listingBooking.update({ where: { id: booking.id }, data: { whatsappOptIn: on } });
  await prisma.listingBookingEvent.create({
    data: { bookingId: booking.id, type: on ? "whatsapp_on" : "whatsapp_off", actor: "guest", message: on ? "Guest turned on WhatsApp updates" : "Guest turned off WhatsApp updates" },
  });
  revalidatePath(`/trip/${token}`);
  return { status: "done", on };
}
