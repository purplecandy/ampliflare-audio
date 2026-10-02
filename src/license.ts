import { openUrl } from "@tauri-apps/plugin-opener";
import type { LicenseStatus } from "./types";

/* The limit and the license are kept and enforced in src-tauri/src/license.rs.
   This file only has what the window needs to talk about them. */

// TODO: point this at the site's buy box (site/ SITE_URL + "/#buy") once the
// site has an address, so people can pick their price. Until then it opens
// the checkout at the suggested $40.
export const BUY_URL = "https://checkout.dodopayments.com/buy/pdt_0NobndRz8QFm6LfKHxgdr?paymentAmount=40";

export function openBuyPage() {
  void openUrl(BUY_URL).catch(console.warn);
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
