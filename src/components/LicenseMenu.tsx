import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "./Icon";
import { Popover } from "./Popover";
import { BUY_URL, filesLeft, openBuyPage, resetDay } from "../license";
import type { LicenseStatus } from "../types";

interface Props {
  status: LicenseStatus;
  onStatus: (s: LicenseStatus) => void;
}

export function LicenseMenu({ status, onStatus }: Props) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const left = filesLeft(status);
  const resets = resetDay(status);

  async function call(command: string, args?: Record<string, unknown>) {
    setWorking(true);
    setError("");
    try {
      onStatus(await invoke<LicenseStatus>(command, args));
      setKey("");
    } catch (err) {
      setError(String(err));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="popover-anchor">
      <button type="button" className="row" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="key" />
        <span className="row-text">
          <span className="row-title">{title(status)}</span>
          <span className="row-subtitle">
            {status.source_build
              ? "Free for any use"
              : status.licensed
                ? `Key ending ${status.key_end}`
                : `${left} of ${status.limit} files left this week`}
          </span>
        </span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} label="License" className="license">
        {status.source_build ? (
          <>
            <p className="section-label">Built from source</p>
            <p>
              This copy was built from the AGPL source code, so it is free for any use, work included, with no weekly
              limit and no key.
            </p>
            <p>
              A license pays for the work and gets you the signed app with updates.{" "}
              <a
                href={BUY_URL}
                onClick={(e) => {
                  e.preventDefault();
                  openBuyPage();
                }}
              >
                Buy a license
              </a>
            </p>
          </>
        ) : status.licensed ? (
          <>
            <p className="section-label">Commercial license</p>
            <p>You can use Ampliflare Audio for work, with no weekly limit. Thank you for supporting it.</p>
            <p className="hint">
              Key ending {status.key_end}. To move it to another computer, remove it here first.
            </p>
            <button type="button" disabled={working} onClick={() => void call("deactivate_license")}>
              Remove from This Computer
            </button>
          </>
        ) : (
          <>
            <p className="section-label">Personal use</p>
            <p>
              Free for personal use, with {status.limit} files a week. You have {left} left
              {resets ? `. The count resets on ${resets}.` : "."}
            </p>
            <p>
              A license lets you use it for work and removes the limit. Pay what you can.{" "}
              <a
                href={BUY_URL}
                onClick={(e) => {
                  e.preventDefault();
                  openBuyPage();
                }}
              >
                Buy a license
              </a>
            </p>
            <form
              className="license-form"
              onSubmit={(e) => {
                e.preventDefault();
                void call("activate_license", { key });
              }}
            >
              <label htmlFor="license-key">License key</label>
              <div className="license-entry">
                <input
                  id="license-key"
                  type="text"
                  spellCheck={false}
                  autoComplete="off"
                  value={key}
                  disabled={working}
                  onChange={(e) => setKey(e.target.value)}
                />
                <button type="submit" className="suggested" disabled={working || !key.trim()}>
                  {working ? "Checking…" : "Activate"}
                </button>
              </div>
            </form>
          </>
        )}
        {error && (
          <p className="status-error" role="alert">
            {error}
          </p>
        )}
      </Popover>
    </div>
  );
}

function title(s: LicenseStatus): string {
  if (s.source_build) return "Built from source";
  return s.licensed ? "Commercial license" : "Personal use";
}
