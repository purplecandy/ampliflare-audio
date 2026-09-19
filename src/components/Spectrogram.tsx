import { useEffect, useMemo, useRef, useState } from "react";
import { fmtTime, type Analysis } from "../types";

interface Props {
  analysis: Analysis;
  mode: "cut" | "split";
  range: { start: number; end: number };
  markers: number[];
  playhead: number;
  onRange: (r: { start: number; end: number }) => void;
  onMarkers: (m: number[]) => void;
  onSeek: (t: number) => void;
}

const HEIGHT = 240;
const WAVE_H = 36;
const RULER_H = 18;
const GRAB_PX = 8;
const MIN_GAP = 0.1;

/** Dark purple through orange to pale yellow, like the magma map. */
const STOPS: [number, number, number][] = [
  [8, 6, 30],
  [70, 15, 115],
  [180, 55, 120],
  [252, 137, 97],
  [252, 253, 191],
];

const LUT: Uint8ClampedArray = (() => {
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const pos = (i / 255) * (STOPS.length - 1);
    const a = Math.floor(pos);
    const b = Math.min(STOPS.length - 1, a + 1);
    const f = pos - a;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = STOPS[a][c] + (STOPS[b][c] - STOPS[a][c]) * f;
  }
  return out;
})();

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function tickStep(duration: number, width: number): number {
  const candidates = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
  const minPx = 70;
  for (const c of candidates) if ((c / duration) * width >= minPx) return c;
  return 3600;
}

export function Spectrogram({ analysis, mode, range, markers, playhead, onRange, onMarkers, onSeek }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ kind: "start" | "end" | "marker"; index: number } | null>(null);
  const [cursor, setCursor] = useState("pointer");
  const [width, setWidth] = useState(0);

  // The picture itself is drawn once into an offscreen canvas at one pixel per step and band.
  const image = useMemo(() => {
    const { steps, bins } = analysis;
    const data = decode(analysis.spectrogram);
    const off = document.createElement("canvas");
    off.width = steps;
    off.height = bins;
    const ctx = off.getContext("2d")!;
    const img = ctx.createImageData(steps, bins);
    for (let x = 0; x < steps; x++) {
      for (let b = 0; b < bins; b++) {
        const v = data[x * bins + b];
        const y = bins - 1 - b; // low frequencies at the bottom
        const o = (y * steps + x) * 4;
        img.data[o] = LUT[v * 3];
        img.data[o + 1] = LUT[v * 3 + 1];
        img.data[o + 2] = LUT[v * 3 + 2];
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return off;
  }, [analysis]);

  useEffect(() => {
    const el = canvasRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const duration = analysis.duration;
  const toX = (t: number) => (t / duration) * width;
  const toT = (x: number) => Math.min(duration, Math.max(0, (x / width) * duration));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(HEIGHT * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    const specH = HEIGHT - WAVE_H - RULER_H;
    const style = getComputedStyle(canvas);
    const accent = style.getPropertyValue("--pico-primary").trim() || "#7c6cff";
    const fg = style.getPropertyValue("--pico-color").trim() || "#ddd";
    const muted = style.getPropertyValue("--pico-muted-color").trim() || "#888";

    // Spectrogram
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, 0, 0, width, specH);

    // Waveform strip
    const waveTop = specH;
    ctx.fillStyle = "rgba(127,127,127,0.12)";
    ctx.fillRect(0, waveTop, width, WAVE_H);
    ctx.fillStyle = muted;
    const mid = waveTop + WAVE_H / 2;
    const perPx = analysis.peaks.length / width;
    for (let x = 0; x < width; x++) {
      const a = Math.floor(x * perPx);
      const b = Math.max(a + 1, Math.floor((x + 1) * perPx));
      let p = 0;
      for (let i = a; i < b && i < analysis.peaks.length; i++) p = Math.max(p, analysis.peaks[i]);
      const h = Math.max(1, p * (WAVE_H / 2 - 2));
      ctx.fillRect(x, mid - h, 1, h * 2);
    }

    // Time ruler
    const rulerTop = HEIGHT - RULER_H;
    ctx.fillStyle = muted;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textBaseline = "top";
    const step = tickStep(duration, width);
    for (let t = 0; t <= duration; t += step) {
      const x = Math.round(toX(t));
      ctx.fillRect(x, rulerTop, 1, 4);
      ctx.fillText(fmtTime(t, step < 1 ? 1 : 0), x + 3, rulerTop + 5);
    }

    // Selection or markers
    if (mode === "cut") {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, toX(range.start), rulerTop);
      ctx.fillRect(toX(range.end), 0, width - toX(range.end), rulerTop);
      for (const t of [range.start, range.end]) {
        const x = Math.round(toX(t));
        ctx.fillStyle = accent;
        ctx.fillRect(x - 1, 0, 2, rulerTop);
        ctx.fillRect(x - 5, 0, 10, 14);
      }
    } else {
      markers.forEach((t, i) => {
        const x = Math.round(toX(t));
        ctx.fillStyle = accent;
        ctx.fillRect(x - 1, 0, 2, rulerTop);
        ctx.beginPath();
        ctx.moveTo(x - 7, 0);
        ctx.lineTo(x + 7, 0);
        ctx.lineTo(x, 10);
        ctx.fill();
        ctx.fillStyle = fg;
        ctx.font = "bold 10px system-ui, sans-serif";
        ctx.fillText(String(i + 1), x + 5, 12);
      });
    }

    // Playhead
    const px = Math.round(toX(playhead));
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(px, 0, 1, rulerTop);
  }, [image, width, mode, range, markers, playhead, duration, analysis.peaks]);

  function hit(x: number): { kind: "start" | "end" | "marker"; index: number } | null {
    if (mode === "cut") {
      if (Math.abs(x - toX(range.end)) <= GRAB_PX) return { kind: "end", index: 0 };
      if (Math.abs(x - toX(range.start)) <= GRAB_PX) return { kind: "start", index: 0 };
      return null;
    }
    let best = -1;
    let bestD = GRAB_PX + 1;
    markers.forEach((t, i) => {
      const d = Math.abs(x - toX(t));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best >= 0 ? { kind: "marker", index: best } : null;
  }

  function localX(e: React.PointerEvent<HTMLCanvasElement>): number {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX - r.left;
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const x = localX(e);
    const h = hit(x);
    if (h) {
      dragRef.current = h;
      e.currentTarget.setPointerCapture(e.pointerId);
    } else {
      onSeek(toT(x));
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const x = localX(e);
    const drag = dragRef.current;
    if (!drag) {
      setCursor(hit(x) ? "col-resize" : "pointer");
      return;
    }
    const t = toT(x);
    if (drag.kind === "start") onRange({ start: Math.min(t, range.end - MIN_GAP), end: range.end });
    else if (drag.kind === "end") onRange({ start: range.start, end: Math.max(t, range.start + MIN_GAP) });
    else {
      const next = markers.slice();
      next[drag.index] = t;
      onMarkers(next);
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (dragRef.current) {
      dragRef.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
      if (mode === "split") onMarkers(markers.slice().sort((a, b) => a - b));
    }
  }

  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (mode !== "split") return;
    const r = e.currentTarget.getBoundingClientRect();
    const t = toT(e.clientX - r.left);
    onMarkers([...markers, t].sort((a, b) => a - b));
  }

  return (
    <div className="spectrogram">
      <canvas
        ref={canvasRef}
        style={{ height: HEIGHT, cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      />
    </div>
  );
}
