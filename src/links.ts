import { openUrl } from "@tauri-apps/plugin-opener";

/** The app's website, from site/ in this repo. Installed apps link here, so it must not move. */
export const SITE_URL = "https://ampliflare.purplecandy.dev";

export const HELP_LINKS: { label: string; path: string }[] = [
  { label: "Website", path: "/" },
  { label: "Getting started", path: "/docs/" },
  { label: "Troubleshoot", path: "/docs/troubleshoot/" },
  { label: "Personal and commercial use", path: "/docs/license/" },
];

/** Links open in the browser, not in the app's own window. */
export function openLink(url: string) {
  void openUrl(url).catch(console.warn);
}
