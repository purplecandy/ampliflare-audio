import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ActionPanel, defaultAction } from "./components/ActionPanel";
import { DropZone } from "./components/DropZone";
import { Editor } from "./components/Editor";
import { FileList } from "./components/FileList";
import { EDITOR_KINDS, type Action, type ActionKind, type Analysis, type Progress, type QueuedFile, type Tools } from "./types";
import "./App.css";

const AUDIO_EXTS = ["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "aiff", "aif", "wma"];

type AnalysisState = { status: "loading" } | { status: "ok"; data: Analysis } | { status: "error"; message: string };

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function parentDir(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
}

export default function App() {
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [action, setAction] = useState<Action>({ kind: "denoise", strength: 100 });
  const [outputDir, setOutputDir] = useState("");
  const [tools, setTools] = useState<Tools | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [analyses, setAnalyses] = useState<Record<string, AnalysisState>>({});
  const cancelRef = useRef(false);

  const isEditor = EDITOR_KINDS.includes(action.kind);
  const selected = files.find((f) => f.id === selectedId) ?? null;

  useEffect(() => {
    invoke<Tools>("check_tools").then(setTools).catch(() => setTools({ deep_filter: false, ffmpeg: null }));
  }, []);

  const addPaths = useCallback(async (paths: string[]) => {
    const checks = await Promise.all(paths.map((p) => invoke<boolean>("is_audio_file", { path: p })));
    const good = paths.filter((_, i) => checks[i]);
    if (good.length === 0) return;
    setFiles((prev) => {
      const have = new Set(prev.map((f) => f.path));
      const fresh = good
        .filter((p) => !have.has(p))
        .map<QueuedFile>((p) => ({ id: crypto.randomUUID(), path: p, name: baseName(p), status: "waiting" }));
      return [...prev, ...fresh];
    });
    setOutputDir((d) => d || parentDir(good[0]));
  }, []);

  // Dev builds can start with files already loaded. See dev_start in jobs.rs.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    invoke<{ files: string[]; action: string | null }>("dev_start").then((d) => {
      if (d.action) setAction(defaultAction(d.action as ActionKind));
      if (d.files.length > 0) void addPaths(d.files);
    });
  }, [addPaths]);

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "enter" || e.payload.type === "over") setDragging(true);
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
      setFiles((prev) => prev.map((f) => (f.id === e.payload.id ? { ...f, step: e.payload.step } : f)));
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
      .then((data) => setAnalyses((prev) => ({ ...prev, [id]: { status: "ok", data } })))
      .catch((err) => setAnalyses((prev) => ({ ...prev, [id]: { status: "error", message: String(err) } })));
  }, [isEditor, selected, analyses]);

  // Cut and split points belong to one file. Reset them when another file is picked.
  useEffect(() => {
    setAction((a) => (a.kind === "cut" ? { kind: "cut", start: 0 } : a.kind === "split" ? { kind: "split", points: [] } : a));
  }, [selectedId]);

  async function pickFiles() {
    const picked = await open({ multiple: true, filters: [{ name: "Audio", extensions: AUDIO_EXTS }] });
    if (picked) await addPaths(Array.isArray(picked) ? picked : [picked]);
  }

  async function pickOutputDir() {
    const dir = await open({ directory: true, defaultPath: outputDir || undefined });
    if (typeof dir === "string") setOutputDir(dir);
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  async function runAll() {
    if (!outputDir || busy) return;
    const todo = isEditor ? files.filter((f) => f.id === selectedId) : files.filter((f) => f.status !== "done");
    if (todo.length === 0) return;
    setBusy(true);
    cancelRef.current = false;
    for (const f of todo) {
      if (cancelRef.current) break;
      setFiles((prev) => prev.map((x) => (x.id === f.id ? { ...x, status: "running", step: "Starting", error: undefined } : x)));
      try {
        const outputs = await invoke<string[]>("run_job", { id: f.id, input: f.path, outputDir, action });
        setFiles((prev) => prev.map((x) => (x.id === f.id ? { ...x, status: "done", outputs, step: undefined } : x)));
      } catch (err) {
        const message = typeof err === "string" ? err : String(err);
        setFiles((prev) => prev.map((x) => (x.id === f.id ? { ...x, status: "error", error: message, step: undefined } : x)));
      }
    }
    setBusy(false);
  }

  const pending = isEditor ? (selected ? 1 : 0) : files.filter((f) => f.status !== "done").length;
  const needsDeepFilter = action.kind === "denoise" && tools && !tools.deep_filter;
  const needsFfmpeg = tools && !tools.ffmpeg;
  const splitEmpty = action.kind === "split" && action.points.length === 0;
  const canRun = pending > 0 && !!outputDir && !busy && !needsDeepFilter && !needsFfmpeg && !splitEmpty;
  const runLabel = isEditor ? (selected ? `${action.kind === "cut" ? "Cut" : "Split"} ${selected.name}` : "Pick a file") : `Run on ${pending} file${pending === 1 ? "" : "s"}`;

  const analysis = selected ? analyses[selected.id] : undefined;

  return (
    <main className="container">
      <hgroup>
        <h1>Ampliflare Audio</h1>
        <p>Runs on your computer. Nothing leaves your machine.</p>
      </hgroup>

      {needsFfmpeg && (
        <article className="notice">
          ffmpeg was not found. Install it with <code>brew install ffmpeg</code> and reopen the app.
        </article>
      )}
      {needsDeepFilter && (
        <article className="notice">
          The noise removal tool is missing. Run <code>scripts/fetch-sidecars.sh</code> and restart.
        </article>
      )}

      <DropZone active={dragging} onPick={pickFiles} />

      <FileList
        files={files}
        selectedId={selectedId}
        selectable={isEditor}
        busy={busy}
        onSelect={setSelectedId}
        onRemove={removeFile}
        onClear={() => setFiles([])}
      />

      <ActionPanel action={action} onChange={setAction} disabled={busy}>
        {(action.kind === "cut" || action.kind === "split") && (
          <Editor
            file={selected}
            analysis={analysis?.status === "ok" ? analysis.data : undefined}
            loading={analysis?.status === "loading"}
            error={analysis?.status === "error" ? analysis.message : undefined}
            action={action}
            onChange={setAction}
            disabled={busy}
          />
        )}
      </ActionPanel>

      <article className="runbar tight">
        <div className="outdir">
          <span className="muted">Save to</span>
          <button type="button" className="outline secondary" onClick={pickOutputDir} disabled={busy} title={outputDir}>
            {outputDir ? baseName(outputDir) : "Choose a folder"}
          </button>
          {outputDir && (
            <button type="button" className="outline secondary" onClick={() => revealItemInDir(outputDir)}>
              Open
            </button>
          )}
        </div>
        {busy ? (
          <button type="button" className="secondary" onClick={() => (cancelRef.current = true)} aria-busy="true">
            Stop after this file
          </button>
        ) : (
          <button type="button" disabled={!canRun} onClick={runAll}>
            {runLabel}
          </button>
        )}
      </article>
    </main>
  );
}
