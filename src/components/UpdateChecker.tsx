import { useCallback, useEffect, useRef, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { SITE_URL, openLink } from "../links";

type CheckResult = "available" | "current" | "error";

let checkNow: (() => Promise<CheckResult>) | null = null;

/** The site's notes for a version: 1.2.0 is /docs/releases/1-2-0/. A pre-release has none, so it gets the newest. */
function notesUrl(version: string): string {
  const page = /^\d+\.\d+\.\d+$/.test(version) ? version.split(".").join("-") : "latest";
  return `${SITE_URL}/docs/releases/${page}/`;
}

export function checkForUpdates(): Promise<CheckResult> {
  return checkNow?.() ?? Promise.resolve("error");
}

export function UpdateChecker() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);
  const [finished, setFinished] = useState(false);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const checkedRef = useRef(false);
  const pendingRef = useRef<Promise<CheckResult> | null>(null);

  const runCheck = useCallback((manual: boolean): Promise<CheckResult> => {
    if (!("__TAURI_INTERNALS__" in window) || import.meta.env.DEV) {
      return Promise.resolve("error");
    }
    if (pendingRef.current) return pendingRef.current;
    checkedRef.current = true;
    const pending = (async (): Promise<CheckResult> => {
      try {
        const found = await check();
        if (found) {
          setUpdate(found);
          setError(null);
          return "available";
        }
        if (manual) setUpdate(null);
        return "current";
      } catch (err) {
        if (!manual) console.warn("Update check failed:", err);
        return "error";
      }
    })();
    pendingRef.current = pending;
    void pending.finally(() => {
      pendingRef.current = null;
    });
    return pending;
  }, []);

  useEffect(() => {
    checkNow = () => runCheck(true);
    const timer = window.setTimeout(() => {
      if (!checkedRef.current) void runCheck(false);
    }, 4000);
    return () => {
      window.clearTimeout(timer);
      checkNow = null;
    };
  }, [runCheck]);

  async function install() {
    if (!update || installing) return;
    setInstalling(true);
    setFinished(false);
    setDownloaded(0);
    setTotal(undefined);
    setError(null);
    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            setTotal(event.data.contentLength);
            setDownloaded(0);
            break;
          case "Progress":
            setDownloaded((n) => n + event.data.chunkLength);
            break;
          case "Finished":
            setFinished(true);
            break;
        }
      });
      await relaunch();
    } catch (err) {
      setError(String(err));
      setInstalling(false);
    }
  }

  if (!update) return null;
  const whatsNew = notesUrl(update.version);

  return (
    <div className="banner" role="status">
      <span className="row-text">
        <strong>Version {update.version} is ready</strong>
        <a
          href={whatsNew}
          className="row-subtitle"
          onClick={(e) => {
            e.preventDefault();
            openLink(whatsNew);
          }}
        >
          What's new in {update.version}
        </a>
        {installing && (
          <>
            <span className="row-subtitle">{finished ? "Installing..." : "Downloading..."}</span>
            <progress
              value={finished ? 1 : total ? Math.min(downloaded, total) : undefined}
              max={finished ? 1 : total}
            />
          </>
        )}
        {error && (
          <span className="status-error">
            {error} {" "}
            <a href={`${SITE_URL}/`} onClick={(e) => {
              e.preventDefault();
              openLink(e.currentTarget.href);
            }}>
              Download it from the website
            </a>
          </span>
        )}
      </span>
      {!installing && (
        <>
          <button type="button" className="suggested" onClick={install}>Install and restart</button>
          <button type="button" onClick={() => setUpdate(null)}>Later</button>
        </>
      )}
    </div>
  );
}
