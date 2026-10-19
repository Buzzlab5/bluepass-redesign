import { describe, expect, it } from "vitest";
import { playable, playableVideos, videoLookup, vimeoStill } from "@/lib/services/operators/videos";

describe("operator videos", () => {
  it("reads YouTube links in every shape operators paste them", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      "https://youtube.com/shorts/dQw4w9WgXcQ",
    ]) {
      expect(playable({ url })).toMatchObject({ kind: "youtube", id: "dQw4w9WgXcQ", poster: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" });
    }
  });

  it("reads Vimeo and self-hosted files, and refuses anything else", () => {
    expect(playable({ url: "https://vimeo.com/123456789" })).toMatchObject({ kind: "vimeo", id: "123456789" });
    expect(playable({ url: "https://player.vimeo.com/video/123456789?h=abc" })).toMatchObject({ kind: "vimeo", id: "123456789" });
    expect(playable({ url: "https://reef.test/media/hero.mp4" })).toMatchObject({ kind: "file" });
    expect(playable({ url: "http://reef.test/media/hero.mp4" })).toBeNull();
    expect(playable({ url: "https://www.facebook.com/reef/videos/1" })).toBeNull();
    expect(playable({ url: "not a url" })).toBeNull();
  });

  it("keeps each video once", () => {
    expect(playableVideos([{ url: "https://youtu.be/dQw4w9WgXcQ" }, { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }])).toHaveLength(1);
  });

  it("gives a Vimeo video its still, and asks oEmbed whether a video may be shown", () => {
    expect(playable({ url: "https://vimeo.com/123456789", poster: "https://i.vimeocdn.com/video/1-d_960x540" })).toMatchObject({ poster: "https://i.vimeocdn.com/video/1-d_960x540" });
    expect(playable({ url: "https://vimeo.com/123456789", poster: "javascript:alert(1)" })).toMatchObject({ poster: null });
    expect(vimeoStill("https://i.vimeocdn.com/video/2166914880-f529-d_295x166?region=us")).toBe("https://i.vimeocdn.com/video/2166914880-f529-d_960x540?region=us");
    expect(vimeoStill("https://i.vimeocdn.com/video/684437992-3422-d_640?region=us")).toBe("https://i.vimeocdn.com/video/684437992-3422-d_960x540?region=us");
    const yt = playable({ url: "https://youtu.be/dQw4w9WgXcQ" })!;
    expect(videoLookup(yt)).toBe("https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ");
    expect(videoLookup(playable({ url: "https://vimeo.com/123456789" })!)).toBe("https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F123456789");
  });

  it("keeps an unlisted Vimeo video's private code, without which it will not play", () => {
    const unlisted = playable({ url: "https://vimeo.com/935333851/0191b41527" })!;
    expect(unlisted).toMatchObject({ kind: "vimeo", id: "935333851", hash: "0191b41527", embed: "https://player.vimeo.com/video/935333851?h=0191b41527&autoplay=1" });
    expect(videoLookup(unlisted)).toBe("https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F935333851%2F0191b41527");
    expect(playable({ url: "https://player.vimeo.com/video/935333851?h=0191b41527" })).toMatchObject({ hash: "0191b41527" });
    expect(playable({ url: "https://vimeo.com/123456789" })).toMatchObject({ hash: null, embed: "https://player.vimeo.com/video/123456789?autoplay=1" });
  });
});
