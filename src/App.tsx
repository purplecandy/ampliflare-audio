import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ActionPanel } from "./components/ActionPanel";
import { DropZone } from "./components/DropZone";
import { FileList } from "./components/FileList";
import type { Action, Progress, QueuedFile, Tools } from "./types";
import "./App.css";

const AUDIO_EXTS = ["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "aiff", "aif", "wma"];

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function parentDir(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
}

export default function App() {
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [action, setAction] = useState<Action>({ kind: "denoise", strength: 100 });
  const [outputDir, setOutputDir] = useState<string>("");
  const [tools, setTools] = useState<Tools | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    invoke<Tools>("check_tools").then(setTools).catch(() => setTools({ deep_filter: false, ffmpeg: null }));
  }, []);

  const addPaths = useCallback(async (paths: string[]) => {
    const checks = await Promise.all(paths.map((p) => invoke<boolean>("is_audio_file", { path: p })));
    const good = paths.filter((_, i) => checks[i]);
    setFiles((prev) => {
      const have = new Set(prev.map((f) => f.path));
      const fresh = good
        .filter((p) => !have.has(p))
        .map<QueuedFile>((p) => ({ id: crypto.randomUUID(), path: p, name: baseName(p), status: "waiting" }));
      return [...prev, ...fresh];
    });
    if (good.length > 0) {
      setOutputDir((d) => d || parentDir(good[0]));
    }
  }, []);

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

  async function pickFiles() {
    const picked = await open({ multiple: true, filters: [{ name: "Audio", extensions: AUDIO_EXTS }] });
    if (picked) await addPaths(Array.isArray(picked) ? picked : [picked]);
  }

  async function pickOutputDir() {
    const dir = await open({ directory: true, defaultPath: outputDir || undefined });
    if (typeof dir === "string") setOutputDir(dir);
  }

  async function runAll() {
    if (!outputDir || busy) return;
    setBusy(true);
    cancelRef.current = false;
    const todo = files.filter((f) => f.status !== "done");
    for (const f of todo) {
      if (cancelRef.current) break;
      setFiles((prev) => prev.map((x) => (x.id === f.id ? { ...x, status: "running", step: "Starting", error: undefined } : x)));
      try {
        const output = await invoke<string>("run_job", { id: f.id, input: f.path, outputDir, action });
        setFiles((prev) => prev.map((x) => (x.id === f.id ? { ...x, status: "done", output, step: undefined } : x)));
      } catch (err) {
        const message = typeof err === "string" ? err : String(err);
        setFiles((prev) => prev.map((x) => (x.id === f.id ? { ...x, status: "error", error: message, step: undefined } : x)));
      }
    }
    setBusy(false);
  }

  const pending = files.filter((f) => f.status !== "done").length;
  const needsDeepFilter = action.kind === "denoise" && tools && !tools.deep_filter;
  const needsFfmpeg = tools && !tools.ffmpeg;
  const canRun = pending > 0 && !!outputDir && !busy && !needsDeepFilter && !needsFfmpeg;

  return (
    <main className="app">
      <header className="topbar">
        <h1>Ampliflare Audio</h1>
        <span className="tagline">Runs on your Mac. Nothing leaves your machine.</span>
      </header>

      {needsFfmpeg && (
        <div className="notice notice-warn">
          ffmpeg was not found. Install it with <code>brew install ffmpeg</code> and reopen the app.
        </div>
      )}
      {needsDeepFilter && (
        <div className="notice notice-warn">
          The noise removal tool is missing. Run <code>scripts/fetch-sidecars.sh</code> and restart.
        </div>
      )}

      <DropZone active={dragging} onPick={pickFiles} />
      <FileList
        files={files}
        busy={busy}
        onRemove={(id) => setFiles((prev) => prev.filter((f) => f.id !== id))}
        onClear={() => setFiles([])}
      />

      <ActionPanel action={action} onChange={setAction} disabled={busy} />

      <section className="runbar">
        <div className="outdir">
          <span className="outdir-label">Save to</span>
          <button type="button" className="outdir-pick" onClick={pickOutputDir} disabled={busy} title={outputDir}>
            {outputDir ? baseName(outputDir) : "Choose a folder"}
          </button>
          {outputDir && (
            <button type="button" className="link" onClick={() => revealItemInDir(outputDir)}>
              Open
            </button>
          )}
        </div>
        {busy ? (
          <button type="button" className="btn btn-secondary" onClick={() => (cancelRef.current = true)}>
            Stop after this file
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={!canRun} onClick={runAll}>
            Run on {pending} file{pending === 1 ? "" : "s"}
          </button>
        )}
      </section>
    </main>
  );
}
