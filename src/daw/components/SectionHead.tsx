export function SectionHead({
  num,
  title,
  color,
  sub,
}: {
  num: string;
  title: string;
  color?: string;
  sub?: string;
}) {
  return (
    <div className="mb-5.5 flex items-baseline gap-3">
      <span
        className="anchor-dot size-2.5 flex-none self-center rounded-xs"
        style={{ background: color || "var(--accent)", color: color || "var(--accent)" }}
      />
      <span className="font-mono text-[11px] tracking-[0.12em] whitespace-nowrap text-faint">{num}</span>
      <h2 className="m-0 text-[26px] leading-none font-bold tracking-[-0.01em] whitespace-nowrap text-daw-text">{title}</h2>
      {sub ? <span className="font-mono text-[11px] whitespace-nowrap text-dim">{sub}</span> : null}
      <span className="h-px flex-1 self-center bg-line" />
    </div>
  );
}
