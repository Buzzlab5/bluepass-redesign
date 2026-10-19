import { describe, expect, it } from "vitest";
import { matchCreators, operatorTags, type CreatorForMatch } from "@/lib/services/onboarding/creator-match";

const ningaloo = {
  state: "WA", town: "Exmouth", category: "Whale shark swims",
  summary: "Full day whale shark swims on Ningaloo Reef, with humpback whale swims in season.",
  trips: [
    { kind: "swim", title: "Whale Shark Swim", summary: "Swim with whale sharks on Ningaloo Reef." },
    { kind: "swim", title: "Humpback Whale Swim", summary: "Swim with humpback whales." },
    { kind: "snorkel", title: "Ningaloo Reef Snorkel", summary: "Snorkel the reef with turtles." },
  ],
};

const creator = (id: string, more: Partial<CreatorForMatch>): CreatorForMatch => ({
  id, name: id, baseState: null, baseTown: null, regions: [], specialties: [], joined: false, ...more,
});

describe("matching creators to an operator", () => {
  it("reads what an operator's trips are about", () => {
    const tags = operatorTags(ningaloo);
    expect(tags.slice(0, 3)).toEqual(expect.arrayContaining(["whale-shark", "swim-with-wildlife"]));
    expect(tags).toContain("whales");
    expect(tags).toContain("turtles");
    expect(tags).not.toContain("sharks");
  });

  it("ranks creators who shoot what the operator runs, near where they run it, with reasons", () => {
    const ranked = matchCreators(ningaloo, [
      creator("sydney-surf", { baseState: "NSW", specialties: ["surf", "photo"] }),
      creator("ningaloo-shooter", { baseState: "WA", baseTown: "Exmouth", regions: ["Ningaloo Reef"], specialties: ["whale-shark", "whales", "photo"] }),
      creator("perth-diver", { baseState: "WA", specialties: ["dive", "video"] }),
    ]);
    expect(ranked.map((m) => m.creator.id)).toEqual(["ningaloo-shooter", "perth-diver", "sydney-surf"]);
    expect(ranked[0].reasons).toEqual(["Shoots whale sharks and whales", "Based in Exmouth, WA", "Works around Ningaloo Reef"]);
  });

  it("puts a creator already on Bluepass first when they match, but not when they do not", () => {
    const ranked = matchCreators(ningaloo, [
      creator("invite", { baseState: "WA", specialties: ["whale-shark"] }),
      creator("joined-match", { baseState: "WA", joined: true }),
      creator("joined-unrelated", { baseState: "TAS", specialties: ["surf"], joined: true }),
    ]);
    expect(ranked[0].creator.id).toBe("joined-match");
    expect(ranked[ranked.length - 1].creator.id).toBe("joined-unrelated");
  });

  it("ties regions on real place names, not on words like coast or port", () => {
    const montague = { state: "NSW", town: "Narooma", summary: "Seal swims at Montague Island off the Sapphire Coast.", trips: [] };
    const portStephens = { state: "NSW", town: "Nelson Bay", summary: "Dolphin cruises on Port Stephens.", trips: [] };
    const reef = { state: "QLD", town: "Cairns", summary: "Day trips to the Great Barrier Reef.", trips: [] };
    const reasons = (op: typeof montague, regions: string[]) => matchCreators(op, [creator("c", { regions })])[0].reasons;
    expect(reasons(montague, ["Sunshine Coast"])).toEqual([]);
    expect(reasons(montague, ["Montague Island"])).toEqual(["Works around Montague Island"]);
    expect(reasons(portStephens, ["Port Phillip Bay"])).toEqual([]);
    expect(reasons(portStephens, ["Port Stephens"])).toEqual(["Works around Port Stephens"]);
    expect(reasons(reef, ["Great Barrier Reef"])).toEqual(["Works around Great Barrier Reef"]);
    expect(reasons(montague, ["Lady Elliot Island"])).toEqual([]);
    expect(reasons({ ...reef, summary: "The best reef trips in tropical north Queensland, Australia." }, ["Australia", "Tropical North Queensland"])).toEqual([]);
  });

  it("ranks a creator who lives where the operator runs trips above one elsewhere in the state", () => {
    const noosa = { state: "QLD", town: "Noosa Heads", summary: "Sea kayak tours with dolphins off Noosa.", trips: [] };
    const ranked = matchCreators(noosa, [
      creator("cairns", { baseState: "QLD", baseTown: "Cairns", specialties: ["kayak"] }),
      creator("noosa", { baseState: "QLD", baseTown: "Noosa", specialties: ["kayak"] }),
    ]);
    expect(ranked.map((m) => m.creator.id)).toEqual(["noosa", "cairns"]);
    expect(ranked[0].shared).toEqual(["kayak"]);
  });

  it("never makes a match on format alone, and keeps to the limit", () => {
    const many = Array.from({ length: 30 }, (_, i) => creator(`c${i}`, { specialties: ["photo"] }));
    const ranked = matchCreators(ningaloo, many);
    expect(ranked).toHaveLength(20);
    expect(ranked.every((m) => m.reasons.length === 0)).toBe(true);
  });
});
