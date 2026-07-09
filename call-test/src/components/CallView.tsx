'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import Markdown from 'react-markdown';

import { StatusPill } from '@/components/StatusPill';
import { Transcript } from '@/components/Transcript';
import type { CallDetail } from '@/lib/dto';
import { formatDuration } from '@/lib/duration.client';
import { PROVIDERS, type ProviderName } from '@/lib/types';

const POLL_MS = 2500;
const TERMINAL = new Set(['done', 'failed']);

export function CallView({ id }: { id: string }) {
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/calls/${id}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`GET /api/calls/${id} -> ${res.status}`);
    return (await res.json()) as CallDetail;
  }, [id]);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const d = await load();
        if (!cancelled) {
          setDetail(d);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }

    void tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [load]);

  async function act(url: string, body?: unknown) {
    setPending(true);
    setActionError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `${url} -> ${res.status}`);
      setDetail(await load());
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!detail) return <p className="muted">Loading…</p>;

  const done = detail.transcriptions.filter((t) => t.status === 'done');
  const busy = detail.busy || !TERMINAL.has(detail.status);
  const disabled = busy || pending;
  const summaryFrom = done.find((t) => t.id === detail.summary?.transcriptionId)?.provider;

  return (
    <>
      <p>
        <Link href="/">← All calls</Link>
      </p>

      <h1>{detail.filename}</h1>
      <p className="muted">
        <StatusPill status={detail.status} /> · {formatDuration(detail.durationMs)} ·{' '}
        {detail.languageMode} · {detail.numSpeakers} speakers ·{' '}
        {new Date(detail.createdAt).toLocaleString()}
        {detail.note ? ` · ${detail.note}` : ''}
      </p>

      {detail.error && <p className="error">{detail.error}</p>}

      <audio controls preload="metadata" src={`/api/calls/${id}/audio`} style={{ width: '100%' }}>
        <track kind="captions" />
      </audio>

      <div className="actions">
        {detail.retryable && (
          <button type="button" disabled={disabled} onClick={() => act(`/api/calls/${id}/retry`)}>
            Retry
          </button>
        )}

        {PROVIDERS.map((p: ProviderName) => (
          <button
            key={p}
            type="button"
            disabled={disabled}
            onClick={() => act(`/api/calls/${id}/transcribe`, { provider: p })}
          >
            Re-transcribe with {p}
          </button>
        ))}

        {done.length >= 2 && (
          <Link href={`/calls/${id}/compare`}>Compare {done.length} transcripts →</Link>
        )}
      </div>

      {busy && <p className="muted">Working… this page refreshes on its own.</p>}
      {actionError && <p className="error">{actionError}</p>}

      <h2>Summary</h2>
      {detail.summary?.status === 'done' && detail.summary.markdown ? (
        <>
          <div className="summary">
            <Markdown>{detail.summary.markdown}</Markdown>
          </div>
          <p className="muted">
            model: {detail.summary.model} · from {summaryFrom ?? 'unknown'}
          </p>
        </>
      ) : detail.summary?.status === 'failed' ? (
        <p className="error">Summary failed: {detail.summary.error}</p>
      ) : detail.summary ? (
        <p className="muted">Summarizing…</p>
      ) : (
        <p className="muted">No summary yet.</p>
      )}

      {done.length > 0 && (
        <div className="actions">
          {done.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              onClick={() => act(`/api/calls/${id}/summarize`, { transcriptionId: t.id })}
            >
              Re-summarize from {t.provider}
            </button>
          ))}
        </div>
      )}

      <h2>Transcripts</h2>
      {detail.transcriptions.length === 0 && <p className="muted">None yet.</p>}

      {detail.transcriptions.map((t) => (
        <section key={t.id}>
          <h3>
            {t.provider} <StatusPill status={t.status} />{' '}
            <span className="muted">{t.model ?? ''}</span>
          </h3>
          {t.status === 'failed' && <p className="error">{t.error}</p>}
          {t.status === 'done' && <Transcript segments={t.segments} />}
          {(t.status === 'pending' || t.status === 'running') && (
            <p className="muted">Transcribing…</p>
          )}
        </section>
      ))}
    </>
  );
}
