import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Icon, type IconName } from "./Icon";
import type { QueuedFile } from "../types";

interface Props {
  files: QueuedFile[];
  selectedId: string | null;
  selectable: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

const LABEL: Record<QueuedFile["status"], string> = {
  waiting: "Waiting",
  running: "Working",
  done: "Done",
  error: "Failed",
};

const ICON: Record<QueuedFile["status"], IconName> = {
  waiting: "noise",
  running: "spinner",
  done: "check",
  error: "warning",
};

function statusText(f: QueuedFile): string {
  if (f.status === "running" && f.step) return `${f.step}…`;
  if (f.status === "error" && f.error) return `Failed: ${f.error}`;
  if (f.status === "done" && f.outputs && f.outputs.length > 1) return `Done, ${f.outputs.length} files`;
  return LABEL[f.status];
}

export function FileList({ files, selectedId, selectable, busy, onSelect, onRemove }: Props) {
  if (files.length === 0) return null;

  return (
    <>
      <div className="list-header">
        <span className="title">
          {files.length} file{files.length === 1 ? "" : "s"}
        </span>
        {selectable && <small className="subtitle">Click a file to edit it</small>}
      </div>
      <div className="boxed-list" role={selectable ? "listbox" : "list"}>
        {files.map((f) => {
          const selected = selectable && f.id === selectedId;
          return (
            <div
              key={f.id}
              role={selectable ? "option" : "listitem"}
              aria-selected={selectable ? selected : undefined}
              tabIndex={selectable ? 0 : undefined}
              className={`row-item ${selectable ? "activatable" : ""}`}
              onClick={() => selectable && onSelect(f.id)}
              onKeyDown={(e) => selectable && (e.key === "Enter" || e.key === " ") && onSelect(f.id)}
            >
              <span className={`row-icon ${f.status}`}>
                <Icon name={ICON[f.status]} />
              </span>
              <div className="row-text">
                <span className="row-title" title={f.path}>
                  {f.name}
                </span>
                <span className={`row-subtitle ${f.status === "error" ? "status-error" : ""}`}>{statusText(f)}</span>
              </div>
              <div className="row-actions">
                {f.status === "done" && f.outputs?.[0] && (
                  <button
                    type="button"
                    className="flat"
                    onClick={(e) => {
                      e.stopPropagation();
                      revealItemInDir(f.outputs![0]);
                    }}
                  >
                    <Icon name="open" />
                    Show
                  </button>
                )}
                {!busy && (
                  <button
                    type="button"
                    className="flat circular"
                    aria-label="Remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(f.id);
                    }}
                  >
                    <Icon name="close" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
