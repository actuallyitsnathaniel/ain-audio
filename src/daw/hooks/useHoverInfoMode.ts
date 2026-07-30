import { useSyncExternalStore } from "react";
import {
  getHoverInfoMode,
  setHoverInfoMode,
  subscribeHoverInfoMode,
  type HoverInfoMode,
} from "../hover-info";

export function useHoverInfoMode(): [HoverInfoMode, (m: HoverInfoMode) => void] {
  const mode = useSyncExternalStore(
    subscribeHoverInfoMode,
    getHoverInfoMode,
    getHoverInfoMode,
  );
  return [mode, setHoverInfoMode];
}
