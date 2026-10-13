import Image from "next/image";
import Link from "next/link";
import { tripMoney } from "@/lib/discover";
import type { SavedTripSummary } from "@/lib/services/account/saved-trips";


/** Reuses Discover's own `region` query param to land close to the trip - there's no per-trip page
 * to deep-link to, and adding one is its own project, not part of shortlisting one. */
export default function SavedTripList({ trips }: { trips: SavedTripSummary[] }) {
  return (
    <ul className="acct-saved">
      {trips.map((trip) => (
        <li className="acct-saved__item" key={trip.slug}>
          <Link href={`/?region=${encodeURIComponent(trip.region)}`} className="acct-saved__link">
            <span className="acct-saved__thumb">
              <Image
                src={trip.img}
                alt={`${trip.name}, ${trip.region}`}
                fill
                sizes="(max-width: 760px) 33vw, 160px"
                style={{ objectFit: "cover" }}
              />
            </span>
            <span className="acct-saved__body">
              <span className="ds-body-sm acct-saved__name">{trip.name}</span>
              <span className="ds-micro acct-saved__meta">
                {trip.operator} · {trip.region}
              </span>
              <span className="ds-body-sm acct-saved__price">from {tripMoney(trip.price, trip.currency)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
