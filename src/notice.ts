import type { Action } from "./types";

export interface RunResult {
  action: Action;
  /** How many files the run set out to do. */
  total: number;
  saved: { name: string; outputs: string[] }[];
  failed: { name: string }[];
  stopped: boolean;
  limitReached: boolean;
}

export interface Notice {
  ok: boolean;
  text: string;
  /** A file to show in the folder, when something was saved. */
  reveal?: string;
}

function done(action: Action, obj: string, singular: boolean, parts: number): string {
  switch (action.kind) {
    case "denoise":
      return `Removed the noise from ${obj}`;
    case "enhance":
      return `Enhanced ${obj}`;
    case "cut":
      return `Cut ${obj} and saved the clip${singular ? "" : "s"}`;
    case "split":
      return `Split ${obj} into ${parts} part${parts === 1 ? "" : "s"}`;
    case "convert":
      return `Converted ${obj} to ${action.format}`;
  }
}

function failedVerb(action: Action): string {
  switch (action.kind) {
    case "denoise":
      return "remove the noise from";
    case "enhance":
      return "enhance";
    case "cut":
      return "cut";
    case "split":
      return "split";
    case "convert":
      return "convert";
  }
}

/** Turns what happened in a run into one sentence for the ribbon. */
export function buildNotice(r: RunResult): Notice | null {
  const { action, total, saved, failed } = r;
  const quote = (n: string) => `“${n}”`;

  if (saved.length === 0) {
    if (failed.length === 0) return r.stopped ? { ok: false, text: "Stopped before anything was saved." } : null;
    const text =
      total === 1
        ? `Couldn’t ${failedVerb(action)} ${quote(failed[0].name)}. See the error in the list.`
        : `Couldn’t ${failedVerb(action)} any of the ${total} files. See the list for why.`;
    return { ok: false, text };
  }

  const all = saved.length === total;
  const obj = saved.length === 1 && total === 1 ? quote(saved[0].name) : all ? `${total} files` : `${saved.length} of ${total} files`;
  const parts = saved.reduce((n, s) => n + s.outputs.length, 0);
  let text = `${done(action, obj, saved.length === 1, parts)}.`;
  if (r.stopped) text = `Stopped. ${text}`;
  if (failed.length > 0) text += ` ${failed.length} failed, see the list.`;
  if (r.limitReached) text += " You’ve reached the weekly limit.";
  return { ok: failed.length === 0 && !r.stopped && !r.limitReached, text, reveal: saved[0].outputs[0] };
}
