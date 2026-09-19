import { BITRATES, FORMATS, type Action, type ActionKind } from "../types";

interface Props {
  action: Action;
  onChange: (a: Action) => void;
  disabled: boolean;
}

const TABS: { kind: ActionKind; label: string; hint: string }[] = [
  { kind: "denoise", label: "Remove noise", hint: "Cleans up fans, hum, traffic and room noise" },
  { kind: "enhance", label: "Enhance", hint: "Evens out volume and drops low rumble" },
  { kind: "cut", label: "Cut", hint: "Keeps only the part between two times" },
  { kind: "convert", label: "Convert", hint: "Changes the file format" },
];

function defaultFor(kind: ActionKind): Action {
  switch (kind) {
    case "denoise":
      return { kind, strength: 100 };
    case "enhance":
      return { kind, target_lufs: -16 };
    case "cut":
      return { kind, start: 0 };
    case "convert":
      return { kind, format: "mp3", bitrate: "192k" };
  }
}

function num(v: string): number | undefined {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

export function ActionPanel({ action, onChange, disabled }: Props) {
  const tab = TABS.find((t) => t.kind === action.kind)!;

  return (
    <section className="panel">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.kind}
            type="button"
            role="tab"
            aria-selected={t.kind === action.kind}
            className={`tab ${t.kind === action.kind ? "tab-active" : ""}`}
            disabled={disabled}
            onClick={() => onChange(defaultFor(t.kind))}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="hint">{tab.hint}</p>

      <div className="options">
        {action.kind === "denoise" && (
          <label>
            Strength <strong>{action.strength}</strong>
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
              <option value={-14}>-14 LUFS (music streaming)</option>
              <option value={-16}>-16 LUFS (podcast)</option>
              <option value={-19}>-19 LUFS (audiobook)</option>
              <option value={-23}>-23 LUFS (broadcast)</option>
            </select>
          </label>
        )}

        {action.kind === "cut" && (
          <div className="row">
            <label>
              Start (seconds)
              <input
                type="number"
                min={0}
                step={0.1}
                value={action.start}
                disabled={disabled}
                onChange={(e) => onChange({ ...action, start: num(e.target.value) ?? 0 })}
              />
            </label>
            <label>
              End (seconds, blank for end of file)
              <input
                type="number"
                min={0}
                step={0.1}
                value={action.end ?? ""}
                disabled={disabled}
                onChange={(e) => onChange({ ...action, end: num(e.target.value) })}
              />
            </label>
          </div>
        )}

        {action.kind === "convert" && (
          <div className="row">
            <label>
              Format
              <select
                value={action.format}
                disabled={disabled}
                onChange={(e) => onChange({ ...action, format: e.target.value })}
              >
                {FORMATS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </label>
            {["mp3", "m4a", "ogg", "opus"].includes(action.format) && (
              <label>
                Quality
                <select
                  value={action.bitrate ?? "192k"}
                  disabled={disabled}
                  onChange={(e) => onChange({ ...action, bitrate: e.target.value })}
                >
                  {BITRATES.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
