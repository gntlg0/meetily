import { stamp } from '@/lib/duration.client';
import { speakerLabel, speakerLabelMap } from '@/lib/speakers';
import type { LanguageMode, Segment } from '@/lib/types';

/**
 * Loan-retention call analysis, Mongolian output.
 *
 * The five section headings are fixed and load-bearing — the call page renders
 * the markdown straight through, and we compare summaries across ASR providers,
 * so the shape must not drift between runs.
 *
 * Claude is told to work out which speaker is the agent and which is the
 * customer from the content; we deliberately do NOT pass that in (and we leave
 * ElevenLabs' `detect_speaker_roles` off) so the summary stays provider-neutral.
 */
export const SUMMARY_SYSTEM_PROMPT = `Чи бол зээлийн эргэн төлөлт хариуцсан ажилтнуудын утасны дуудлагыг шинжилдэг туслах юм.

Чамд яригчдаар нь ялгасан дуудлагын бичвэр өгөгдөнө. Яригчид "Яригч 1", "Яригч 2" гэж зөвхөн дугаараар тэмдэглэгдсэн байна. Аль нь зээлдүүлэгч байгууллагын ажилтан, аль нь харилцагч болохыг агуулгаас нь ӨӨРӨӨ тодорхойл (өөрийгөө танилцуулж, төлбөр нэхэж буй тал нь ихэвчлэн ажилтан байдаг).

Хариултаа зөвхөн монгол хэлээр, Markdown форматаар, яг дараах таван гарчигтайгаар бич:

## Дуудлагын хураангуй
2-4 өгүүлбэрээр дуудлагын гол агуулга.

## Харилцагчийн байдал
Төлбөр төлөх чадвар, хойшлуулж буй шалтгаан, санхүүгийн болон сэтгэл санааны байдал.

## Амлалт
Харилцагч юу амласан бэ — дүн, огноо, нөхцөл. Ямар нэг амлалт аваагүй бол "Амлалт аваагүй." гэж бич.

## Дараагийн алхам
Ажилтны дараа хийх ёстой тодорхой үйлдэл.

## Анхааруулга
Эрсдэл, гомдол, зохисгүй үг хэллэг, залилангийн шинж, дахин холбогдох боломжгүй байдал зэрэг анхаарах зүйл. Байхгүй бол "Онцгой анхааруулга алга." гэж бич.

Дүрэм:
- Эхний гарчгийн өмнө нэг мөрөнд аль яригч нь ажилтан, аль нь харилцагч болохыг товч заа. Жишээ: "Яригч 1 — ажилтан, Яригч 2 — харилцагч."
- Зөвхөн бичвэрт байгаа мэдээллийг ашигла. Байхгүй зүйлийг бүү зохио.
- Мэдээлэл дутуу бол тухайн хэсэгт "Тодорхойгүй" гэж бич.
- Огноо, мөнгөн дүн, хугацааг бичвэрт хэлсэн байдлаар нь давтан бич.
- Бичвэрийг автомат ярианы таних (ASR) системээр буулгасан тул үг таних алдаа агуулж болзошгүй. Ойлгомжгүй, гажсан үг дээр тулгуурлан баттай дүгнэлт бүү хий.`;

const LANGUAGE_HINTS: Record<LanguageMode, string> = {
  mn: 'Дуудлага монгол хэл дээр явагдсан.',
  en: 'Дуудлага англи хэл дээр явагдсан. Гэхдээ хураангуйг МОНГОЛ хэлээр бич.',
  mixed:
    'Дуудлага үндсэндээ монгол хэл дээр, дунд нь англи мэргэжлийн/санхүүгийн нэр томьёо холилдсон байж болно.',
};

/** Renders segments the way the model sees them: `Яригч 1 [0:03]: ...` */
export function renderTranscript(segments: Segment[]): string {
  const labels = speakerLabelMap(segments);
  return segments
    .map((s) => `${speakerLabel(labels, s.speaker)} ${stamp(s.startMs)}: ${s.text}`)
    .join('\n');
}

const MAX_TRANSCRIPT_CHARS = 400_000;

export function buildSummaryUserPrompt(
  segments: Segment[],
  opts: { language: LanguageMode; note?: string | null },
): string {
  const transcript = renderTranscript(segments);

  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    throw new Error(
      `Transcript is ${transcript.length} characters, over the ${MAX_TRANSCRIPT_CHARS} ` +
        'limit for a single summary request. Split the call rather than truncating it.',
    );
  }

  const parts = [LANGUAGE_HINTS[opts.language]];
  if (opts.note?.trim()) {
    parts.push(`Тэмдэглэл (тестийн нөхцөл): ${opts.note.trim()}`);
  }
  parts.push('', 'Дуудлагын бичвэр:', '---', transcript, '---');
  return parts.join('\n');
}
