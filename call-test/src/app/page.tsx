import { CallsTable } from '@/components/CallsTable';
import { UploadForm } from '@/components/UploadForm';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <main>
      <h1>Call Test</h1>
      <p className="muted">
        Local bench for judging Mongolian ASR on real phone-call audio. Upload → Scribe transcript
        → Mongolian loan-retention summary. Re-transcribe with another provider to compare.
      </p>

      <UploadForm />

      <h2>Calls</h2>
      <CallsTable />
    </main>
  );
}
