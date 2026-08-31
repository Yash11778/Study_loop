export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 text-muted">
      <span className="flex gap-1.5" aria-hidden>
        <span className="dot h-2 w-2 rounded-full bg-accent" />
        <span className="dot h-2 w-2 rounded-full bg-accent" />
        <span className="dot h-2 w-2 rounded-full bg-accent" />
      </span>
      <p className="text-sm">{label}</p>
    </div>
  );
}
