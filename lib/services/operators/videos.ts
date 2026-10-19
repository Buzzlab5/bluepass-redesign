/**
 * An operator's own videos, as linked from their website: YouTube, Vimeo, or a file they
 * host. Each becomes a still with a play button that loads the player only when pressed,
 * so a page with six videos does not load six players.
 */

/** `poster` is the still Vimeo gives for a video, found when the page is imported. */
export type PreparedVideo = { url: string; title?: string | null; sourceUrl?: string | null; poster?: string | null };
export type PlayableVideo =
  | { kind: "youtube"; id: string; title: string | null; poster: string; embed: string }
  | { kind: "vimeo"; id: string; hash: string | null; title: string | null; poster: string | null; embed: string }
  | { kind: "file"; url: string; title: string | null; poster: null; embed: string };

export function playable(video: PreparedVideo): PlayableVideo | null {
  const title = video.title?.trim() || null;
  let url: URL;
  try {
    url = new URL(video.url.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  const youtube =
    host === "youtu.be" ? url.pathname.slice(1)
    : host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")
      ? url.searchParams.get("v") ?? url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/)?.[1] ?? null
      : null;
  if (youtube && /^[\w-]{11}$/.test(youtube)) {
    return {
      kind: "youtube", id: youtube, title,
      poster: `https://i.ytimg.com/vi/${youtube}/hqdefault.jpg`,
      embed: `https://www.youtube-nocookie.com/embed/${youtube}?autoplay=1&rel=0`,
    };
  }
  const vimeo = host.endsWith("vimeo.com") ? url.pathname.match(/(?:^|\/)(\d{6,})(?:\/|$)/)?.[1] : null;
  if (vimeo) {
    const poster = video.poster?.startsWith("https://") ? video.poster : null;
    // An unlisted video plays only with its private code: vimeo.com/ID/CODE or ?h=CODE.
    const hash = url.searchParams.get("h") ?? url.pathname.match(new RegExp(`/${vimeo}/([0-9a-f]{6,})(?:/|$)`))?.[1] ?? null;
    const embed = `https://player.vimeo.com/video/${vimeo}?${hash ? `h=${hash}&` : ""}autoplay=1`;
    return { kind: "vimeo", id: vimeo, hash, title, poster, embed };
  }
  if (url.protocol === "https:" && /\.(mp4|webm|mov)$/i.test(url.pathname)) return { kind: "file", url: url.toString(), title, poster: null, embed: url.toString() };
  return null;
}

/** The videos that can be played, once each, in the operator's order. */
export function playableVideos(videos: PreparedVideo[] | undefined | null): PlayableVideo[] {
  const seen = new Set<string>();
  return (videos ?? []).flatMap((v) => {
    const p = playable(v);
    if (!p) return [];
    const key = p.kind === "file" ? p.url : `${p.kind}:${p.id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [p];
  });
}

/**
 * Where to ask whether a video can be shown on another site: YouTube's and Vimeo's public
 * oEmbed lookups, which refuse a private, removed or embed-barred video. A file is asked
 * directly.
 */
export function videoLookup(video: PlayableVideo): string {
  if (video.kind === "youtube") return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${video.id}`)}`;
  if (video.kind === "vimeo") return `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${video.id}${video.hash ? `/${video.hash}` : ""}`)}`;
  return video.url;
}

/** Vimeo's still at a size fit for a video tile; oEmbed gives a thumbnail-sized one. */
export function vimeoStill(thumbnail: string | null | undefined): string | null {
  if (!thumbnail?.startsWith("https://")) return null;
  return thumbnail.replace(/_\d+(?:x\d+)?(?=[?.]|$)/, "_960x540");
}
