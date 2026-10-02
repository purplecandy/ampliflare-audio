import { SITE_URL, openLink } from "./links";
import type { LicenseStatus } from "./types";

/* The limit and the license are kept and enforced in src-tauri/src/license.rs.
   This file only has what the window needs to talk about them. */

// The site's "Pay what you can" box, so people pick their own price.
export const BUY_URL = `${SITE_URL}/#buy`;

export function openBuyPage() {
  openLink(BUY_URL);
}

export function filesLeft(s: LicenseStatus): number {
  return Math.max(0, s.limit - s.used);
}

export function limitReached(s: LicenseStatus | null): boolean {
  return !!s && !s.licensed && s.used >= s.limit;
}

/** Like "Monday, Oct 6", or null before the week's first file. */
export function resetDay(s: LicenseStatus): string | null {
  if (!s.resets_at) return null;
  return new Date(s.resets_at * 1000).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}
