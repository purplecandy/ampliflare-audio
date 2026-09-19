import type { ReactNode } from "react";
import { BITRATES, FORMATS, type Action, type ActionKind } from "../types";

interface Props {
  action: Action;
  onChange: (a: Action) => void;
  disabled: boolean;
  /** Cut and split draw their controls here, under the tabs. */
  children?: ReactNode;
}

const TABS: { kind: ActionKind; label: string; hint: string }[] = [
  { kind: "denoise", label: "Remove noise", hint: "Cleans up fans, hum, traffic and room noise." },
  { kind: "enhance", label: "Enhance", hint: "Evens out volume and drops low rumble." },
  { kind: "cut", label: "Cut", hint: "Keeps only the part between two points." },
  { kind: "split", label: "Split", hint: "Breaks one file into pieces at the points you mark." },
  { kind: "convert", label: "Convert", hint: "Changes the file format." },
];

export function defaultAction(kind: ActionKind): Action {
  switch (kind) {
    case "denoise":
      return { kind, strength: 100 };
    case "enhance":
      return { kind, target_lufs: -16 };
    case "cut":
      return { kind, start: 0 };
    case "split":
      return { kind, points: [] };
    case "convert":
      return { kind, format: "mp3", bitrate: "192k" };
  }
}

export function ActionPanel({ action, onChange, disabled, children }: Props) {
  const tab = TABS.find((t) => t.kind === action.kind)!;

  return (
    <article className="tight">
      <div role="group" className="tabs">
        {TABS.map((t) => (
          <button
            key={t.kind}
            type="button"
            className={t.kind === action.kind ? "" : "outline secondary"}
            aria-pressed={t.kind === action.kind}
            disabled={disabled}
            onClick={() => t.kind !== action.kind && onChange(defaultAction(t.kind))}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="muted hint">{tab.hint}</p>

      {action.kind === "denoise" && (
        <label>
          Strength: <strong>{action.strength}</strong>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={action.strength}
            disabled={disabled}
            onChange={(e) => onChange({ ...action, strength: Number(e.target.value) })}
          />
          <small>100 removes as much noise as possible. Lower keeps more of the original sound.</small>
        </label>
      )}

      {action.kind === "enhance" && (
        <label>
          Target loudness
          <select
            value={action.target_lufs}
            disabled={disabled}
            onChange={(e) => onChange({ ...action, target_lufs: Number(e.target.value) })}
          >
            <option value={-14}>-14 LUFS, music streaming</option>
            <option value={-16}>-16 LUFS, podcast</option>
            <option value={-19}>-19 LUFS, audiobook</option>
            <option value={-23}>-23 LUFS, broadcast</option>
          </select>
        </label>
      )}

      {action.kind === "convert" && (
        <div className="grid">
          <label>
            Format
            <select value={action.format} disabled={disabled} onChange={(e) => onChange({ ...action, format: e.target.value })}>
              {FORMATS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>
          {["mp3", "m4a", "ogg", "opus"].includes(action.format) ? (
            <label>
              Quality
              <select value={action.bitrate ?? "192k"} disabled={disabled} onChange={(e) => onChange({ ...action, bitrate: e.target.value })}>
                {BITRATES.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </label>
          ) : (
            <div />
          )}
        </div>
      )}

      {children}
    </article>
  );
}
