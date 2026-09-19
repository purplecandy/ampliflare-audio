import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { QueuedFile } from "../types";

interface Props {
  files: QueuedFile[];
  busy: boolean;
  onRemove: (id: string) => void;
  onClear: () => void;
}

const LABEL: Record<QueuedFile["status"], string> = {
  waiting: "Waiting",
  running: "Working",
  done: "Done",
  error: "Failed",
};

export function FileList({ files, busy, onRemove, onClear }: Props) {
  if (files.length === 0) return null;

  return (
    <section className="filelist">
      <header className="filelist-head">
        <span>{files.length} file{files.length === 1 ? "" : "s"}</span>
        <button type="button" className="link" disabled={busy} onClick={onClear}>
          Clear all
        </button>
      </header>
      <ul>
        {files.map((f) => (
          <li key={f.id} className={`file file-${f.status}`}>
            <div className="file-main">
              <span className="file-name" title={f.path}>{f.name}</span>
              <span className="file-meta">
                {f.status === "running" && f.step ? `${f.step}…` : LABEL[f.status]}
                {f.status === "error" && f.error ? `: ${f.error}` : ""}
              </span>
            </div>
            <div className="file-actions">
              {f.status === "done" && f.output && (
                <button type="button" className="link" onClick={() => revealItemInDir(f.output!)}>
                  Show
                </button>
              )}
              {!busy && (
                <button type="button" className="link" onClick={() => onRemove(f.id)} aria-label="Remove">
                  ✕
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
