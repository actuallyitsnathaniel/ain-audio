// ── USER AUDIO LIBRARY — browser of IndexedDB imports / takes / bounces ──────
// Drop files here (or onto the timeline). Rows stay after clip delete and File →
// New project. Drag a row onto an audio lane or kit sample well (same bufId, no
// second decode). Click auditions through the master bus — not startSources.
// Selection: click · ⇧ range · ⌘ toggle · ⌘A · arrows · ⌫ delete · drag the set.

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
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

function rangeIds(ids: string[], from: string | null, to: string): string[] {
  if (!from) return [to];
  const a = ids.indexOf(from);
  const b = ids.indexOf(to);
  if (a < 0 || b < 0) return [to];
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return ids.slice(lo, hi + 1);
}

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
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const overRef = useRef(false);
  const dropLock = useRef(false);
  const anchorRef = useRef<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeBuf = useRef({ s: "", tid: 0 as ReturnType<typeof setTimeout> | 0 });

  const items = engine.listLibrary().filter((it) => {
    if (!q.trim()) return true;
    const hay = (it.name + " " + (it.sourcePath ?? "")).toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });
  const ids = items.map((it) => it.bufId);
  const selected = ids.filter((id) => sel.has(id));
  const persistFailed = engine.libraryPersistFailed();
  const previewing = engine.libraryPreviewing();
  const storage = engine.libraryStorage();

  const importPicked = async (picked: ImportFile[]) => {
    const got = await engine.importAudioBatch(picked);
    if (!got.length) return;
    setSel(new Set(got));
    setFocusId(got[got.length - 1]!);
    anchorRef.current = got[0]!;
  };

  const audition = (bufId: string) => {
    if (!engine.hasImport(bufId)) return;
    engine.previewLibrary(bufId);
  };

  const selectOnly = (bufId: string, play = true) => {
    setSel(new Set([bufId]));
    setFocusId(bufId);
    anchorRef.current = bufId;
    if (play) audition(bufId);
  };

  const applySel = (next: string[], focus: string, play = false) => {
    setSel(new Set(next));
    setFocusId(focus);
    if (play) audition(focus);
  };

  const onRowClick = (bufId: string, e: MouseEvent) => {
    if (editing) return;
    const meta = e.metaKey || e.ctrlKey;
    if (e.shiftKey) {
      applySel(rangeIds(ids, anchorRef.current ?? focusId, bufId), bufId, true);
      return;
    }
    if (meta) {
      const next = new Set(sel);
      const adding = !next.has(bufId);
      if (adding) next.add(bufId);
      else next.delete(bufId);
      setSel(next);
      setFocusId(bufId);
      anchorRef.current = bufId;
      if (adding) audition(bufId);
      return;
    }
    selectOnly(bufId, true);
  };

  const placeIds = (bufIds: string[], acrossTracks = false) => {
    const ordered = ids.filter((id) => bufIds.includes(id) && engine.hasImport(id));
    if (!ordered.length) return;
    const placed = engine.placeLibraryClips(ordered, { acrossTracks });
    const hit = placed[0]
      ? engine.libraryUsages(ordered[0]!)[0]
      : null;
    if (hit) onReveal(hit);
  };

  const deleteIds = (bufIds: string[]) => {
    if (!bufIds.length) return;
    const rows = items.filter((it) => bufIds.includes(it.bufId));
    const used = rows.filter((it) => it.used).length;
    const msg =
      bufIds.length === 1
        ? used
          ? "This file is used on the timeline or a kit. Delete it anyway? Clips that reference it will go silent."
          : "Remove this file from the library? This can't be undone."
        : used
          ? `Remove ${bufIds.length} files? ${used} ${used === 1 ? "is" : "are"} used on the timeline or a kit — those clips will go silent.`
          : `Remove ${bufIds.length} files from the library? This can't be undone.`;
    if (!window.confirm(msg)) return;
    void engine.deleteLibraryItems(bufIds);
    setSel(new Set());
    setFocusId(null);
    anchorRef.current = null;
  };

  const menuFor = (clicked: LibraryEntry, x: number, y: number) => {
    const targets = selected.includes(clicked.bufId)
      ? selected
      : [clicked.bufId];
    if (!selected.includes(clicked.bufId)) {
      setSel(new Set([clicked.bufId]));
      setFocusId(clicked.bufId);
      anchorRef.current = clicked.bufId;
    }
    const many = targets.length > 1;
    const primary =
      items.find((it) => it.bufId === (focusId && targets.includes(focusId) ? focusId : targets[0])) ??
      clicked;
    const allHaveHandle = targets.every(
      (id) => items.find((it) => it.bufId === id)?.hasSourceHandle,
    );
    openContextMenu({
      x,
      y,
      title: many ? `${targets.length} items` : primary.sourcePath || primary.name,
      items: [
        {
          label: previewing === primary.bufId ? "stop preview" : "preview",
          hint: "↵",
          onClick: () => {
            if (previewing === primary.bufId) engine.stopLibraryPreview();
            else engine.previewLibrary(primary.bufId);
          },
          disabled: !engine.hasImport(primary.bufId),
        },
        {
          label: "place on timeline",
          hint: "dbl-click",
          onClick: () => placeIds(targets),
        },
        {
          label: "place on tracks",
          hint: "⌘↵",
          disabled: !many,
          onClick: () => placeIds(targets, true),
        },
        {
          label: "reveal in project",
          disabled: !primary.used,
          onClick: () => {
            const hit = engine.revealLibraryInProject(primary.bufId);
            if (hit) onReveal(hit);
          },
        },
        {
          label: "re-index original",
          disabled: !allHaveHandle,
          onClick: () => {
            void Promise.all(
              targets.map((id) => engine.reindexLibraryFile(id)),
            ).then((oks) => {
              if (oks.some((ok) => !ok))
                window.alert(
                  "Couldn't read an original file — it may have moved. Use Replace file…",
                );
            });
          },
        },
        {
          label: "replace file…",
          disabled: many,
          onClick: () => {
            void pickAudioFiles(false).then((got) => {
              const one = got[0];
              if (one)
                void engine.replaceLibraryFile(primary.bufId, one.file, one);
            });
          },
        },
        {
          label: "rename",
          hint: "F2",
          disabled: many,
          onClick: () => setEditing(primary.bufId),
        },
        { separator: true },
        {
          label: many ? `delete ${targets.length} from library` : "delete from library",
          hint: "⌫",
          danger: true,
          onClick: () => deleteIds(targets),
        },
      ],
    });
  };

  const armDrop = (e: DragEvent) => {
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

  const scrollFocus = (bufId: string) => {
    const el = listRef.current?.querySelector(`[data-lib-id="${bufId}"]`);
    if (el instanceof HTMLElement)
      el.scrollIntoView({ block: "nearest" });
  };

  const onLibKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const meta = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    if (meta && key === "a") {
      e.preventDefault();
      e.stopPropagation();
      setSel(new Set(ids));
      if (ids.length) {
        setFocusId(ids[ids.length - 1]!);
        anchorRef.current = ids[0]!;
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (editing) {
        setEditing(null);
        return;
      }
      engine.stopLibraryPreview();
      setSel(new Set());
      setFocusId(null);
      anchorRef.current = null;
      return;
    }
    if (e.key === "F2" && selected.length === 1) {
      e.preventDefault();
      e.stopPropagation();
      setEditing(selected[0]!);
      return;
    }
    if (meta && key === "v") {
      e.preventDefault();
      e.stopPropagation();
      placeIds(selected.length ? selected : focusId ? [focusId] : [], true);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (e.metaKey || e.ctrlKey) {
        placeIds(selected.length ? selected : focusId ? [focusId] : [], true);
        return;
      }
      const id = focusId ?? selected[0];
      if (!id) return;
      if (previewing === id) engine.stopLibraryPreview();
      else audition(id);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      if (selected.length) deleteIds(selected);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End" || e.key === "PageDown" || e.key === "PageUp") {
      if (!ids.length) return;
      e.preventDefault();
      e.stopPropagation();
      const cur = focusId && ids.includes(focusId) ? ids.indexOf(focusId) : 0;
      let next = cur;
      if (e.key === "ArrowDown") next = Math.min(ids.length - 1, cur + 1);
      else if (e.key === "ArrowUp") next = Math.max(0, cur - 1);
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = ids.length - 1;
      else if (e.key === "PageDown") next = Math.min(ids.length - 1, cur + 8);
      else if (e.key === "PageUp") next = Math.max(0, cur - 8);
      const id = ids[next]!;
      if (e.shiftKey) {
        const from = anchorRef.current ?? ids[cur]!;
        applySel(rangeIds(ids, from, id), id, true);
      } else {
        selectOnly(id, true);
      }
      scrollFocus(id);
      return;
    }
    if (
      !meta &&
      !e.altKey &&
      e.key.length === 1 &&
      e.key !== " " &&
      !e.ctrlKey
    ) {
      window.clearTimeout(typeBuf.current.tid);
      typeBuf.current.s += e.key.toLowerCase();
      const needle = typeBuf.current.s;
      typeBuf.current.tid = window.setTimeout(() => {
        typeBuf.current.s = "";
      }, 700);
      const match =
        items.find((it) => it.name.toLowerCase().startsWith(needle)) ??
        items.find((it) => it.name.toLowerCase().includes(needle));
      if (!match) return;
      e.preventDefault();
      e.stopPropagation();
      selectOnly(match.bufId, true);
      scrollFocus(match.bufId);
    }
  };

  useEffect(() => {
    const clear = () => disarmDrop();
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, []);

  return (
    <div
      ref={panelRef}
      data-library-panel
      tabIndex={0}
      className="relative flex h-full min-h-0 w-56 shrink-0 flex-col border-r border-line bg-[#0e0e12] focus:outline-none"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("input")) return;
        panelRef.current?.focus();
      }}
      onKeyDown={onLibKey}
      onDragEnter={armDrop}
      onDragOver={armDrop}
      onDragLeave={(e) => {
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
        {selected.length > 0 && (
          <span className="min-w-0 truncate font-mono text-[8px] text-accent">
            {selected.length} sel
          </span>
        )}
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
        ref={listRef}
        className={
          "min-h-0 flex-1 overflow-y-auto " +
          (over ? "bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]" : "")
        }
        onDragOver={armDrop}
        onDrop={onDropFiles}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) {
            setSel(new Set());
            setFocusId(null);
            anchorRef.current = null;
            engine.stopLibraryPreview();
          }
        }}
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
                click to pick · ⇧/⌘ select · wav / mp3 / m4a / ogg
              </span>
            )}
          </button>
        ) : (
          <ul
            role="listbox"
            aria-label="User audio library"
            aria-multiselectable="true"
            className="flex flex-col py-0.5"
            onPointerDown={(e) => {
              if (e.target !== e.currentTarget) return;
              setSel(new Set());
              setFocusId(null);
              anchorRef.current = null;
              engine.stopLibraryPreview();
            }}
          >
            {items.map((it) => (
              <LibraryRow
                key={it.bufId}
                it={it}
                selected={sel.has(it.bufId)}
                focused={focusId === it.bufId}
                previewing={previewing === it.bufId}
                editing={editing === it.bufId}
                onEditDone={() => setEditing(null)}
                onPreview={() => audition(it.bufId)}
                onClick={(e) => onRowClick(it.bufId, e)}
                onPlace={(across) =>
                  placeIds(
                    selected.includes(it.bufId) ? selected : [it.bufId],
                    across,
                  )
                }
                onMenu={(x, y) => menuFor(it, x, y)}
                onDragIds={() =>
                  selected.includes(it.bufId) && selected.length
                    ? selected.filter((id) => engine.hasImport(id))
                    : engine.hasImport(it.bufId)
                      ? [it.bufId]
                      : []
                }
                onDragUnselected={() => {
                  setSel(new Set([it.bufId]));
                  setFocusId(it.bufId);
                  anchorRef.current = it.bufId;
                }}
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
  selected,
  focused,
  previewing,
  editing,
  onEditDone,
  onPreview,
  onClick,
  onPlace,
  onMenu,
  onDragIds,
  onDragUnselected,
  onFileDragOver,
  onFileDrop,
}: {
  it: LibraryEntry;
  selected: boolean;
  focused: boolean;
  previewing: boolean;
  editing: boolean;
  onEditDone: () => void;
  onPreview: () => void;
  onClick: (e: MouseEvent) => void;
  onPlace: (across?: boolean) => void;
  onMenu: (x: number, y: number) => void;
  onDragIds: () => string[];
  onDragUnselected: () => void;
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
      data-lib-id={it.bufId}
      role="option"
      aria-selected={selected}
      draggable={!editing && engine.hasImport(it.bufId)}
      onDragStart={(e) => {
        engine.stopLibraryPreview();
        if (!selected) onDragUnselected();
        const ids = !selected ? [it.bufId] : onDragIds();
        if (!ids.length) {
          e.preventDefault();
          return;
        }
        setLibraryDrag(e.dataTransfer, ids);
      }}
      onDragOver={onFileDragOver}
      onDrop={onFileDrop}
      onClick={onClick}
      onDoubleClick={(e) => {
        e.preventDefault();
        onPlace(e.metaKey || e.ctrlKey);
      }}
      onContextMenu={(e) => {
        if (e.shiftKey) return;
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      className={
        "flex cursor-grab items-center gap-1.5 border-b border-line/60 px-1.5 py-1 active:cursor-grabbing " +
        (selected
          ? "bg-[color-mix(in_srgb,var(--accent)_16%,transparent)]"
          : previewing
            ? "bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]"
            : "hover:bg-panel2") +
        (focused ? " ring-1 ring-inset ring-accent/60" : "")
      }
      title={
        [
          it.sourcePath && it.sourcePath !== it.name ? it.sourcePath : it.name,
          it.persistOk
            ? "click select/preview · ⇧ range · ⌘ add · drag onto timeline"
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
