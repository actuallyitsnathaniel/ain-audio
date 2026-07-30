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
  /**
   * Element that opened the menu. Re-invoking openContextMenu with the same
   * anchor toggles it closed (used by "+ device" so a second click dismisses
   * cleanly instead of dismiss-then-reopen).
   */
  anchor?: HTMLElement | null;
}

type Host = {
  open: (req: MenuRequest) => void;
  close: () => void;
  isOpen: () => boolean;
  getAnchor: () => HTMLElement | null;
};

let host: Host | null = null;

export const setContextMenuHost = (h: Host | null) => {
  host = h;
};

/** Close the open menu, if any. */
export function closeContextMenu(): void {
  host?.close();
}

// Open the custom menu. Returns false if no host is mounted or the call toggled
// an already-open menu closed; true if the menu was shown.
export function openContextMenu(req: MenuRequest): boolean {
  if (!host) return false;
  if (host.isOpen() && req.anchor && host.getAnchor() === req.anchor) {
    host.close();
    return false;
  }
  host.open(req);
  return true;
}
