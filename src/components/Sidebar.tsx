import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { TOOLS } from "./ActionPanel";
import { AppearanceMenu } from "./AppearanceMenu";
import { Icon } from "./Icon";
import { checkForUpdates } from "./UpdateChecker";
import type { ActionKind } from "../types";

interface Props {
  kind: ActionKind;
  busy: boolean;
  onKind: (kind: ActionKind) => void;
}

export function Sidebar({ kind, busy, onKind }: Props) {
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
      </nav>
      <footer className="sidebar-footer">
        <AppearanceMenu />
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
