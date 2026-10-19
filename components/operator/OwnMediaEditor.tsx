"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Notice from "@/components/auth/Notice";
import Button from "@/components/ui/Button";
import type { PhotoChoiceState } from "@/app/operator/your-page/actions";

const IDLE: PhotoChoiceState = { status: "idle" };

export type OwnMediaProps = {
  logo: { url: string | null; own: boolean; light: boolean };
  hero: string | null;
  gallery: string[];
  trips: { id: string; title: string; photos: number; own: string[] }[];
  videos: { url: string; title: string | null }[];
  needs: string[];
};

type Actions = {
  addVideo: (prev: PhotoChoiceState, form: FormData) => Promise<PhotoChoiceState>;
  remove: (url: string) => Promise<PhotoChoiceState>;
  lead: (url: string) => Promise<PhotoChoiceState>;
};

/**
 * Shrinks a photo in the browser before it is sent: a phone photo is often 4000 pixels
 * wide and several megabytes, more than the page needs and more than a hosting platform
 * accepts in one request. A file the browser cannot read is sent as it is, for the server
 * to judge.
 */
async function shrink(file: File, kind: "photo" | "logo"): Promise<Blob> {
  const longest = kind === "logo" ? 800 : 2400;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 3 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), kind === "logo" ? "image/png" : "image/jpeg", 0.88));
  } catch {
    return file;
  }
}

/**
 * The operator's own photos, logo and videos for their page. They show straight away,
 * ahead of what was found on the website, and can be taken off again at any time.
 */
