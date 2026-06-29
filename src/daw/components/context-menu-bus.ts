// Shared entry point for the app's custom right-click menu. Surfaces (piano roll,
// step grid, channel rows, …) build their own item list on contextmenu and call
// openContextMenu(); the single <ContextMenu/> host (mounted in DawShell) renders
// it at the cursor. Kept separate from the host component so this file exports no
// components (react-refresh rule), mirroring midi-gate-bus.

export interface MenuItem {
  label?: string; // omitted for separator rows
  onClick?: () => void;
  danger?: boolean; // red styling (destructive)
  disabled?: boolean;
  separator?: boolean; // a divider row; label/onClick ignored
  hint?: string; // small right-aligned shortcut/affordance text
}

export interface MenuRequest {
  x: number;
  y: number;
  title?: string; // small header (e.g. "note" / "channel: bass")
  items: MenuItem[];
}

let open: ((req: MenuRequest) => void) | null = null;
export const setContextMenuHost = (fn: ((req: MenuRequest) => void) | null) => {
  open = fn;
};

// Open the custom menu. Returns false if no host is mounted (caller may then let
// the native menu through), true if handled.
export function openContextMenu(req: MenuRequest): boolean {
  if (!open) return false;
  open(req);
  return true;
}
