import { Icon } from "./Icon";

interface Props {
  active: boolean;
  onPick: () => void;
  /** A thin strip under the file list instead of the big empty page. */
  compact?: boolean;
}

export function DropZone({ active, onPick, compact }: Props) {
  if (compact) {
    return (
      <button type="button" className={`dropstrip ${active ? "active" : ""}`} onClick={onPick}>
        <Icon name="plus" />
        Drop more files here or click to add
      </button>
    );
  }

  return (
    <div className="status-page">
      <Icon name="noise" className="status-icon" />
      <h2>Drop audio files here</h2>
      <p>Everything runs on this computer. Nothing leaves your machine. wav, mp3, m4a, flac, ogg and more.</p>
      <button type="button" className="suggested pill" onClick={onPick}>
        Open Files…
      </button>
    </div>
  );
}
