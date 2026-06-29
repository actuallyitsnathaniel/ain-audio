import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

const knobPolar = (cx: number, cy: number, r: number, aDeg: number): [number, number] => {
  const a = ((aDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};

function knobArc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  if (Math.abs(a1 - a0) < 0.5) return "";
  const [x0, y0] = knobPolar(cx, cy, r, a0);
  const [x1, y1] = knobPolar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

// Minimal dial. Drag vertically; double-click resets; bipolar draws arc from center.
export function Knob({
  value,
  onChange,
  label,
  min = 0,
  max = 1,
  defaultValue = null,
  size = 52,
  fmt = null,
  bipolar = false,
  disabled = false,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  min?: number;
  max?: number;
  defaultValue?: number | null;
  size?: number;
  fmt?: ((v: number) => string) | null;
  bipolar?: boolean;
  disabled?: boolean;
}) {
  const norm = (value - min) / (max - min);
  const drag = useRef<{ y: number; norm: number } | null>(null);
  // click the readout to type an exact value (edits in the knob's own [min,max] domain)
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const beginEdit = () => {
    if (disabled) return;
    setDraft(String(Math.round(value * 1000) / 1000));
    setEditing(true);
  };
  const commitEdit = () => {
    const parsed = parseFloat(draft);
    if (!Number.isNaN(parsed)) onChange(Math.min(max, Math.max(min, parsed)));
    setEditing(false);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, norm };
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const dy = (drag.current.y - e.clientY) / (e.shiftKey ? 600 : 150);
    const n = Math.min(1, Math.max(0, drag.current.norm + dy));
    onChange(min + n * (max - min));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onDoubleClick = () => {
    if (defaultValue !== null) onChange(defaultValue);
  };

  const a0 = -135,
    a1 = 135;
  const angle = a0 + norm * (a1 - a0);
  const valArc = bipolar
    ? knobArc(32, 32, 26, Math.min(0, angle), Math.max(0, angle))
    : knobArc(32, 32, 26, a0, angle);
  const [px, py] = knobPolar(32, 32, 19, angle);

  return (
    <div
      className={"flex flex-col items-center gap-[2px] " + (disabled ? "opacity-[0.38]" : "")}
      style={{ width: size + 16 }}
    >
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        style={{
          touchAction: "none",
          cursor: disabled ? "default" : "ns-resize",
          display: "block",
          margin: "0 auto",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <path d={knobArc(32, 32, 26, a0, a1)} stroke="var(--line2)" strokeWidth="3" fill="none" strokeLinecap="round" />
        {valArc ? <path d={valArc} stroke="var(--accent)" strokeWidth="3" fill="none" strokeLinecap="round" /> : null}
        <circle cx="32" cy="32" r="17" fill="var(--panel2)" stroke="var(--line2)" strokeWidth="1" />
        <line x1="32" y1="32" x2={px} y2={py} stroke="var(--color-daw-text, #d8d8dc)" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <div className="text-center font-mono text-[10px] tracking-[0.07em] whitespace-nowrap text-dim">{label}</div>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            else if (e.key === "Escape") setEditing(false);
          }}
          className="w-[52px] rounded-[2px] border border-accent bg-inset text-center font-mono text-[10.5px] text-accent outline-none"
          aria-label={label + " value"}
        />
      ) : (
        <div
          className={"text-center font-mono text-[10.5px] whitespace-nowrap text-accent " + (disabled ? "" : "cursor-text")}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={beginEdit}
          title="click to type a value"
        >
          {fmt ? fmt(value) : Math.round(value * 1000) / 1000}
        </div>
      )}
    </div>
  );
}
