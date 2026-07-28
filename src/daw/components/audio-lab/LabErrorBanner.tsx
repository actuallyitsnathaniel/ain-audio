import { useEngine } from "../../hooks/useEngine";

export function LabErrorBanner() {
  const eng = useEngine(["state"]);
  if (!eng.error) return null;
  return (
    <div className="rounded-[3px] border border-[color-mix(in_srgb,#E0784F_38%,transparent)] bg-[color-mix(in_srgb,#E0784F_8%,transparent)] px-[13px] py-[9px] font-mono text-[11.5px] tracking-[0.02em] text-[#E0784F]">
      ⚠ {eng.error}
    </div>
  );
}
