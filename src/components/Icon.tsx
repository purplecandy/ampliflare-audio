import type { ReactElement, SVGProps } from "react";

export type IconName =
  | "plus"
  | "folder"
  | "trash"
  | "noise"
  | "enhance"
  | "cut"
  | "split"
  | "convert"
  | "play"
  | "pause"
  | "stop"
  | "close"
  | "open"
  | "check"
  | "warning"
  | "spinner"
  | "palette"
  | "reveal"
  | "braces"
  | "key";

/* Small symbolic icons in the GNOME style. All on a 16px grid. */
const SHAPES: Record<IconName, ReactElement> = {
  plus: <path d="M8 3v10M3 8h10" />,
  folder: <path d="M2 5a1.5 1.5 0 0 1 1.5-1.5h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6.5v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />,
  trash: <path d="M3 4.5h10M6.2 4.5V3h3.6v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7.2v3.8M9.2 7.2v3.8" />,
  noise: <path d="M1.5 8h1.8l1.4-3.5L7 12l2-8 1.5 6 1.2-2h2.8" />,
  enhance: (
    <>
      <path d="M7 3.2l1.3 3.5L11.8 8l-3.5 1.3L7 12.8 5.7 9.3 2.2 8l3.5-1.3z" />
      <path d="M12.5 2v2.4M11.3 3.2h2.4" />
    </>
  ),
  cut: (
    <>
      <circle cx="4.5" cy="11.5" r="2" />
      <circle cx="11.5" cy="11.5" r="2" />
      <path d="M6 10.2 12.5 2.5M10 10.2 3.5 2.5" />
    </>
  ),
  split: (
    <>
      <path d="M8 2v12" strokeDasharray="2 1.6" />
      <rect x="2" y="4.5" width="3.5" height="7" rx="1" />
      <rect x="10.5" y="4.5" width="3.5" height="7" rx="1" />
    </>
  ),
  convert: <path d="M3 7a5 5 0 0 1 8.6-3.2M12 2.2v2.6H9.4M13 9a5 5 0 0 1-8.6 3.2M4 13.8v-2.6h2.6" />,
  play: <path d="M4.5 2.8v10.4L13 8z" fill="currentColor" stroke="none" />,
  pause: <path d="M5 3v10M11 3v10" strokeWidth={2.4} />,
  stop: <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" />,
  close: <path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" />,
  open: <path d="M4.5 11.5l7-7M6 4.5h5.5V10" />,
  check: <path d="M3 8.5l3.2 3.2L13 5" />,
  warning: (
    <>
      <path d="M8 2.5L14.5 13.5H1.5z" />
      <path d="M8 6.5v3.2M8 12h.01" strokeWidth={1.8} />
    </>
  ),
  spinner: (
    <>
      <circle cx="8" cy="8" r="5.5" opacity={0.25} />
      <path d="M13.5 8a5.5 5.5 0 0 0-5.5-5.5" />
    </>
  ),
  palette: (
    <>
      <path d="M8 2a6 6 0 1 0 0 12c1 0 1.4-.7 1.1-1.5-.4-1 .3-2 1.4-2H12a2 2 0 0 0 2-2A6 6 0 0 0 8 2z" />
      <circle cx="5" cy="7.5" r="0.6" fill="currentColor" />
      <circle cx="7.5" cy="4.8" r="0.6" fill="currentColor" />
      <circle cx="10.6" cy="5.8" r="0.6" fill="currentColor" />
    </>
  ),
  reveal: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M6.8 5.3 9.5 8l-2.7 2.7" />
    </>
  ),
  key: (
    <>
      <circle cx="5.5" cy="10.5" r="3" />
      <path d="M7.7 8.3 13.5 2.5M11.2 4.8l1.8 1.8M12.8 3.2l1.4 1.4" />
    </>
  ),
  braces: <path d="M6 2.5c-1.4 0-2 .6-2 1.9v1.4c0 1-.5 1.7-1.5 2.2 1 .5 1.5 1.2 1.5 2.2v1.4c0 1.3.6 1.9 2 1.9M10 2.5c1.4 0 2 .6 2 1.9v1.4c0 1 .5 1.7 1.5 2.2-1 .5-1.5 1.2-1.5 2.2v1.4c0 1.3-.6 1.9-2 1.9" />,
};

interface Props extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 16, className = "", ...rest }: Props) {
  const spin = name === "spinner" ? " spin" : "";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`icon${spin} ${className}`.trim()}
      {...rest}
    >
      {SHAPES[name]}
    </svg>
  );
}
