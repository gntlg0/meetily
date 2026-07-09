import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Call Test — Mongolian ASR bake-off',
  description: 'Local test bench for Mongolian call transcription + loan-retention summaries.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="mn">
      <body>{children}</body>
    </html>
  );
}
