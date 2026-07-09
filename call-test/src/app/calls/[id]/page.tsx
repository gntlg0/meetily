import { CallView } from '@/components/CallView';

export const dynamic = 'force-dynamic';

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main>
      <CallView id={id} />
    </main>
  );
}
