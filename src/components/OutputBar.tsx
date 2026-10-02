import { useRef, useState } from "react";
import { Icon } from "./Icon";
import { Popover } from "./Popover";
import { DEFAULT_PATTERN, TOKENS, previewName } from "../settings";
import type { Action, QueuedFile, SaveTo } from "../types";

interface Props {
  saveTo: SaveTo;
  recentDirs: string[];
  pattern: string;
  action: Action;
  /** The file the preview is drawn for. */
  sample: QueuedFile | null;
  doneCount: number;
  fileCount: number;
  busy: boolean;
  onSaveTo: (s: SaveTo) => void;
  onPickFolder: () => void;
  onReveal: () => void;
  onPattern: (p: string) => void;
  logCount: number;
  onOpenLog: () => void;
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "wav";
}

/** The bar under the page. It says where results go and what they are called. */
export function OutputBar(props: Props) {
  const { saveTo, recentDirs, pattern, action, sample, doneCount, fileCount, busy } = props;
  const [tokensOpen, setTokensOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const value = saveTo.kind === "folder" ? `dir:${saveTo.path}` : "source";
  // A folder saved from an older launch may have dropped off the recent list.
  const dirs = saveTo.kind === "folder" && !recentDirs.includes(saveTo.path) ? [saveTo.path, ...recentDirs] : recentDirs;
  const ext = action.kind === "convert" ? action.format : extOf(sample?.name ?? "audio.wav");
  const preview = previewName(pattern, sample?.name ?? "recording.wav", action.kind, ext);

  function onSelect(v: string) {
    if (v === "other") props.onPickFolder();
    else if (v === "source") props.onSaveTo({ kind: "source" });
    else props.onSaveTo({ kind: "folder", path: v.slice(4) });
  }

  function insert(token: string) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? pattern.length;
    const end = el?.selectionEnd ?? pattern.length;
    props.onPattern(pattern.slice(0, start) + token + pattern.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <footer className="outputbar" aria-label="Output">
      <label htmlFor="save-to">Save to</label>
      <select
        id="save-to"
        value={value}
        disabled={busy}
        title={saveTo.kind === "folder" ? saveTo.path : "Each result goes in the same folder as its original"}
        onChange={(e) => onSelect(e.target.value)}
      >
        <option value="source">Next to Original Files</option>
        {dirs.length > 0 && (
          <optgroup label="Folders">
            {dirs.map((d) => (
              <option key={d} value={`dir:${d}`}>
                {baseName(d)}
              </option>
            ))}
          </optgroup>
        )}
        <option value="other">Choose Destination…</option>
      </select>
      <button
        type="button"
        className="flat circular"
        aria-label="Show in Finder"
        title="Show in Finder"
        disabled={saveTo.kind === "source" && fileCount === 0}
        onClick={props.onReveal}
      >
        <Icon name="reveal" />
      </button>

      <span className="divider" />

      <label htmlFor="name-pattern">Name</label>
      <div className="popover-anchor pattern">
        <input
          id="name-pattern"
          ref={inputRef}
          type="text"
          spellCheck={false}
          autoComplete="off"
          value={pattern}
          placeholder={DEFAULT_PATTERN}
          disabled={busy}
          onChange={(e) => props.onPattern(e.target.value)}
        />
        <button
          type="button"
          className="flat circular"
          aria-label="Name tokens"
          title="Name tokens"
          aria-expanded={tokensOpen}
          disabled={busy}
          onClick={() => setTokensOpen((o) => !o)}
        >
          <Icon name="braces" />
        </button>
        <Popover open={tokensOpen} onClose={() => setTokensOpen(false)} label="File name">
          <p className="section-label">File name</p>
          <p className="hint">Click a token to add it, or type your own text.</p>
          <div className="tokens">
            {TOKENS.map((t) => (
              <button key={t.token} type="button" className="token" onClick={() => insert(t.token)}>
                {t.label}
              </button>
            ))}
          </div>
          <dl className="token-help">
            {TOKENS.map((t) => (
              <div key={t.token}>
                <dt>
                  <code>{t.token}</code>
                </dt>
                <dd>{t.meaning}</dd>
              </div>
            ))}
          </dl>
          <div className="token-foot">
            <span className="preview">{preview}</span>
            <button type="button" onClick={() => props.onPattern(DEFAULT_PATTERN)}>
              Reset
            </button>
          </div>
        </Popover>
      </div>
      <span className="preview" title={preview}>
        {preview}
      </span>

      <div className="outputbar-end">
        {doneCount > 0 && (
          <span className="status">
            {doneCount} of {fileCount} saved
          </span>
        )}
        <button type="button" className="flat" title="Activity log" onClick={props.onOpenLog}>
          <Icon name="history" />
          Activity{props.logCount > 0 ? ` (${props.logCount})` : ""}
        </button>
      </div>
    </footer>
  );
}