export default function OwnMediaEditor({ media, actions }: { media: OwnMediaProps; actions: Actions }) {
  const router = useRouter();
  const [target, setTarget] = useState("page");
  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<PhotoChoiceState>(IDLE);
  const [pending, startTransition] = useTransition();
  const [videoState, videoAction, videoPending] = useActionState(actions.addVideo, IDLE);
  const photoInput = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | null, kind: "photo" | "logo") {
    if (!files?.length) return;
    const list = [...files];
    const failures: string[] = [];
    let added = 0;
    for (const [i, file] of list.entries()) {
      setProgress(list.length > 1 ? `Uploading ${i + 1} of ${list.length}` : "Uploading");
      const body = new FormData();
      body.set("file", await shrink(file, kind), file.name);
      body.set("kind", kind);
      body.set("target", target);
      try {
        const res = await fetch("/operator/your-page/upload", { method: "POST", body });
        const result = (await res.json()) as { ok: boolean; message: string };
        if (result.ok) added += 1; else failures.push(`${file.name}: ${result.message}`);
      } catch {
        failures.push(`${file.name}: the upload did not finish. Check your connection and try again.`);
      }
    }
    setProgress(null);
    if (photoInput.current) photoInput.current.value = "";
    if (logoInput.current) logoInput.current.value = "";
    setNotice(failures.length
      ? { status: "error", message: `${added ? `${added} added. ` : ""}${failures.join(" ")}` }
      : { status: "done", message: kind === "logo" ? "Your logo is on your page." : `${added} ${added === 1 ? "photo" : "photos"} added.` });
    router.refresh();
  }

  const run = (act: (url: string) => Promise<PhotoChoiceState>, url: string) => startTransition(async () => setNotice(await act(url)));
  const busy = Boolean(progress) || pending;

  const tile = (url: string) => (
    <li key={url} className="op-own__tile">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" loading="lazy" className="op-own__img" />
      {media.hero === url ? <span className="op-own__badge">Top of your page</span> : null}
      <span className="op-own__actions">
        {media.hero !== url ? <button type="button" className="op-own__link" disabled={busy} onClick={() => run(actions.lead, url)}>Put at the top</button> : null}
        <button type="button" className="op-own__link" disabled={busy} onClick={() => run(actions.remove, url)}>Remove</button>
      </span>
    </li>
  );
  const tripsWithOwn = media.trips.filter((t) => t.own.length);

  return (
    <div className="op-own">
      {media.needs.length ? (
        <div className="adm-card op-own__needs">
          <span className="ds-body">Your page is missing</span>
          <ul>{media.needs.map((n) => <li key={n} className="ds-body-sm">{n}</li>)}</ul>
        </div>
      ) : null}

      <div className="adm-card op-own__row">
        <span className={media.logo.light ? "op-own__logo op-own__logo--dark" : "op-own__logo"}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {media.logo.url ? <img src={media.logo.url} alt="Your logo" /> : <span className="ds-caption">No logo</span>}
        </span>
        <span className="op-own__say">
          <span className="ds-body">Logo</span>
          <span className="ds-caption" style={{ color: "var(--color-ink-muted)" }}>
            {media.logo.own ? "The one you uploaded." : media.logo.url ? "Found on your website. Upload a sharper one if you have it." : "PNG with a clear background works best."}
          </span>
        </span>
        <span className="op-own__buttons">
          <label className={`op-own__pick${busy ? " is-busy" : ""}`}>
            <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(e) => upload(e.target.files, "logo")} />
            {media.logo.own ? "Replace" : "Upload your logo"}
          </label>
          {media.logo.own && media.logo.url ? <button type="button" className="op-own__link" disabled={busy} onClick={() => run(actions.remove, media.logo.url!)}>Remove</button> : null}
        </span>
      </div>

      <div className="adm-card op-own__block">
        <div className="op-own__row op-own__row--bare">
          <span className="op-own__say">
            <span className="ds-body">Photos</span>
            <span className="ds-caption" style={{ color: "var(--color-ink-muted)" }}>Yours lead, ahead of the ones from your website. Choose several at once.</span>
          </span>
          <span className="op-own__buttons">
            <select className="op-own__select" value={target} onChange={(e) => setTarget(e.target.value)} disabled={busy} aria-label="Where the photos go">
              <option value="page">For your page</option>
              {media.trips.map((t) => <option key={t.id} value={t.id}>For {t.title} ({t.photos} {t.photos === 1 ? "photo" : "photos"})</option>)}
            </select>
            <label className={`op-own__pick op-own__pick--primary${busy ? " is-busy" : ""}`}>
              <input ref={photoInput} type="file" accept="image/*" multiple disabled={busy} onChange={(e) => upload(e.target.files, "photo")} />
              {progress ?? "Add photos"}
            </label>
          </span>
        </div>
        {media.gallery.length ? (
          <>
            <span className="ds-caption op-own__group">On your page</span>
            <ul className="op-own__grid">{media.gallery.map(tile)}</ul>
          </>
        ) : null}
        {tripsWithOwn.map((t) => (
          <div key={t.id}>
            <span className="ds-caption op-own__group">{t.title}</span>
            <ul className="op-own__grid">{t.own.map(tile)}</ul>
          </div>
        ))}
      </div>

      <div className="adm-card op-own__block">
        <span className="op-own__say">
          <span className="ds-body">Videos</span>
          <span className="ds-caption" style={{ color: "var(--color-ink-muted)" }}>A YouTube or Vimeo link, or an .mp4 on your own website.</span>
        </span>
        <form action={videoAction} className="op-own__video-form">
          <input name="url" type="url" required placeholder="https://www.youtube.com/watch?v=..." className="op-own__input" aria-label="Video link" />
          <input name="title" type="text" maxLength={80} placeholder="What it shows (optional)" className="op-own__input" aria-label="What the video shows" />
          <Button type="submit" variant="secondary" magnetic={false} disabled={videoPending}>Add video</Button>
        </form>
        {videoState.status === "error" ? <Notice tone="error">{videoState.message}</Notice> : null}
        {media.videos.length ? (
          <ul className="op-own__videos">
            {media.videos.map((v) => (
              <li key={v.url}>
                <a href={v.url} target="_blank" rel="noreferrer" className="ds-body-sm">{v.title || v.url} ↗</a>
                <button type="button" className="op-own__link" disabled={busy} onClick={() => run(actions.remove, v.url)}>Remove</button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {notice.status === "done" ? <Notice tone="success">{notice.message}</Notice> : null}
      {notice.status === "error" ? <Notice tone="error">{notice.message}</Notice> : null}
    </div>
  );
}
