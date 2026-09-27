import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { TOOLS } from "./ActionPanel";
import { Icon } from "./Icon";
import { checkForUpdates } from "./UpdateChecker";
import type { ActionKind } from "../types";

interface Props {
  kind: ActionKind;
  busy: boolean;
  fileCount: number;
  outputDir: string;
  onKind: (kind: ActionKind) => void;
  onPickFiles: () => void;
  onPickOutputDir: () => void;
  onOpenOutputDir: () => void;
  onClear: () => void;
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

export function Sidebar({ kind, busy, fileCount, outputDir, onKind, onPickFiles, onPickOutputDir, onOpenOutputDir, onClear }: Props) {
  const [version, setVersion] = useState("");
  const [updateStatus, setUpdateStatus] = useState("");

  useEffect(() => {
    if ("__TAURI_INTERNALS__" in window) {
      void getVersion().then(setVersion).catch(console.warn);
    }
  }, []);

  async function checkUpdates() {
    setUpdateStatus("Checking...");
    const result = await checkForUpdates();
    setUpdateStatus(result === "current" ? "You are up to date" : result === "error" ? "Could not check for updates" : "");
  }

  return (
    <aside className="sidebar">
      <header className="headerbar">
        <span className="title">Ampliflare Audio</span>
      </header>

      <div className="toolgrid">
        <button type="button" onClick={onPickFiles} disabled={busy}>
          <Icon name="plus" />
          <span>Add</span>
        </button>
        <button type="button" onClick={onPickOutputDir} disabled={busy}>
          <Icon name="folder" />
          <span>Save to</span>
        </button>
        <button type="button" onClick={onClear} disabled={busy || fileCount === 0}>
          <Icon name="trash" />
          <span>Clear</span>
        </button>
      </div>

      <nav>
        <p className="section-label">Tools</p>
        <ul>
          {TOOLS.map((t) => (
            <li key={t.kind}>
              <button
                type="button"
                className={`row ${t.kind === kind ? "active" : ""}`}
                aria-pressed={t.kind === kind}
                disabled={busy}
                onClick={() => onKind(t.kind)}
              >
                <Icon name={t.icon} />
                <span>{t.label}</span>
              </button>
            </li>
          ))}
        </ul>

        <p className="section-label">Output</p>
        <button type="button" className="row" onClick={onPickOutputDir} disabled={busy} title={outputDir}>
          <Icon name="folder" />
          <span className="row-text">
            <span className="row-title">{outputDir ? baseName(outputDir) : "Choose a folder"}</span>
            <span className="row-subtitle">{outputDir ? "Results are saved here" : "Where results go"}</span>
          </span>
          {outputDir && (
            <span
              role="button"
              tabIndex={0}
              className="flat circular"
              aria-label="Open folder"
              onClick={(e) => {
                e.stopPropagation();
                onOpenOutputDir();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  onOpenOutputDir();
                }
              }}
            >
              <Icon name="open" />
            </span>
          )}
        </button>
      </nav>
      <footer className="sidebar-footer">
        <button type="button" className="row" onClick={checkUpdates} disabled={updateStatus === "Checking..." || !("__TAURI_INTERNALS__" in window) || import.meta.env.DEV}>
          <span className="row-text">
            <span className="row-title">{updateStatus || "Check for updates"}</span>
            {version && <span className="row-subtitle">Version {version}</span>}
          </span>
        </button>
      </footer>
    </aside>
  );
}
