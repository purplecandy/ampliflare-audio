export type Action =
  | { kind: "denoise"; strength: number }
  | { kind: "convert"; format: string; bitrate?: string }
  | { kind: "cut"; start: number; end?: number }
  | { kind: "enhance"; target_lufs: number };

export type ActionKind = Action["kind"];

export type FileStatus = "waiting" | "running" | "done" | "error";

export interface QueuedFile {
  id: string;
  path: string;
  name: string;
  status: FileStatus;
  step?: string;
  output?: string;
  error?: string;
}

export interface Tools {
  deep_filter: boolean;
  ffmpeg: string | null;
}

export interface Progress {
  id: string;
  step: string;
}

export const FORMATS = ["mp3", "wav", "m4a", "flac", "ogg", "opus"] as const;
export const BITRATES = ["128k", "192k", "256k", "320k"] as const;
