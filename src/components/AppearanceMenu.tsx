import { useState, type CSSProperties } from "react";
import { Icon } from "./Icon";
import { Popover } from "./Popover";
import { ACCENTS, SCHEMES, STYLES, useAppearance } from "../settings";

export function AppearanceMenu() {
  const [open, setOpen] = useState(false);
  const [a, setA] = useAppearance();

  return (
    <div className="popover-anchor">
      <button type="button" className="row" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="palette" />
        <span className="row-title">Appearance</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} label="Appearance">
        <p className="section-label">Style</p>
        <div className="segmented" role="radiogroup" aria-label="Style">
          {STYLES.map((s) => (
            <label key={s.id}>
              <input type="radio" name="style" checked={a.style === s.id} onChange={() => setA({ ...a, style: s.id })} />
              {s.label}
            </label>
          ))}
        </div>

        <p className="section-label">Colours</p>
        <div className="segmented" role="radiogroup" aria-label="Colours">
          {SCHEMES.map((s) => (
            <label key={s.id}>
              <input type="radio" name="scheme" checked={a.scheme === s.id} onChange={() => setA({ ...a, scheme: s.id })} />
              {s.label}
            </label>
          ))}
        </div>

        <p className="section-label">Accent</p>
        <div className="swatches" role="radiogroup" aria-label="Accent">
          {ACCENTS.map((c) => (
            <label key={c.id} title={c.label} style={{ "--swatch": c.color } as CSSProperties}>
              <input
                type="radio"
                name="accent"
                aria-label={c.label}
                checked={a.accent === c.id}
                onChange={() => setA({ ...a, accent: c.id })}
              />
            </label>
          ))}
        </div>
      </Popover>
    </div>
  );
}
