// ── USER AUDIO LIBRARY — browser of IndexedDB imports / takes / bounces ──────
// Drop files here (or onto the timeline). Rows stay after clip delete and File →
// New project. Drag a row onto an audio lane or kit sample well (same bufId, no
// second decode). Click auditions through the master bus — not startSources.

import { useEffect, useRef, useState, type DragEvent } from "react";
import { engine, type LibraryEntry } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { useRafLoop } from "../../hooks/useRafLoop";
import { fmtTime } from "../../lab-time";
import { openContextMenu } from "../context-menu-bus";
import { setLibraryDrag, libraryBufIdFromDrag } from "../../library-drag";
import {
  filesFromDataTransfer,
  pickAudioFiles,
  type ImportFile,
} from "../../file-source";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function shortPath(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  if (parts.length <= 2) return p;
  return "…/" + parts.slice(-2).join("/");
}

const KIND: Record<LibraryEntry["kind"], string> = {
  drop: "file",
  take: "take",
  bounce: "bounce",
};

export function LibraryPanel({
  onReveal,
  onClose,
}: {
  onReveal: (hit: {
    trackId: string;
    clipId: string;
    startBeat: number;
    trackIndex: number;
  }) => void;
  onClose?: () => void;
}) {
  useEngine(["arrange"]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const overRef = useRef(false);
  const dropLock = useRef(false);

  const items = engine.listLibrary().filter((it) => {
    if (!q.trim()) return true;
    const hay = (it.name + " " + (it.sourcePath ?? "")).toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });
  const persistFailed = engine.libraryPersistFailed();
  const previewing = engine.libraryPreviewing();
  const storage = engine.libraryStorage();

  const importPicked = async (picked: ImportFile[]) => {
    await engine.importAudioBatch(picked);
  };

  const menuFor = (it: LibraryEntry, x: number, y: number) => {
    openContextMenu({
      x,
      y,
      title: it.sourcePath || it.name,
      items: [
        {
          label: previewing === it.bufId ? "stop preview" : "preview",
          onClick: () => {
            if (previewing === it.bufId) engine.stopLibraryPreview();
            else engine.previewLibrary(it.bufId);
          },
          disabled: !engine.hasImport(it.bufId),
        },
        {
          label: "reveal in project",
          disabled: !it.used,
          onClick: () => {
            const hit = engine.revealLibraryInProject(it.bufId);
            if (hit) onReveal(hit);
          },
        },
        {
          label: "re-index original",
          disabled: !it.hasSourceHandle,
          onClick: () => {
            void engine.reindexLibraryFile(it.bufId).then((ok) => {
              if (!ok)
                window.alert(
                  "Couldn't read the original file — it may have moved. Use Replace file…",
                );
            });
          },
        },
        {
          label: "replace file…",
          onClick: () => {
            void pickAudioFiles(false).then((got) => {
              const one = got[0];
              if (one) void engine.replaceLibraryFile(it.bufId, one.file, one);
            });
          },
        },
        { label: "rename", onClick: () => setEditing(it.bufId) },
        { separator: true },
        {
          label: "delete from library",
          danger: true,
          onClick: () => {
            const msg = it.used
              ? "This file is used on the timeline or a kit. Delete it anyway? Clips that reference it will go silent."
              : "Remove this file from the library? This can't be undone.";
            if (!window.confirm(msg)) return;
            void engine.deleteLibraryItem(it.bufId);
          },
        },
      ],
    });
  };

  const armDrop = (e: DragEvent) => {
    // Must preventDefault on the actual hover target — draggable rows swallow
    // Finder drops otherwise. Safari often reports empty types until drop.
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = "copy";
    } catch {
      /* some browsers */
    }
    if (!overRef.current) {
      overRef.current = true;
      setOver(true);
    }
  };

  const disarmDrop = () => {
    overRef.current = false;
    setOver(false);
  };

  const onDropFiles = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    disarmDrop();
    if (libraryBufIdFromDrag(e.dataTransfer)) return;
    if (dropLock.current) return;
    dropLock.current = true;
    void filesFromDataTransfer(e.dataTransfer)
      .then((got) => importPicked(got))
      .finally(() => {
        dropLock.current = false;
      });
  };

  useEffect(() => {
    const clear = () => disarmDrop();
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, []);

  return (
    <div
      className="relative flex h-full min-h-0 w-56 shrink-0 flex-col border-r border-line bg-[#0e0e12]"
      onDragEnter={armDrop}
      onDragOver={armDrop}
      onDragLeave={(e) => {
        // Overlay mount / child enter fires leave with a stale relatedTarget.
        const under = document.elementFromPoint(e.clientX, e.clientY);
        if (under && e.currentTarget.contains(under)) return;
        disarmDrop();
      }}
      onDrop={onDropFiles}
    >
      <div className="flex h-7.5 shrink-0 items-center gap-1.5 border-b border-line px-2">
        <span className="font-mono text-[9px] tracking-widest text-faint">
          LIBRARY
        </span>
        <button
          type="button"
          className="ml-auto rounded-[3px] border border-line px-1.5 py-px font-mono text-[8px] text-faint hover:border-accent hover:text-accent"
          onClick={() => void pickAudioFiles(true).then(importPicked)}
          title="Import audio into the library"
        >
          +
        </button>
        {onClose && (
          <button
            type="button"
            className="rounded-[3px] border border-line px-1.5 py-px font-mono text-[8px] text-faint hover:border-accent hover:text-accent"
            onClick={onClose}
            title="Hide library"
          >
            ×
          </button>
        )}
      </div>

      <div className="shrink-0 border-b border-line px-1.5 py-1">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search"
          className="h-6 w-full rounded-[3px] border border-line bg-[#0c0c10] px-1.5 font-mono text-[10px] text-daw-text placeholder:text-faint focus:border-accent focus:outline-none"
        />
      </div>

      <div
        className={
          "min-h-0 flex-1 overflow-y-auto " +
          (over ? "bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]" : "")
        }
        onDragOver={armDrop}
        onDrop={onDropFiles}
      >
        {items.length === 0 ? (
          <button
            type="button"
            onClick={() => void pickAudioFiles(true).then(importPicked)}
            onDragOver={armDrop}
            onDrop={onDropFiles}
            className="flex size-full min-h-28 flex-col items-center justify-center gap-1.5 px-3 text-center"
          >
            <span className="font-mono text-[10px] leading-snug text-dim">
              {q.trim()
                ? "no matches"
                : "Drop files or folders here or onto the timeline"}
            </span>
            {!q.trim() && (
              <span className="font-mono text-[8.5px] leading-snug text-faint">
                click to pick · wav / mp3 / m4a / ogg
              </span>
            )}
          </button>
        ) : (
          <ul className="flex flex-col py-0.5">
            {items.map((it) => (
              <LibraryRow
                key={it.bufId}
                it={it}
                previewing={previewing === it.bufId}
                editing={editing === it.bufId}
                onEditDone={() => setEditing(null)}
                onPreview={() => engine.previewLibrary(it.bufId)}
                onPlace={() => {
                  const placed = engine.placeLibraryClip(it.bufId);
                  if (placed) {
                    const hit = engine.libraryUsages(it.bufId)[0];
                    if (hit) onReveal(hit);
                  }
                }}
                onMenu={(x, y) => menuFor(it, x, y)}
                onFileDragOver={armDrop}
                onFileDrop={onDropFiles}
              />
            ))}
          </ul>
        )}
      </div>

      {over && (
        <div
          className="absolute inset-0 z-10 border border-accent bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
          onDragOver={armDrop}
          onDrop={onDropFiles}
        />
      )}

      <p className="shrink-0 border-t border-line px-2 py-1.5 font-mono text-[8px] leading-snug text-faint">
        {persistFailed
          ? "Couldn't save to this browser (private mode or quota). Files here vanish on reload."
          : storage && storage.quota > 0
            ? `${fmtBytes(storage.used)} of ${fmtBytes(storage.quota)} used` +
              (storage.persisted ? " · kept by this browser" : "") +
              ". Clearing site data deletes the library."
            : "Stored in this browser. Clearing site data deletes the library."}
      </p>
    </div>
  );
}

