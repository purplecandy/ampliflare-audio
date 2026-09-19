import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { QueuedFile } from "../types";

interface Props {
  files: QueuedFile[];
  selectedId: string | null;
  selectable: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

const LABEL: Record<QueuedFile["status"], string> = {
  waiting: "Waiting",
  running: "Working",
  done: "Done",
  error: "Failed",
};

function statusText(f: QueuedFile): string {
  if (f.status === "running" && f.step) return `${f.step}…`;
  if (f.status === "error" && f.error) return `Failed: ${f.error}`;
  if (f.status === "done" && f.outputs && f.outputs.length > 1) return `Done, ${f.outputs.length} files`;
  return LABEL[f.status];
}

export function FileList({ files, selectedId, selectable, busy, onSelect, onRemove, onClear }: Props) {
  if (files.length === 0) return null;

  return (
    <article className="files tight">
      <header>
        <span>{files.length} file{files.length === 1 ? "" : "s"}</span>
        {selectable && <small className="muted"> · click a file to edit it</small>}
        <button type="button" className="outline secondary small right" disabled={busy} onClick={onClear}>
          Clear all
        </button>
      </header>
      <table>
        <tbody>
          {files.map((f) => (
            <tr
              key={f.id}
              aria-selected={selectable && f.id === selectedId}
              className={selectable ? "selectable" : ""}
              onClick={() => selectable && onSelect(f.id)}
            >
              <td>
                <span className="file-name" title={f.path}>{f.name}</span>
                <br />
                <small className={`status-${f.status}`}>{statusText(f)}</small>
              </td>
              <td className="actions">
                {f.status === "done" && f.outputs?.[0] && (
                  <button type="button" className="outline small" onClick={(e) => { e.stopPropagation(); revealItemInDir(f.outputs![0]); }}>
                    Show
                  </button>
                )}
                {!busy && (
                  <button type="button" className="outline secondary small" aria-label="Remove"
                    onClick={(e) => { e.stopPropagation(); onRemove(f.id); }}>
                    ✕
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
