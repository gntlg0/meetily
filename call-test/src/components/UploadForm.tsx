'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { LANGUAGE_MODES, LANGUAGE_MODE_LABELS } from '@/lib/language';
import { ALLOWED_EXTENSIONS } from '@/lib/storage.client';
import type { LanguageMode } from '@/lib/types';

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [languageMode, setLanguageMode] = useState<LanguageMode>('mn');
  const [numSpeakers, setNumSpeakers] = useState(2);
  const [note, setNote] = useState('');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;

    setBusy(true);
    setError(null);

    const body = new FormData();
    body.append('file', file);
    body.append('languageMode', languageMode);
    body.append('numSpeakers', String(numSpeakers));
    body.append('note', note);

    try {
      const res = await fetch('/api/calls', { method: 'POST', body });
      const json = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? `Upload failed (${res.status})`);
      router.push(`/calls/${json.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <fieldset>
        <legend>Upload a call recording</legend>

        <div
          className={`dropzone ${over ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) setFile(dropped);
          }}
          onClick={() => inputRef.current?.click()}
        >
          {file ? (
            <strong>{file.name}</strong>
          ) : (
            <span>Drag &amp; drop audio here, or click to pick a file</span>
          )}
          <div className="muted">{ALLOWED_EXTENSIONS.join(' ')}</div>
          <input
            ref={inputRef}
            type="file"
            hidden
            accept={ALLOWED_EXTENSIONS.join(',')}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <div className="row">
          <div>
            <label htmlFor="lang">Language mode</label>
            <select
              id="lang"
              value={languageMode}
              onChange={(e) => setLanguageMode(e.target.value as LanguageMode)}
            >
              {LANGUAGE_MODES.map((m) => (
                <option key={m} value={m}>
                  {LANGUAGE_MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="spk">Expected speakers</label>
            <input
              id="spk"
              type="number"
              min={1}
              max={32}
              value={numSpeakers}
              onChange={(e) => setNumSpeakers(Number(e.target.value))}
              style={{ width: '6rem' }}
            />
          </div>

          <div style={{ flex: 1, minWidth: '18rem' }}>
            <label htmlFor="note">Note (optional)</label>
            <input
              id="note"
              type="text"
              placeholder="Mobicom→Unitel test"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <p>
          <button type="submit" disabled={!file || busy}>
            {busy ? 'Uploading…' : 'Upload & transcribe'}
          </button>
        </p>

        {error && <p className="error">{error}</p>}
      </fieldset>
    </form>
  );
}
