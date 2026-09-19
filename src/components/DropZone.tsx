interface Props {
  active: boolean;
  onPick: () => void;
}

export function DropZone({ active, onPick }: Props) {
  return (
    <button type="button" className={`dropzone ${active ? "dropzone-active" : ""}`} onClick={onPick}>
      <span className="dropzone-icon">🎧</span>
      <span className="dropzone-title">Drop audio files here</span>
      <span className="dropzone-sub">or click to choose. wav, mp3, m4a, flac, ogg</span>
    </button>
  );
}
