"use client";

import { useState } from "react";
import type { PlayableVideo } from "@/lib/services/operators/videos";

/**
 * The operator's own videos. Each is a still with a play button until pressed, so the
 * page loads no player until someone wants to watch. A video file the operator hosts
 * shows its own opening frame as the still, and one their site will not send leaves the
 * grid instead of sitting there black; with none left, so does the section.
 */
export default function VideoGrid({ videos: all, name, heading }: { videos: PlayableVideo[]; name: string; heading: string }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const videos = all.filter((v) => !failed.has(v.embed));
  const fail = (v: PlayableVideo) => setFailed((prev) => new Set(prev).add(v.embed));
  if (!videos.length) return null;
  const grid = (
    <ul className={videos.length === 1 ? "opp-videos opp-videos--one" : "opp-videos"}>
      {videos.map((v) => {
        const label = v.title ?? `${name} video`;
        return (
          <li key={v.embed} className="opp-video">
            {playing === v.embed ? (
              v.kind === "file" ? (
                <video className="opp-video__frame" src={v.url} controls autoPlay playsInline aria-label={label} onError={() => fail(v)} />
              ) : (
                <iframe
                  className="opp-video__frame"
                  src={v.embed}
                  title={label}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                />
              )
            ) : (
              <button
                type="button"
                className="opp-video__still"
                style={v.poster ? { backgroundImage: `url("${v.poster}")` } : undefined}
                onClick={() => setPlaying(v.embed)}
                aria-label={`Play ${label}`}
              >
                {v.kind === "file" ? (
                  // Only the first moments are fetched, to show a frame; the film loads when pressed.
                  <video className="opp-video__preview" src={`${v.url}#t=0.5`} preload="metadata" muted playsInline tabIndex={-1} aria-hidden onError={() => fail(v)} />
                ) : null}
                <span className="opp-video__play" aria-hidden>
                  <svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
                </span>
              </button>
            )}
            {v.title ? <span className="opp-video__title">{v.title}</span> : null}
          </li>
        );
      })}
    </ul>
  );
  return (
    <section className="opp-section" aria-labelledby="opp-watch">
      <header className="opp-section__head"><h2 id="opp-watch" className="ds-headline">{heading}</h2></header>
      {grid}
    </section>
  );
}
