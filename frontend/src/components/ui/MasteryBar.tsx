/** Mastery is encoded in colour as well as length, so the weak rows read at a glance. */
export function MasteryBar({ mastery }: { mastery: number }) {
  const pct = Math.round(mastery * 100);
  const tone =
    mastery >= 0.75 ? { bar: "bg-good", track: "bg-good-soft" }
    : mastery >= 0.4 ? { bar: "bg-warn", track: "bg-warn-soft" }
    : { bar: "bg-crit", track: "bg-crit-soft" };

  return (
    <div className={`h-2 w-full overflow-hidden rounded-full ${tone.track}`}>
      <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.max(pct, 3)}%` }} />
    </div>
  );
}
