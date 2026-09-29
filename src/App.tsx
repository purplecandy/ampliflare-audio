import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ActionPanel, TOOLS, defaultAction } from "./components/ActionPanel";
import { DropZone } from "./components/DropZone";
import { Editor } from "./components/Editor";
import { FileList } from "./components/FileList";
import { Icon } from "./components/Icon";
import { OutputBar } from "./components/OutputBar";
import { Sidebar } from "./components/Sidebar";
import { UpdateChecker } from "./components/UpdateChecker";
import { limitReached, openBuyPage, resetDay } from "./license";
import { DEFAULT_PATTERN, fillDate, load, save, saveDevLook } from "./settings";
import {
  EDITOR_KINDS,
  type Action,
  type ActionKind,
  type Analysis,
  type LicenseStatus,
  type Progress,
  type QueuedFile,
  type SaveTo,
  type Tools,
} from "./types";
import "./App.css";

const IS_TAURI = "__TAURI_INTERNALS__" in window;
const AUDIO_EXTS = [
  "wav",
  "mp3",
  "m4a",
  "aac",
  "flac",
  "ogg",
  "opus",
  "aiff",
  "aif",
  "wma",
];

type AnalysisState =
  | { status: "loading" }
  | { status: "ok"; data: Analysis }
  | { status: "error"; message: string };

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function parentDir(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
}

function isSaveTo(v: unknown): boolean {
  const s = v as SaveTo;
  return s?.kind === "source" || (s?.kind === "folder" && typeof s.path === "string" && s.path !== "");
}

