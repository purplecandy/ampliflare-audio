export type Action =
  | { kind: "denoise"; strength: number }
  | { kind: "convert"; format: string; bitrate?: string }
  | { kind: "cut"; start: number; end?: number }
  | { kind: "split"; points: number[] }
  | { kind: "enhance"; target_lufs: number };

export type ActionKind = Action["kind"];

/** Cut and split work on one file with a picture of it. The rest run on the whole list. */
export const EDITOR_KINDS: ActionKind[] = ["cut", "split"];

export type FileStatus = "waiting" | "running" | "done" | "error";

export interface QueuedFile {
  id: string;
  path: string;
  name: string;
  status: FileStatus;
  step?: string;
  outputs?: string[];
  error?: string;
}

/** Where results go. "source" puts each one next to its original. */
export type SaveTo = { kind: "source" } | { kind: "folder"; path: string };

export interface Tools {
  deep_filter: boolean;
  ffmpeg: string | null;
}

export interface Progress {
  id: string;
  step: string;
}

/** Matches the Analysis struct in src-tauri/src/analyze.rs */
export interface Analysis {
  duration: number;
  steps: number;
  bins: number;
  step_seconds: number;
  spectrogram: string;
  peaks: number[];
}

export const FORMATS = ["mp3", "wav", "m4a", "flac", "ogg", "opus"] as const;
export const BITRATES = ["128k", "192k", "256k", "320k"] as const;

export function fmtTime(seconds: number, decimals = 1): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const r = decimals > 0 ? rest.toFixed(decimals).padStart(3 + decimals, "0") : String(Math.floor(rest)).padStart(2, "0");
  return `${m}:${r}`;
}
