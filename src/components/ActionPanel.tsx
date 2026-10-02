import type { ReactNode } from "react";
import type { IconName } from "./Icon";
import { BITRATES, FORMAT_GROUPS, LOSSY_FORMATS, type Action, type ActionKind } from "../types";

interface Props {
  action: Action;
  onChange: (a: Action) => void;
  disabled: boolean;
  /** Cut and split draw their editor here, under the settings. */
  children?: ReactNode;
}

export const TOOLS: { kind: ActionKind; label: string; hint: string; icon: IconName }[] = [
  { kind: "denoise", label: "Remove noise", hint: "Cleans up fans, hum, traffic and room noise.", icon: "noise" },
  { kind: "enhance", label: "Enhance", hint: "Evens out volume and drops low rumble.", icon: "enhance" },
  { kind: "cut", label: "Cut", hint: "Keeps only the part between two points.", icon: "cut" },
  { kind: "split", label: "Split", hint: "Breaks one file into pieces at the points you mark.", icon: "split" },
  { kind: "convert", label: "Convert", hint: "Changes the file format.", icon: "convert" },
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
  const hasSettings = action.kind === "denoise" || action.kind === "enhance" || action.kind === "convert";

  return (
    <>
      {hasSettings && (
        <>
          <p className="section-label">Settings</p>
          <div className="boxed-list">
            {action.kind === "denoise" && (
              <div className="row-item">
                <div className="row-text">
                  <label className="row-title" htmlFor="strength">
                    Strength
                  </label>
                  <span className="row-subtitle">100 removes as much noise as possible. Lower keeps more of the original.</span>
                </div>
                <div className="control">
                  <input
                    id="strength"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={action.strength}
                    disabled={disabled}
                    onChange={(e) => onChange({ ...action, strength: Number(e.target.value) })}
                  />
                  <span className="value">{action.strength}</span>
                </div>
              </div>
            )}

            {action.kind === "enhance" && (
              <div className="row-item">
                <div className="row-text">
                  <label className="row-title" htmlFor="lufs">
                    Target loudness
                  </label>
                  <span className="row-subtitle">Pick what the result is for.</span>
                </div>
                <div className="control">
                  <select
                    id="lufs"
                    value={action.target_lufs}
                    disabled={disabled}
                    onChange={(e) => onChange({ ...action, target_lufs: Number(e.target.value) })}
                  >
                    <option value={-14}>-14 LUFS, music streaming</option>
                    <option value={-16}>-16 LUFS, podcast</option>
                    <option value={-19}>-19 LUFS, audiobook</option>
                    <option value={-23}>-23 LUFS, broadcast</option>
                  </select>
                </div>
              </div>
            )}

            {action.kind === "convert" && (
              <>
                <div className="row-item">
                  <div className="row-text">
                    <label className="row-title" htmlFor="format">
                      Format
                    </label>
                  </div>
                  <div className="control">
                    <select id="format" value={action.format} disabled={disabled} onChange={(e) => onChange({ ...action, format: e.target.value })}>
                      {FORMAT_GROUPS.map((g) => (
                        <optgroup key={g.label} label={g.label}>
                          {g.formats.map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                </div>
                {LOSSY_FORMATS.includes(action.format) && (
                  <div className="row-item">
                    <div className="row-text">
                      <label className="row-title" htmlFor="bitrate">
                        Quality
                      </label>
                      <span className="row-subtitle">Higher sounds better and makes a bigger file.</span>
                    </div>
                    <div className="control">
                      <select
                        id="bitrate"
                        value={action.bitrate ?? "192k"}
                        disabled={disabled}
                        onChange={(e) => onChange({ ...action, bitrate: e.target.value })}
                      >
                        {BITRATES.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {children}
    </>
  );
}