function isStringList(v: unknown): boolean {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export default function App() {
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [action, setAction] = useState<Action>({
    kind: "denoise",
    strength: 100,
  });
  const [saveTo, setSaveTo] = useState<SaveTo>(() => load("saveTo", { kind: "source" }, isSaveTo));
  const [recentDirs, setRecentDirs] = useState<string[]>(() => load("recentDirs", [], isStringList));
  const [namePattern, setNamePattern] = useState(() =>
    load("namePattern", DEFAULT_PATTERN, (v) => typeof v === "string"),
  );
  const [tools, setTools] = useState<Tools | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [analyses, setAnalyses] = useState<Record<string, AnalysisState>>({});
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const cancelRef = useRef(false);

  const isEditor = EDITOR_KINDS.includes(action.kind);
  const selected = files.find((f) => f.id === selectedId) ?? null;

  useEffect(() => save("saveTo", saveTo), [saveTo]);
  useEffect(() => save("recentDirs", recentDirs), [recentDirs]);
  useEffect(() => save("namePattern", namePattern), [namePattern]);

  // Show the saved license at once, then ask Dodo whether it still holds.
  useEffect(() => {
    if (!IS_TAURI) return;
    invoke<LicenseStatus>("license_status").then(setLicense).catch(console.warn);
    invoke<LicenseStatus>("refresh_license").then(setLicense).catch(console.warn);
  }, []);

  useEffect(() => {
    invoke<Tools>("check_tools")
      .then(setTools)
      .catch(() => setTools({ deep_filter: false, ffmpeg: null }));
  }, []);

  const addPaths = useCallback(async (paths: string[]) => {
    const checks = await Promise.all(
      paths.map((p) => invoke<boolean>("is_audio_file", { path: p })),
    );
    const good = paths.filter((_, i) => checks[i]);
    if (good.length === 0) return;
    setFiles((prev) => {
      const have = new Set(prev.map((f) => f.path));
      const fresh = good
        .filter((p) => !have.has(p))
        .map<QueuedFile>((p) => ({
          id: crypto.randomUUID(),
          path: p,
          name: baseName(p),
          status: "waiting",
        }));
      return [...prev, ...fresh];
    });
  }, []);

  // Dev builds can start with files already loaded. See dev_start in jobs.rs.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    invoke<{ files: string[]; action: string | null; look: string | null }>("dev_start")
      .then((d) => {
        // The look is read once at start, so reload after changing it.
        if (d.look && saveDevLook(d.look)) return location.reload();
        if (d.action) setAction(defaultAction(d.action as ActionKind));
        if (d.files.length > 0) void addPaths(d.files);
      })
      .catch(() => {});
  }, [addPaths]);

  useEffect(() => {
    if (!IS_TAURI) return;
    const unlisten = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "enter" || e.payload.type === "over")
        setDragging(true);
      else if (e.payload.type === "leave") setDragging(false);
      else if (e.payload.type === "drop") {
        setDragging(false);
        void addPaths(e.payload.paths);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [addPaths]);

  useEffect(() => {
    const unlisten = listen<Progress>("job-progress", (e) => {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === e.payload.id ? { ...f, step: e.payload.step } : f,
        ),
      );
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Keep one file selected whenever there are files.
  useEffect(() => {
    if (files.length === 0) {
      if (selectedId) setSelectedId(null);
    } else if (!files.some((f) => f.id === selectedId)) {
      setSelectedId(files[0].id);
    }
  }, [files, selectedId]);

  // Read the selected file for the picture when Cut or Split is open.
  useEffect(() => {
    if (!isEditor || !selected || analyses[selected.id]) return;
    const id = selected.id;
    setAnalyses((prev) => ({ ...prev, [id]: { status: "loading" } }));
    invoke<Analysis>("analyze_audio", { path: selected.path })
      .then((data) =>
        setAnalyses((prev) => ({ ...prev, [id]: { status: "ok", data } })),
      )
      .catch((err) =>
        setAnalyses((prev) => ({
          ...prev,
          [id]: { status: "error", message: String(err) },
        })),
      );
  }, [isEditor, selected, analyses]);

  // Cut and split points belong to one file. Reset them when another file is picked.
  useEffect(() => {
    setAction((a) =>
      a.kind === "cut"
        ? { kind: "cut", start: 0 }
        : a.kind === "split"
          ? { kind: "split", points: [] }
          : a,
    );
  }, [selectedId]);

  async function pickFiles() {
    const picked = await open({
      multiple: true,
      filters: [{ name: "Audio", extensions: AUDIO_EXTS }],
    });
    if (picked) await addPaths(Array.isArray(picked) ? picked : [picked]);
  }

  async function pickOutputDir() {
    const dir = await open({
      directory: true,
      defaultPath: saveTo.kind === "folder" ? saveTo.path : undefined,
    });
    if (typeof dir !== "string") return;
    setSaveTo({ kind: "folder", path: dir });
    setRecentDirs((prev) => [dir, ...prev.filter((d) => d !== dir)].slice(0, 5));
  }

  function revealOutput() {
    if (saveTo.kind === "folder") void revealItemInDir(saveTo.path);
    else if (selected ?? files[0]) void revealItemInDir((selected ?? files[0]).path);
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  async function runAll() {
    if (busy) return;
    const todo = isEditor
      ? files.filter((f) => f.id === selectedId)
      : files.filter((f) => f.status !== "done");
    if (todo.length === 0) return;
    setBusy(true);
    cancelRef.current = false;
    for (const f of todo) {
      if (cancelRef.current) break;
      setFiles((prev) =>
        prev.map((x) =>
          x.id === f.id
            ? { ...x, status: "running", step: "Starting", error: undefined }
            : x,
        ),
      );
      try {
        const outputs = await invoke<string[]>("run_job", {
          id: f.id,
          input: f.path,
          outputDir: saveTo.kind === "folder" ? saveTo.path : parentDir(f.path),
          namePattern: fillDate(namePattern),
          action,
        });
        setFiles((prev) =>
          prev.map((x) =>
            x.id === f.id
              ? { ...x, status: "done", outputs, step: undefined }
              : x,
          ),
        );
      } catch (err) {
        const message = typeof err === "string" ? err : String(err);
        setFiles((prev) =>
          prev.map((x) =>
            x.id === f.id
              ? { ...x, status: "error", error: message, step: undefined }
              : x,
          ),
        );
      }
      // Free use stops at the weekly limit. The files left stay waiting.
      const status = await invoke<LicenseStatus>("license_status").catch(() => null);
      if (status) setLicense(status);
      if (limitReached(status)) break;
    }
    setBusy(false);
  }

  const pending = isEditor
    ? selected
      ? 1
      : 0
    : files.filter((f) => f.status !== "done").length;
  const needsDeepFilter =
    action.kind === "denoise" && tools && !tools.deep_filter;
  const needsFfmpeg = tools && !tools.ffmpeg;
  const splitEmpty = action.kind === "split" && action.points.length === 0;
  const atLimit = limitReached(license);
  const canRun =
    pending > 0 &&
    !busy &&
    !needsDeepFilter &&
    !needsFfmpeg &&
    !splitEmpty &&
    !atLimit;
  const runLabel = atLimit
    ? "Weekly limit reached"
    : isEditor
    ? selected
      ? `${action.kind === "cut" ? "Cut" : "Split"} ${selected.name}`
      : "Pick a file"
    : `Run on ${pending} file${pending === 1 ? "" : "s"}`;

  const analysis = selected ? analyses[selected.id] : undefined;

  const tool = TOOLS.find((t) => t.kind === action.kind)!;
  const doneCount = files.filter((f) => f.status === "done").length;
  const subtitle = busy
    ? `Working on file ${Math.min(doneCount + 1, files.length)} of ${files.length}`
    : files.length === 0
      ? tool.hint
      : `${files.length} file${files.length === 1 ? "" : "s"} · ${tool.hint}`;

  return (
    <div className="window">
      <Sidebar
        kind={action.kind}
        busy={busy}
        onKind={(k) => k !== action.kind && setAction(defaultAction(k))}
        license={license}
        onLicense={setLicense}
      />

      <section className="content">
        <header className="headerbar">
          <div className="headerbar-start" />
          <div className="headerbar-title">
            <span className="title">{tool.label}</span>
            <span className="subtitle">{subtitle}</span>
          </div>
          <div className="headerbar-end">
            <button
              type="button"
              className="flat circular"
              aria-label="Add files"
              title="Add files"
              disabled={busy}
              onClick={pickFiles}
            >
              <Icon name="plus" />
            </button>
            <button
              type="button"
              className="flat circular"
              aria-label="Clear list"
              title="Clear list"
              disabled={busy || files.length === 0}
              onClick={() => setFiles([])}
            >
              <Icon name="trash" />
            </button>
            {busy ? (
              <button
                type="button"
                className="destructive"
                onClick={() => (cancelRef.current = true)}
              >
                <Icon name="stop" />
                Stop after this file
              </button>
            ) : (
              <button
                type="button"
                className="suggested"
                disabled={!canRun}
                onClick={runAll}
              >
                <Icon name="play" />
                {runLabel}
              </button>
            )}
          </div>
        </header>

        <UpdateChecker />

        {needsFfmpeg && (
          <div className="banner">
            <Icon name="warning" />
            <span>
              ffmpeg was not found. Install it with{" "}
              <code>brew install ffmpeg</code> and reopen the app.
            </span>
          </div>
        )}
        {atLimit && license && (
          <div className="banner">
            <Icon name="warning" />
            <span>
              You have used this week's {license.limit} free files.
              {resetDay(license) && ` The count resets on ${resetDay(license)}.`}{" "}
              <a
                href="#buy"
                onClick={(e) => {
                  e.preventDefault();
                  openBuyPage();
                }}
              >
                Buy a license
              </a>{" "}
              to remove the limit and use it for work.
            </span>
          </div>
        )}
        {needsDeepFilter && (
          <div className="banner">
            <Icon name="warning" />
            <span>
              The noise removal tool is missing. Run{" "}
              <code>scripts/fetch-sidecars.sh</code> and restart.
            </span>
          </div>
        )}

        <div className={`page ${dragging ? "drop-active" : ""}`}>
          <div className="page-inner">
            {files.length === 0 ? (
              <DropZone active={dragging} onPick={pickFiles} />
            ) : (
              <>
                <FileList
                  files={files}
                  selectedId={selectedId}
                  selectable={isEditor}
                  busy={busy}
                  onSelect={setSelectedId}
                  onRemove={removeFile}
                />
                <DropZone compact active={dragging} onPick={pickFiles} />

                <ActionPanel
                  action={action}
                  onChange={setAction}
                  disabled={busy}
                >
                  {(action.kind === "cut" || action.kind === "split") && (
                    <Editor
                      file={selected}
                      analysis={
                        analysis?.status === "ok" ? analysis.data : undefined
                      }
                      loading={analysis?.status === "loading"}
                      error={
                        analysis?.status === "error"
                          ? analysis.message
                          : undefined
                      }
                      action={action}
                      onChange={setAction}
                      disabled={busy}
                    />
                  )}
                </ActionPanel>
              </>
            )}
          </div>
        </div>

        <OutputBar
          saveTo={saveTo}
          recentDirs={recentDirs}
          pattern={namePattern}
          action={action}
          sample={selected ?? files[0] ?? null}
          doneCount={doneCount}
          fileCount={files.length}
          busy={busy}
          onSaveTo={setSaveTo}
          onPickFolder={pickOutputDir}
          onReveal={revealOutput}
          onPattern={setNamePattern}
        />
      </section>
    </div>
  );
}
