import { useRef, useState, type ReactElement } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Icon } from "./Icon";
import { fmtTime } from "../types";

export interface AudioPlayer {
  /** Put this once in the tree. It is the one element every Player shares. */
  element: ReactElement;
  activeKey: string | null;
  /** The file being read into memory, before it can play. */
  loadingKey: string | null;
  playing: boolean;
  time: number;
  duration: number;
  /** Keys of files the webview can't decode, for example ogg on macOS. */
  unplayable: Set<string>;
  toggle: (key: string, path: string) => void;
  seek: (key: string, path: string, t: number) => void;
  stop: () => void;
}

const MIME: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  m4b: "audio/mp4",
  m4r: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  aiff: "audio/aiff",
  aif: "audio/aiff",
  aifc: "audio/aiff",
  caf: "audio/x-caf",
};

// Files read into memory, kept as blob URLs so playing them again is instant.
// The map keeps the order they were last used in, oldest first.
const cache = new Map<string, string>();
const CACHE_SIZE = 4;

/** A source that plays from memory, so seeking doesn't go back to disk. */
export async function sourceFor(path: string): Promise<string> {
  const hit = cache.get(path);
  if (hit) {
    cache.delete(path);
    cache.set(path, hit);
    return hit;
  }
  let url: string;
  try {
    const bytes = await invoke<ArrayBuffer>("read_audio", { path });
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    url = URL.createObjectURL(new Blob([bytes], { type: MIME[ext] ?? "" }));
  } catch {
    // Too big, or not readable this way. Stream it from disk instead.
    return convertFileSrc(path);
  }
  cache.set(path, url);
  while (cache.size > CACHE_SIZE) {
    const [oldPath, oldUrl] = cache.entries().next().value!;
    cache.delete(oldPath);
    URL.revokeObjectURL(oldUrl);
  }
  return url;
}

/** One shared audio element, so starting a file stops the one before it. */
export function useAudioPlayer(): AudioPlayer {
  const audioRef = useRef<HTMLAudioElement>(null);
  // Refs, not state, so clicks and seeks that land before a re-render see the latest file.
  const keyRef = useRef<string | null>(null);
  const readyRef = useRef<string | null>(null);
  const pendingRef = useRef<{ at: number; play: boolean } | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [unplayable, setUnplayable] = useState<Set<string>>(new Set());

  function markUnplayable(key: string | null) {
    if (!key) return;
    setUnplayable((prev) => new Set(prev).add(key));
    setPlaying(false);
    setLoadingKey(null);
  }

  function play() {
    const key = keyRef.current;
    audioRef.current?.play().catch(() => markUnplayable(key));
  }

  async function load(key: string, path: string, at: number, andPlay: boolean) {
    const a = audioRef.current;
    if (!a) return;
    setTime(at);
    if (keyRef.current === key) {
      if (readyRef.current === key) {
        a.currentTime = at;
        if (andPlay) play();
      } else {
        // Still loading. Remember where to start once it can.
        pendingRef.current = { at, play: andPlay || !!pendingRef.current?.play };
      }
      return;
    }
    a.pause();
    keyRef.current = key;
    readyRef.current = null;
    pendingRef.current = { at, play: andPlay };
    setActiveKey(key);
    setDuration(0);
    setLoadingKey(key);
    const src = await sourceFor(path);
    if (keyRef.current !== key) return; // Another file was picked while this one loaded.
    a.src = src;
    a.load();
  }

  function onLoadedMetadata(a: HTMLAudioElement) {
    readyRef.current = keyRef.current;
    setDuration(a.duration);
    setLoadingKey(null);
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending?.at) a.currentTime = pending.at;
    if (pending?.play) play();
  }

  function toggle(key: string, path: string) {
    const a = audioRef.current;
    if (!a) return;
    if (keyRef.current === key && readyRef.current === key) {
      if (a.paused) play();
      else a.pause();
    } else if (keyRef.current === key) {
      // Pressed again while loading: flip whether it starts when ready.
      const p = pendingRef.current ?? { at: 0, play: false };
      pendingRef.current = { ...p, play: !p.play };
    } else {
      void load(key, path, 0, true);
    }
  }

  function seek(key: string, path: string, t: number) {
    void load(key, path, t, false);
  }

  function stop() {
    const a = audioRef.current;
    keyRef.current = null;
    readyRef.current = null;
    pendingRef.current = null;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    setActiveKey(null);
    setLoadingKey(null);
    setTime(0);
    setDuration(0);
  }

  const element = (
    <audio
      ref={audioRef}
      preload="auto"
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={() => setPlaying(false)}
      onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
      onLoadedMetadata={(e) => onLoadedMetadata(e.currentTarget)}
      onError={() => keyRef.current && markUnplayable(keyRef.current)}
    />
  );

  return { element, activeKey, loadingKey, playing, time, duration, unplayable, toggle, seek, stop };
}

interface Props {
  player: AudioPlayer;
  id: string;
  path: string;
}

/** Play button, seek slider and time for one file. */
export function Player({ player, id, path }: Props) {
  // While the thumb is held, show where it is and seek only on release.
  // Seeking on every move made playback stutter and the thumb jump back.
  const [drag, setDrag] = useState<number | null>(null);
  const active = player.activeKey === id;
  const loading = player.loadingKey === id;
  const isPlaying = active && player.playing;
  const cantPlay = player.unplayable.has(id);
  const length = active && Number.isFinite(player.duration) ? player.duration : 0;
  const shown = drag ?? (active ? player.time : 0);

  function commit(t: number) {
    setDrag(null);
    player.seek(id, path, t);
  }

  return (
    <div className="row-player" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="flat circular"
        aria-label={isPlaying ? "Pause" : "Play"}
        title={cantPlay ? "This format can't be played here" : isPlaying ? "Pause" : "Play"}
        disabled={cantPlay}
        onClick={() => player.toggle(id, path)}
      >
        <Icon name={loading ? "spinner" : isPlaying ? "pause" : "play"} />
      </button>
      <input
        type="range"
        aria-label="Seek"
        min={0}
        max={length || 1}
        step={0.1}
        value={Math.min(shown, length || 1)}
        disabled={cantPlay || !length}
        onPointerDown={() => setDrag(shown)}
        onPointerUp={(e) => commit(Number(e.currentTarget.value))}
        onPointerCancel={(e) => commit(Number(e.currentTarget.value))}
        onChange={(e) => {
          const t = Number(e.target.value);
          if (drag !== null) setDrag(t);
          else commit(t); // Arrow keys
        }}
      />
      <span className="player-time">
        {active && length ? `${fmtTime(shown, 0)} / ${fmtTime(length, 0)}` : "0:00"}
      </span>
    </div>
  );
}
