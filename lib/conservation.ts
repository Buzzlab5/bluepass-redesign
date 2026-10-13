/**
 * Conservation page content.
 *
 * Note on tone: this page is deliberately forward-looking — "will be dated",
 * "as reporting comes online". Nothing here claims funds already moved, and no
 * totals are invented. Keep it that way; the whole argument is auditability.
 *
 * Photography is served from /public. The partner cards crop to 9:11, so the
 * subject needs to sit near the centre of the frame.
 */

export const heroImage = "/reef-conservation3.jpg";
export const partnersBackdrop = "/reef-conservation1.jpg";
export const ctaImage = "/great-barrier-5.jpg";

export type Promise_ = {
  n: string;
  value: string;
  label: string;
  desc: string;
  /** Drives the count-up on the numeric card only. */
  count?: number;
  suffix?: string;
};

export const promises: Promise_[] = [
  {
    n: "01",
    value: "5%",
    count: 5,
    suffix: "%",
    label: "Booking contribution",
    desc: "Every Bluepass booking reserves 5% for reef restoration.",
  },
  {
    n: "02",
    value: "Monthly",
    label: "Reporting rhythm",
    desc: "Impact notes will be dated and public as partner reporting comes online.",
  },
  {
    n: "03",
    value: "Named",
    label: "Partner rule",
    desc: "We will not ask travellers to trust anonymous conservation claims.",
  },
];

export type Partner = {
  slug: string;
  name: string;
  region: string;
  desc: string;
  nextReport: string;
  img: string;
};

export const partners: Partner[] = [
  {
    slug: "great-barrier-reef-foundation",
    name: "Great Barrier Reef Foundation",
    region: "Cairns",
    desc: "Reef restoration, local monitoring, and mooring education.",
    nextReport: "November 2026",
    img: "/reef-conservation2.jpg",
  },
  {
    slug: "whitsundays-marine-trust",
    name: "Whitsundays Marine Trust",
    region: "Airlie Beach",
    desc: "Community reef patrols and coral nursery support.",
    nextReport: "November 2026",
    img: "/great-barrier-3.jpg",
  },
  {
    slug: "hervey-bay-whale-research",
    name: "Hervey Bay Whale Research",
    region: "Hervey Bay",
    desc: "Humpback migration monitoring and youth ocean education.",
    nextReport: "December 2026",
    img: "/great-barrier-4.jpg",
  },
];

export const reportLines = [
  {
    n: "01",
    title: "Where funds moved",
    desc: "Partner, region, amount, and booking month.",
    iconD: "M4 8h13m0 0l-3-3m3 3l-3 3M20 16H7m0 0l3-3m-3 3l3 3",
  },
  {
    n: "02",
    title: "What changed",
    desc: "Photos, notes, and receipts from the field.",
    iconD: "M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h4",
  },
  {
    n: "03",
    title: "What is next",
    desc: "The next project Bluepass is funding.",
    iconD: "M12 3v10M12 13l4-3M12 13l-4-3M5 17c2.5 2 4.7 2 7 0s4.5-2 7 0",
  },
];
