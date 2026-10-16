"use client";

import { useRouter } from "next/navigation";
import OperatorListingForm from "@/components/operator/OperatorListingForm";

/** The first step of a new trip: what it is. Saving carries straight on to when it runs and what it costs. */
export default function NewTripPanel() {
  const router = useRouter();
  return <OperatorListingForm nextStepIsSetup onDone={() => router.push("/operator/trips")} />;
}
