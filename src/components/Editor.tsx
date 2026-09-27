import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Icon } from "./Icon";
import { Spectrogram } from "./Spectrogram";
import { fmtTime, type Action, type Analysis, type QueuedFile } from "../types";

type EditAction = Extract<Action, { kind: "cut" | "split" }>;

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

  const duration = analysis?.duration ?? 0;
  const range = action.kind === "cut" ? { start: action.start, end: action.end ?? duration } : { start: 0, end: duration };
  const markers = action.kind === "split" ? action.points : [];

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
      if (action.kind === "cut" && a.currentTime >= range.end) {
        a.pause();
        setPlaying(false);
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

  async function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
      return;
    }
    if (action.kind === "cut" && (playhead < range.start || playhead >= range.end)) seek(range.start);
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
      <article className="editor">
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
        />

        <div className="editor-bar">
          <div className="playgroup">
            <button
              type="button"
              className="circular"
              onClick={togglePlay}
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
            <div className="split-row">
              <button type="button" disabled={disabled} onClick={() => setMarkers([...markers, playhead].sort((a, b) => a - b))}>
                <Icon name="plus" />
                Add split here
              </button>
              <div className="chips">
                {markers.length === 0 && <small className="subtitle">No split points yet. Double click the picture or press the button.</small>}
                {markers.map((t, i) => (
                  <span key={`${i}-${t}`} className="chip">
                    {i + 1} · {fmtTime(t)}
                    <button
                      type="button"
                      className="flat circular"
                      aria-label="Remove"
                      disabled={disabled}
                      onClick={() => setMarkers(markers.filter((_, j) => j !== i))}
                    >
                      <Icon name="close" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <small className="hint">
          Drag the handles on the picture. Click anywhere to move the playhead.
          {action.kind === "split" ? " Double click to add a split point." : ""}
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
