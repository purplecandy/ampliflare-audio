import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ActionKind } from "./types";

/* Choices that stay between launches. They live in the webview's localStorage,
   which can be missing or full, so every read and write is allowed to fail. */

export function load<T>(key: string, fallback: T, ok: (v: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(`ampliflare.${key}`);
    if (raw === null) return fallback;
    const value: unknown = JSON.parse(raw);
    return ok(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(`ampliflare.${key}`, JSON.stringify(value));
  } catch {
    // Nothing to do. The choice just won't be remembered.
  }
}

/* Appearance. index.html sets the same attributes before the page draws,
   so keep the two in step. theme.css reads them. */

export type Style = "mac" | "gnome";
export type Scheme = "system" | "light" | "dim" | "dark";

export interface Appearance {
  style: Style;
  scheme: Scheme;
  accent: string;
}

export const STYLES: { id: Style; label: string }[] = [
  { id: "mac", label: "macOS" },
  { id: "gnome", label: "GNOME" },
];

export const SCHEMES: { id: Scheme; label: string }[] = [
  { id: "system", label: "Auto" },
  { id: "light", label: "Light" },
  { id: "dim", label: "Dim" },
  { id: "dark", label: "Dark" },
];

/** The colour is only for the swatch. theme.css has the real values. */
export const ACCENTS: { id: string; label: string; color: string }[] = [
  { id: "blue", label: "Blue", color: "#0a64d6" },
  { id: "purple", label: "Purple", color: "#7d3cc8" },
  { id: "pink", label: "Pink", color: "#c2366e" },
  { id: "red", label: "Red", color: "#d12f2f" },
  { id: "orange", label: "Orange", color: "#b85a00" },
  { id: "green", label: "Green", color: "#1f8a3b" },
  { id: "graphite", label: "Graphite", color: "#6e6e73" },
];

const IS_MAC = navigator.userAgent.includes("Mac");

const DEFAULT_APPEARANCE: Appearance = {
  style: IS_MAC ? "mac" : "gnome",
  scheme: "system",
  accent: "blue",
};

function isAppearance(v: unknown): boolean {
  const a = v as Appearance;
  return (
    typeof v === "object" &&
    v !== null &&
    STYLES.some((s) => s.id === a.style) &&
    SCHEMES.some((s) => s.id === a.scheme) &&
    ACCENTS.some((c) => c.id === a.accent)
  );
}

/** For AMPLIFLARE_DEV_LOOK: save a look like "mac/dark/blue". True if it changed. */
export function saveDevLook(look: string): boolean {
  const [style, scheme, accent = "blue"] = look.split("/");
  const next = { style, scheme, accent };
  if (!isAppearance(next)) return false;
  const now = load("appearance", DEFAULT_APPEARANCE, isAppearance);
  if (now.style === style && now.scheme === scheme && now.accent === accent) return false;
  save("appearance", next);
  return true;
}

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function applyAppearance(a: Appearance) {
  const scheme = a.scheme === "system" ? (darkQuery.matches ? "dark" : "light") : a.scheme;
  const root = document.documentElement.dataset;
  root.style = a.style;
  root.accent = a.accent;
  root.scheme = scheme;
  // Pico only knows light and dark. Dim is a dark theme with softer greys.
  root.theme = scheme === "light" ? "light" : "dark";
  // The title bar belongs to the system, so tell it too. null follows the system.
  if ("__TAURI_INTERNALS__" in window) {
    const theme = a.scheme === "system" ? null : scheme === "light" ? "light" : "dark";
    void getCurrentWindow().setTheme(theme).catch(console.warn);
  }
}

export function useAppearance(): [Appearance, (a: Appearance) => void] {
  const [appearance, setAppearance] = useState(() => load("appearance", DEFAULT_APPEARANCE, isAppearance));

  useEffect(() => {
    applyAppearance(appearance);
    save("appearance", appearance);
    if (appearance.scheme !== "system") return;
    const follow = () => applyAppearance(appearance);
    darkQuery.addEventListener("change", follow);
    return () => darkQuery.removeEventListener("change", follow);
  }, [appearance]);

  return [appearance, setAppearance];
}

/* File names. The real naming happens in render_name in src-tauri/src/jobs.rs.
   This copy only draws the preview, so keep the two in step. */

export const DEFAULT_PATTERN = "{name}-{tool}";

export const TOKENS: { token: string; label: string; meaning: string }[] = [
  { token: "{name}", label: "Name", meaning: "The original file name" },
  { token: "{tool}", label: "Tool", meaning: "clean, enhanced, cut or part1" },
  { token: "{n}", label: "Number", meaning: "1, 2, 3… for split parts or a taken name" },
  { token: "{date}", label: "Date", meaning: "Today, like 2026-09-29" },
];

/** Swap every copy of `from` for `to`. */
function swap(s: string, from: string, to: string): string {
  return s.split(from).join(to);
}

const TOOL_WORD: Record<ActionKind, string> = {
  denoise: "clean",
  enhance: "enhanced",
  cut: "cut",
  split: "part1",
  convert: "",
};

/** Put today's date in. The backend fills in everything else. */
export function fillDate(pattern: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return swap(pattern, "{date}", `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
}

export function previewName(pattern: string, fileName: string, kind: ActionKind, ext: string): string {
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  let p = fillDate(pattern.trim() ? pattern : DEFAULT_PATTERN);
  // Like output_path: a pattern with {n} starts counting at 1.
  let n: string | null = p.includes("{n}") ? "1" : null;
  if (kind === "split") {
    if (!p.includes("{n}") && !p.includes("{tool}")) p += "-{n}";
    n = "1";
  }
  const tool = TOOL_WORD[kind];
  for (const [token, empty] of [
    ["{tool}", tool === ""],
    ["{n}", n === null],
  ] as const) {
    if (!empty) continue;
    for (const sep of ["-", "_", " ", "."]) p = swap(swap(p, sep + token, ""), token + sep, "");
  }
  const name = swap(swap(swap(p, "{name}", stem), "{tool}", tool), "{n}", n ?? "").replace(/[/\\:\p{Cc}]/gu, "-");
  return `${name.trim() ? name : stem}.${ext}`;
}
