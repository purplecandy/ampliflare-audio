import { useState } from "react";
import { Icon } from "./Icon";
import { Popover } from "./Popover";
import { HELP_LINKS, SITE_URL, openLink } from "../links";

export function HelpMenu() {
  const [open, setOpen] = useState(false);

  return (
    <div className="popover-anchor">
      <button type="button" className="row" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="help" />
        <span className="row-title">Help</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} label="Help" className="help">
        <p className="section-label">Help</p>
        <nav aria-label="Help">
          {HELP_LINKS.map((l) => (
            <a
              key={l.path}
              href={SITE_URL + l.path}
              onClick={(e) => {
                e.preventDefault();
                setOpen(false);
                openLink(SITE_URL + l.path);
              }}
            >
              {l.label}
              <Icon name="open" />
            </a>
          ))}
        </nav>
      </Popover>
    </div>
  );
}
