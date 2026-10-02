import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Icon } from "./Icon";
import { Spectrogram } from "./Spectrogram";
import { fmtTime, type Action, type Analysis, type QueuedFile } from "../types";

type EditAction = Extract<Action, { kind: "cut" | "split" }>;

/** A split closer than this to another split or an end would make a part too short to be useful. */
const MIN_PART = 0.2;

interface Props {
  file: QueuedFile | null;
  analysis: Analysis | undefined;
  loading: boolean;
  error: string | undefined;
  action: EditAction;
  onChange: (a: EditAction) => void;
  disabled: boolean;
}

export function Editor({ file, analysis, loading, error, action, onChange, disabled }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [canPlay, setCanPlay] = useState(true);
  const [evenly, setEvenly] = useState(2);
  // Playing one part stops at its end.
  const stopAtRef = useRef<number | null>(null);

  const duration = analysis?.duration ?? 0;
  const range = action.kind === "cut" ? { start: action.start, end: action.end ?? duration } : { start: 0, end: duration };
  const markers = action.kind === "split" ? action.points : [];
  const edges = [0, ...markers, duration];
  const parts = edges.slice(0, -1).map((start, i) => ({ start, end: edges[i + 1] }));
  const canSplitAt = (t: number) =>
    t >= MIN_PART && t <= duration - MIN_PART && markers.every((m) => Math.abs(m - t) >= MIN_PART);

  // New file: rewind and forget the old picture state.
  useEffect(() => {
    setPlayhead(0);
    setPlaying(false);
    setCanPlay(true);
  }, [file?.id]);

  // Follow the audio while it plays. Stop at the end of the cut range.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = audioRef.current;
      if (!a) return;
      setPlayhead(a.currentTime);
      const stopAt = action.kind === "cut" ? range.end : stopAtRef.current;
      if (stopAt !== null && a.currentTime >= stopAt) {
        a.pause();
        setPlaying(false);
        stopAtRef.current = null;
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, action.kind, range.end]);

  function seek(t: number) {
    setPlayhead(t);
    if (audioRef.current) audioRef.current.currentTime = t;
  }

  async function togglePlay(from?: { start: number; end: number }) {
    const a = audioRef.current;
    if (!a) return;
    if (playing && !from) {
      a.pause();
      setPlaying(false);
      return;
    }
    stopAtRef.current = from?.end ?? null;
    if (from) seek(from.start);
    else if (action.kind === "cut" && (playhead < range.start || playhead >= range.end)) seek(range.start);
    try {
      await a.play();
      setPlaying(true);
    } catch {
      setCanPlay(false);
    }
  }

  function setRange(r: { start: number; end: number }) {
    if (action.kind !== "cut") return;
    onChange({ kind: "cut", start: round(r.start), end: round(r.end) });
  }

  function setMarkers(points: number[]) {
    onChange({ kind: "split", points: points.map(round) });
  }

  function addSplit(t: number) {
    if (canSplitAt(t)) setMarkers([...markers, t].sort((a, b) => a - b));
  }

  function splitEvenly(n: number) {
    const count = Math.round(clamp(n, 2, 50));
    setMarkers(Array.from({ length: count - 1 }, (_, i) => (duration * (i + 1)) / count));
  }

  // Keys work while the picture has focus: Space plays, S splits, arrows nudge.
  function onKeyDown(e: React.KeyboardEvent) {
    if (!(e.target instanceof HTMLCanvasElement)) return;
    const step = e.shiftKey ? 0.1 : 1;
    if (e.key === " ") void togglePlay();
    else if (e.key === "ArrowLeft") seek(Math.max(0, playhead - step));
    else if (e.key === "ArrowRight") seek(Math.min(duration, playhead + step));
    else if ((e.key === "s" || e.key === "S") && action.kind === "split" && !disabled) addSplit(playhead);
    else return;
    e.preventDefault();
  }

  const title = action.kind === "cut" ? "Cut" : "Split";

  if (!file) {
    return (
      <>
        <p className="section-label">{title}</p>
        <article className="subtitle">Add a file and click it in the list to edit it.</article>
      </>
    );
  }
  if (error) {
    return (
      <>
        <p className="section-label">{title}</p>
        <article className="status-error">Could not read this file: {error}</article>
      </>
    );
  }
  if (loading || !analysis) {
    return (
      <>
        <p className="section-label">{title}</p>
        <article className="subtitle" aria-busy="true">
          Reading {file.name}…
        </article>
      </>
    );
  }

  return (
    <>
      <p className="section-label">{title}</p>
      <article className="editor" onKeyDown={onKeyDown}>
        <audio
          ref={audioRef}
          src={convertFileSrc(file.path)}
          preload="auto"
          onEnded={() => setPlaying(false)}
          onError={() => setCanPlay(false)}
        />

        <Spectrogram
          analysis={analysis}
          mode={action.kind}
          range={range}
          markers={markers}
          playhead={playhead}
          onRange={setRange}
          onMarkers={setMarkers}
          onSeek={seek}
          onSplit={addSplit}
          canSplit={canSplitAt(playhead)}
          disabled={disabled}
        />

        <div className="editor-bar">
          <div className="playgroup">
            <button
              type="button"
              className="circular"
              onClick={() => void togglePlay()}
              disabled={!canPlay}
              aria-label={playing ? "Pause" : "Play"}
              title={canPlay ? "" : "This format cannot be played here"}
            >
              <Icon name={playing ? "pause" : "play"} />
            </button>
            <span className="time">
              {fmtTime(playhead)} / {fmtTime(duration)}
            </span>
          </div>

          {action.kind === "cut" && (
            <>
              <label className="field">
                Start
                <input
                  type="number"
                  min={0}
                  max={range.end - 0.1}
                  step={0.1}
                  value={round(range.start)}
                  disabled={disabled}
                  onChange={(e) => setRange({ start: clamp(Number(e.target.value), 0, range.end - 0.1), end: range.end })}
                />
              </label>
              <label className="field">
                End
                <input
                  type="number"
                  min={range.start + 0.1}
                  max={duration}
                  step={0.1}
                  value={round(range.end)}
                  disabled={disabled}
                  onChange={(e) => setRange({ start: range.start, end: clamp(Number(e.target.value), range.start + 0.1, duration) })}
                />
              </label>
              <div role="group">
                <button type="button" disabled={disabled} onClick={() => setRange({ start: Math.min(playhead, range.end - 0.1), end: range.end })}>
                  Start here
                </button>
                <button type="button" disabled={disabled} onClick={() => setRange({ start: range.start, end: Math.max(playhead, range.start + 0.1) })}>
                  End here
                </button>
              </div>
            </>
          )}

          {action.kind === "split" && (
            <form
              className="split-evenly"
              onSubmit={(e) => {
                e.preventDefault();
                splitEvenly(evenly);
              }}
            >
              <label htmlFor="split-count">Split evenly into</label>
              <input
                id="split-count"
                type="number"
                min={2}
                max={50}
                value={evenly}
                disabled={disabled}
                onChange={(e) => setEvenly(Number(e.target.value))}
              />
              <span>parts</span>
              <button type="submit" disabled={disabled}>
                Split
              </button>
            </form>
          )}
        </div>

        {action.kind === "split" && (
          <ol className="parts" aria-label="Parts">
            {parts.map((p, i) => (
              <li key={`${i}-${p.start}`}>
                <button
                  type="button"
                  className="flat circular"
                  aria-label={`Play part ${i + 1}`}
                  disabled={!canPlay}
                  onClick={() => void togglePlay(p)}
                >
                  <Icon name="play" />
                </button>
                <span className="part-name">Part {i + 1}</span>
                <span className="part-time">
                  {fmtTime(p.start)} – {fmtTime(p.end)}
                </span>
                <span className="part-length">{fmtTime(p.end - p.start)}</span>
                {i < parts.length - 1 && (
                  <button type="button" className="flat" disabled={disabled} onClick={() => setMarkers(markers.filter((_, j) => j !== i))}>
                    Join with next
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}

        <small className="hint">
          {action.kind === "split"
            ? "Click the picture to move the playhead, then press Split here or S. Drag a round handle to move a split. Space plays."
            : "Drag the handles on the picture. Click anywhere to move the playhead."}
        </small>
      </article>
    </>
  );
}

function round(t: number): number {
  return Math.round(t * 100) / 100;
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}
