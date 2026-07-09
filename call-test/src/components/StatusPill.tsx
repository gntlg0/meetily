import type { CallStatus, JobStatus } from '@/lib/types';

const CLASS: Record<string, string> = {
  done: 'done',
  failed: 'failed',
  pending: 'busy',
  running: 'busy',
  transcribing: 'busy',
  summarizing: 'busy',
};

export function StatusPill({ status }: { status: CallStatus | JobStatus }) {
  return <span className={`pill ${CLASS[status] ?? ''}`}>{status}</span>;
}