function LibraryRow({
  it,
  previewing,
  editing,
  onEditDone,
  onPreview,
  onPlace,
  onMenu,
  onFileDragOver,
  onFileDrop,
}: {
  it: LibraryEntry;
  previewing: boolean;
  editing: boolean;
  onEditDone: () => void;
  onPreview: () => void;
  onPlace: () => void;
  onMenu: (x: number, y: number) => void;
  onFileDragOver: (e: DragEvent) => void;
  onFileDrop: (e: DragEvent) => void;
}) {
  const commitRename = (value: string) => {
    const next = value.trim();
    if (next && next !== it.name) void engine.renameLibraryItem(it.bufId, next);
    onEditDone();
  };

  return (
    <li
      draggable={!editing && engine.hasImport(it.bufId)}
      onDragStart={(e) => {
        engine.stopLibraryPreview();
        setLibraryDrag(e.dataTransfer, it.bufId);
      }}
      onDragOver={onFileDragOver}
      onDrop={onFileDrop}
      onClick={() => {
        if (!editing) onPreview();
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        onPlace();
      }}
      onContextMenu={(e) => {
        if (e.shiftKey) return;
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      className={
        "flex cursor-grab items-center gap-1.5 border-b border-line/60 px-1.5 py-1 active:cursor-grabbing " +
        (previewing
          ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]"
          : "hover:bg-panel2")
      }
      title={
        [
          it.sourcePath && it.sourcePath !== it.name ? it.sourcePath : it.name,
          it.persistOk
            ? "click preview · click again or ⏹ to stop · drag onto timeline"
            : "not saved (gone on reload)",
        ].join(" — ")
      }
    >
      <button
        type="button"
        className={
          "flex h-7 w-5 shrink-0 items-center justify-center rounded-xs font-mono text-[8px] " +
          (previewing
            ? "border border-accent text-accent"
            : "border border-line text-faint hover:border-accent hover:text-accent")
        }
        title={previewing ? "stop preview" : "preview"}
        onClick={(e) => {
          e.stopPropagation();
          if (previewing) engine.stopLibraryPreview();
          else onPreview();
        }}
      >
        {previewing ? "■" : "▶"}
      </button>
      <LibWave bufId={it.bufId} previewing={previewing} />
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            defaultValue={it.name}
            onBlur={(e) => commitRename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") onEditDone();
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-xs border border-accent bg-panel2 px-0.5 font-mono text-[9px] text-daw-text focus:outline-none"
          />
        ) : (
          <div className="truncate font-mono text-[9.5px] text-daw-text">
            {it.name}
          </div>
        )}
        <div className="flex min-w-0 items-center gap-1 font-mono text-[8px] text-faint">
          <span>{KIND[it.kind]}</span>
          <span aria-hidden>·</span>
          <span>
            {it.seconds > 0 ? fmtTime(it.seconds) : engine.hasImport(it.bufId) ? "…" : "broken"}
          </span>
          {it.sourcePath && it.sourcePath !== it.name && (
            <span className="min-w-0 truncate" title={it.sourcePath}>
              {shortPath(it.sourcePath)}
            </span>
          )}
          {it.used && <span className="shrink-0 text-accent/80">in use</span>}
          {!it.persistOk && <span className="shrink-0 text-[#e98c79]">unsaved</span>}
        </div>
      </div>
    </li>
  );
}

function LibWave({ bufId, previewing }: { bufId: string; previewing: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useRafLoop(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (w < 2 || h < 2) return;
    if (cv.width !== Math.floor(w * dpr) || cv.height !== Math.floor(h * dpr)) {
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
    }
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const accent =
      getComputedStyle(cv).getPropertyValue("--accent").trim() || "#54adbd";
    const peaks = engine.importPeaks(bufId, Math.max(12, Math.floor(w)));
    if (!peaks) {
      g.fillStyle = "#2a2a32";
      g.fillRect(0, h / 2 - 0.5, w, 1);
      return;
    }
    const mid = h / 2;
    g.fillStyle = accent;
    const bw = w / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const ph = Math.max(1, peaks[i]! * (h - 2));
      g.fillRect(i * bw, mid - ph / 2, Math.max(1, bw - 0.35), ph);
    }
    const pos = previewing ? engine.libraryPreviewPos(bufId) : null;
    if (pos != null) {
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.fillRect(Math.floor(pos * w), 0, 1, h);
    }
  });
  return (
    <canvas
      ref={ref}
      className="pointer-events-none h-7 w-9 shrink-0 rounded-xs bg-[#0c0c10]"
    />
  );
}
