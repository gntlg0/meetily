import 'server-only';

import Anthropic from '@anthropic-ai/sdk';

import { SUMMARY_SYSTEM_PROMPT, buildSummaryUserPrompt } from '@/lib/prompts';
import type { LanguageMode, Segment } from '@/lib/types';

export const SUMMARY_MODEL = 'claude-sonnet-4-6';
export const SUMMARY_MAX_TOKENS = 2000;

export interface SummaryResult {
  markdown: string;
  model: string;
}

export async function summarizeCall(
  segments: Segment[],
  opts: { language: LanguageMode; note?: string | null },
): Promise<SummaryResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set. Add it to .env.local.');
  if (segments.length === 0) throw new Error('Cannot summarize an empty transcript.');

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: SUMMARY_MAX_TOKENS,
    system: SUMMARY_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildSummaryUserPrompt(segments, opts) }],
  });

  if (message.stop_reason === 'refusal') {
    throw new Error('Claude declined to summarize this call (stop_reason=refusal).');
  }

  // `content` is a mixed block list. Keep only text blocks — anything else
  // (thinking, tool_use, ...) is not part of the summary and must not crash us.
  const markdown = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  if (!markdown) {
    throw new Error(
      `Claude returned no text content (stop_reason=${message.stop_reason ?? 'unknown'}).`,
    );
  }

  return { markdown, model: SUMMARY_MODEL };
}
