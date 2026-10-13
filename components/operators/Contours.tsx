/**
 * The dark title block's texture when there is no photo: faint depth contours, drawn the
 * same way for the same seed every time so a page never changes between visits.
 */

function hash(text: string) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Faint depth contours for a hero with no photo, drawn the same way for the same operator every time. */
export default function Contours({ seed }: { seed: string }) {
  let s = hash(seed);
  const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) >>> 0) % 1000) / 1000;
  const lines = Array.from({ length: 9 }, (_, i) => {
    const y = 40 + i * 42 + rnd() * 18;
    const amp = 10 + rnd() * 22;
    const wave = 180 + rnd() * 160;
    let d = `M -20 ${y.toFixed(1)} Q ${(-20 + wave / 2).toFixed(1)} ${(y - amp).toFixed(1)} ${(-20 + wave).toFixed(1)} ${y.toFixed(1)}`;
    for (let x = -20 + wave * 2; x < 1300; x += wave) d += ` T ${x.toFixed(1)} ${y.toFixed(1)}`;
    return d;
  });
  return (
    <svg className="opp-contours" viewBox="0 0 1200 420" preserveAspectRatio="none" aria-hidden="true">
      {lines.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
