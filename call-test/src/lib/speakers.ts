/**
 * Providers emit opaque speaker ids ("speaker_0", "agent", ...). We store those
 * verbatim and only map to display labels at render time, keyed by order of
 * first appearance so "Яригч 1" is always whoever spoke first.
 */
export function speakerLabelMap(segments: { speaker: string }[]): Map<string, string> {
  const order: string[] = [];
  for (const s of segments) {
    if (!order.includes(s.speaker)) order.push(s.speaker);
  }
  const map = new Map<string, string>();
  order.forEach((id, i) => map.set(id, `Яригч ${i + 1}`));
  return map;
}

export function speakerLabel(map: Map<string, string>, speaker: string): string {
  return map.get(speaker) ?? speaker;
}
