import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Icon } from "./Icon";
import { Player, useAudioPlayer } from "./Player";
import { actionTitle } from "../notice";
import type { LogItem } from "../types";

interface Props {
  items: LogItem[];
  onClose: () => void;
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** A sheet with everything done in this session, newest first, grouped by run. */
export function ActivityLog({ items, onClose }: Props) {
  const player = useAudioPlayer();
  // Only files that are still on disk can be played.
  const [exists, setExists] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const paths = [...new Set(items.flatMap((i) => i.outputs))];
    if (paths.length === 0) return;
    invoke<boolean[]>("files_exist", { paths })
      .then((found) => setExists(Object.fromEntries(paths.map((p, i) => [p, found[i]]))))
      .catch(console.warn);
  }, [items]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Stop the sound when the sheet closes.
  useEffect(() => player.stop, []); // eslint-disable-line react-hooks/exhaustive-deps

  const runs: { runId: string; at: number; items: LogItem[] }[] = [];
  for (const item of [...items].reverse()) {
    const run = runs.find((r) => r.runId === item.runId);
    if (run) run.items.push(item);
    else runs.push({ runId: item.runId, at: item.at, items: [item] });
  }

  const total = items.length;
  const failedCount = items.filter((i) => i.status === "error").length;

  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <aside className="sheet" role="dialog" aria-label="Activity" onMouseDown={(e) => e.stopPropagation()}>
        {player.element}
        <header className="headerbar">
          <div className="headerbar-start" />
          <div className="headerbar-title">
            <span className="title">Activity</span>
            <span className="subtitle">
              {total === 0
                ? "Since you opened the app"
                : `${total} file${total === 1 ? "" : "s"} since you opened the app${failedCount ? ` · ${failedCount} failed` : ""}`}
            </span>
          </div>
          <div className="headerbar-end">
            <button type="button" className="flat circular" aria-label="Close" title="Close" onClick={onClose}>
              <Icon name="close" />
            </button>
          </div>
        </header>

        <div className="sheet-body">
          {runs.length === 0 ? (
            <div className="status-page">
              <Icon name="history" className="status-icon" />
              <h2>No results yet</h2>
              <p>
                When you clean, enhance, cut, split or convert a file, the new files show up here. Play them to
                check how they sound, or show them in Finder. This list clears when you quit.
              </p>
            </div>
          ) : (
            runs.map((run) => {
              const failed = run.items.filter((i) => i.status === "error").length;
              return (
                <div key={run.runId}>
                  <div className="list-header">
                    <span className="title">{actionTitle(run.items[0].action)}</span>
                    <small className="subtitle">
                      {clock(run.at)} · {run.items.length} file{run.items.length === 1 ? "" : "s"}
                      {failed ? ` · ${failed} failed` : ""}
                    </small>
                  </div>
                  <div className="boxed-list" role="list">
                    {run.items.flatMap((item) =>
                      item.status === "error" ? (
                        <div key={item.id} role="listitem" className="row-item">
                          <span className="row-icon error">
                            <Icon name="warning" />
                          </span>
                          <div className="row-text">
                            <span className="row-title" title={item.input}>
                              {item.input}
                            </span>
                            <span className="row-subtitle status-error" title={item.error}>
                              Failed: {item.error}
                            </span>
                          </div>
                        </div>
                      ) : (
                        item.outputs.map((path, n) => {
                          const found = exists[path];
                          const from =
                            item.outputs.length > 1
                              ? `Part ${n + 1} of ${item.outputs.length} from ${item.input}`
                              : `From ${item.input}`;
                          return (
                            <div key={path} role="listitem" className="row-item">
                              <span className={`row-icon ${found === false ? "" : "done"}`}>
                                <Icon name={found === false ? "warning" : "check"} />
                              </span>
                              <div className="row-text">
                                <span className="row-title" title={path}>
                                  {baseName(path)}
                                </span>
                                <span className="row-subtitle">
                                  {found === false ? "Moved or deleted since it was saved" : from}
                                </span>
                              </div>
                              {found && (
                                <>
                                  <Player player={player} id={path} path={path} />
                                  <div className="row-actions">
                                    <button type="button" className="flat" onClick={() => void revealItemInDir(path)}>
                                      <Icon name="open" />
                                      Show
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })
                      ),
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}
