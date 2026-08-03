// PWA File Handling — when an installed app is opened via a .ain association,
// Chromium delivers the file(s) through window.launchQueue.

import { useEffect } from "react";
import { engine } from "../engine";
import { AIN_EXT } from "../ain-pack";

type LaunchFileHandle = FileSystemFileHandle;
type LaunchParams = { files?: LaunchFileHandle[] };
type LaunchQueue = {
  setConsumer: (cb: (params: LaunchParams) => void | Promise<void>) => void;
};

export function useAinFileLaunch() {
  useEffect(() => {
    const lq = (window as Window & { launchQueue?: LaunchQueue }).launchQueue;
    if (!lq?.setConsumer) return;

    lq.setConsumer(async (params) => {
      const handles = params.files ?? [];
      for (const handle of handles) {
        try {
          const file = await handle.getFile();
          if (!file.name.toLowerCase().endsWith(AIN_EXT)) continue;
          await engine.importAin(file);
          return;
        } catch (e) {
          console.warn("[ain] launch open failed", e);
        }
      }
    });
  }, []);
}
