import { describe, expect, it } from "vitest";
import { mainPrice } from "@/lib/services/operators/main-price";

const p = (label: string, amount: number | null) => ({ label, amount: amount as number, currency: "AUD" });
const from = (...prices: ReturnType<typeof p>[]) => mainPrice(prices)?.amount ?? null;

/** Every case here is a price list as an operator publishes it. */
describe("mainPrice", () => {
  it("takes the swim, not the observer's ticket", () => {
    // Three Islands Whale Shark Dive
    expect(from(p("Adult Snorkeller (17+)", 660), p("Child Snorkeller (16 & under)", 590), p("Family (2 adults & 2 children snorkelling)", 2350), p("Observer Only (adults & children)", 250))).toBe(660);
    // Imagine Cruises: "Swim & Watch" is the swim; its observer fare is not
    expect(from(p("Wild Dolphin Swim & Watch", 359), p("Wild Dolphin Swim & Watch Observer", 109))).toBe(359);
  });

  it("takes the swim over sightseeing, and keeps sightseeing when that is the trip", () => {
    // Temptation Sailing, Sea All Dolphin Swims, Moonraker
    expect(from(p("Wild Dolphin Swim, Adult 16+", 154), p("Wild Dolphin Watch, Adult 16+", 92), p("Cruise photos and GoPro footage (Google Drive link)", 2))).toBe(154);
    expect(from(p("Adult Snorkel (16+)", 165), p("Sightseeing Adult (16+)", 120), p("Infant (0-4 yrs)", 25))).toBe(165);
    expect(from(p("Swim, per person", 260), p("Sightsee, per person", 230))).toBe(260);
    expect(from(p("Sightseeing Adult", 120), p("Sightseeing Child", 90), p("Family Pass (2 Adults + 2 Kids)", 350))).toBe(120);
  });

  it("takes the adult fare over child, family, concession and members' fares", () => {
    expect(from(p("Adult", 89), p("Child (4-14 years)", 42), p("Concession (student, pension, senior)", 84), p("Infant (0-3 years)", 10.5))).toBe(89);
    expect(from(p("Adult", 210), p("Private Charter", null), p("Extra children in family", 110))).toBe(210);
    expect(from(p("From", 119), p("Members, from", 89))).toBe(119);
    expect(from(p("Adult 16+", 44), p("Package for Two (2 x Adults)", 149))).toBe(44);
  });

  it("takes the guided tour over self-guided hire", () => {
    expect(from(p("Self Guided", 59), p("Fully Guided", 99))).toBe(99);
  });

  it("takes the lowest of equal options and leaves add-ons out of a charter", () => {
    expect(from(p("Private Charter, Morning", 4000), p("Private Charter, Afternoon", 4400), p("Private Charter, Twilight", 3000))).toBe(3000);
    expect(from(p("Day rate, up to 12 people", 3849), p("Unlimited diving, per person per day", 139))).toBe(3849);
    expect(from(p("Exclusive Charter, 2 hours", 2500), p("Basic Catering Package #1, per person", 18), p("Basic Drinks Package, per person (2 Hours)", 35))).toBe(2500);
  });

  it("leaves out levies, deposits, minimum spends and meal add-ons", () => {
    // Coral Sea Dreaming
    expect(from(p("Snorkelling, shared cabin (single bed)", 669), p("Certified diving, shared cabin (single bed)", 1019), p("Optional extra: camera hire, 1 day", 80), p("Marine Park Levy (charged on board)", 20))).toBe(669);
    // Temptation Sailing charters
    expect(from(p("Mon to Thu daytime hire, 1.5 hours", 990), p("Deposit, 1.5 hours", 400), p("Minimum bar spend, 1.5 hours", 200))).toBe(990);
    // Baird Bay Experience
    expect(from(p("Adult Swimming", 300), p("Adult Non-Swimming", 280), p("Adult Swimming with Two-Course Lunch", 335), p("Lunch added on the day, adult", 60))).toBe(300);
  });

  it("reads a long charter price list only up to where the extras start", () => {
    // Imagine Cruises: hourly rates by month, then pick-ups, catering and guides
    expect(from(
      p("Jan, School holidays and public holidays, before 11am and after 5.30pm", 1000),
      p("Jun, Weekdays, before 11am and after 5.30pm", 400),
      p("Oct, Weekends/Friday, before 11am and after 5.30pm", 550),
      p("Pick up and drop off from Soldiers Point Marina", 390),
      p("Fruit plate", 90),
      p("Party Pack / Gourmet Street Food", 25),
      p("1 snorkel guide (up to 16 in water)", 150),
    )).toBe(400);
  });

  it("keeps a package when the package is the trip", () => {
    // Moonraker's day tours are sold only as a package
    expect(from(p("Total package, per person", 260))).toBe(260);
  });

  it("shows no From price when the site has no adult price for the trip", () => {
    expect(from(p("Kids, from", 119), p("Members, from", 89))).toBeNull();
    expect(from()).toBeNull();
  });

  it("counts a fare for adults and children alike, and sets a private charter aside beside it", () => {
    // Cooly Eco Adventures' whale watching, as their site lists it.
    expect(mainPrice([
      { label: "Per adult or child (minimum age 6)", amount: 129, currency: "AUD" },
      { label: "Private charter (up to 12 guests)", amount: 1400, currency: "AUD" },
    ])?.amount).toBe(129);
    expect(mainPrice([
      { label: "Per person (age 15+)", amount: 399, currency: "AUD" },
      { label: "Private charter (1 to 9 passengers)", amount: 3299, currency: "AUD" },
    ])?.amount).toBe(399);
    // A charter trip priced only as a charter keeps its price.
    expect(mainPrice([{ label: "Private charter, half day", amount: 1800, currency: "AUD" }])?.amount).toBe(1800);
  });

  it("never takes a supplement or an additional guest's rate for the trip's price", () => {
    // Pilgrim Sailing, as their site lists it.
    expect(mainPrice([
      { label: "Per person, from", amount: 139, currency: "AUD" },
      { label: "Supplement per person", amount: 6, currency: "AUD" },
      { label: "Sip, Sail & Dine package, per person", amount: 75, currency: "AUD" },
    ])?.amount).toBe(139);
    expect(mainPrice([
      { label: "Four-hour charter (10:15 start), up to 10 guests", amount: 2290, currency: "AUD" },
      { label: "Four-hour charter, each additional adult", amount: 229, currency: "AUD" },
      { label: "Four-hour charter, each additional child (ages 1 to 14)", amount: 149, currency: "AUD" },
      { label: "Five-hour charter (9:15 start), up to 10 guests", amount: 2790, currency: "AUD" },
    ])?.amount).toBe(2290);
  });

  it("never takes an additional hour for a charter's price", () => {
    // Kokomo Cruises' private charters, as their site lists them.
    expect(mainPrice([
      { label: "Standard rate, 2.5 hours (minimum)", amount: 2640, currency: "AUD" },
      { label: "Additional hour", amount: 660, currency: "AUD" },
    ])?.amount).toBe(2640);
    expect(mainPrice([
      { label: "Standard rate, 1 hour", amount: 820, currency: "AUD" },
      { label: "Standard rate, each additional hour", amount: 550, currency: "AUD" },
      { label: "Drinks package, per person per hour", amount: 25, currency: "AUD" },
    ])?.amount).toBe(820);
  });
});
