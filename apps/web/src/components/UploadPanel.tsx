import { useRef, useState } from 'react';

interface Props {
  busy: boolean;
  onFile: (file: File) => void;
  onSample: () => void;
}

export function UploadPanel({ busy, onFile, onSample }: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const takeFirst = (files: FileList | null): void => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  return (
    <div
      className={`upload${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        takeFirst(e.dataTransfer.files);
      }}
    >
      <h2>Plan a race against the weather</h2>
      <p>
        Drop in the route and tell it how fast you intend to ride. You get the wind, rain and
        temperature for the place you'll actually be, at the time you'll be there — plus arrival
        times at every checkpoint.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".gpx,.tcx,.xml,application/gpx+xml"
        className="visually-hidden"
        onChange={(e) => takeFirst(e.target.files)}
      />

      <button
        type="button"
        className="button-primary"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <>
            <span className="spinner" /> Reading route…
          </>
        ) : (
          'Choose a GPX or TCX file'
        )}
      </button>

      <p className="upload-sample">
        <span className="muted">or </span>
        <button type="button" onClick={onSample} disabled={busy}>
          try it with a sample 230 km route
        </button>
      </p>
    </div>
  );
}
