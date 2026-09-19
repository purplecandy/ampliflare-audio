interface Props {
  active: boolean;
  onPick: () => void;
}

export function DropZone({ active, onPick }: Props) {
  return (
    <article className={`dropzone ${active ? "active" : ""}`} onClick={onPick} tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick()}>
      <strong>Drop audio files here</strong>
      <br />
      <small>or click to choose. wav, mp3, m4a, flac, ogg</small>
    </article>
  );
}
