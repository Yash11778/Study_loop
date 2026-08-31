type Props = { tone?: "info" | "error"; title?: string; children: React.ReactNode };

/** Errors say what went wrong; the caller supplies what to do about it. */
export function Callout({ tone = "info", title, children }: Props) {
  const styles =
    tone === "error"
      ? "border-crit/30 bg-crit-soft text-crit"
      : "border-accent/25 bg-accent-soft text-accent";

  return (
    <div role={tone === "error" ? "alert" : undefined} className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>
      {title && <p className="font-display font-bold">{title}</p>}
      <p className="text-ink-soft">{children}</p>
    </div>
  );
}
