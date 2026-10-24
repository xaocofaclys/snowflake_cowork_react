import type { MemoryCategory } from '@cowork/shared';

const RULES: { re: RegExp; category: MemoryCategory; fmt: (m: string) => string }[] = [
  { re: /\bremember (?:that )?(.+)/i, category: 'fact', fmt: (m) => m },
  { re: /\bi (?:always |usually )?prefer (.+)/i, category: 'preference', fmt: (m) => `Prefers ${m}` },
  { re: /\b(?:always|from now on,?) (show|use|give|format|report) (.+)/i, category: 'preference', fmt: (m) => `Wants the assistant to always ${m}` },
  { re: /\bmy name is ([a-z][\w-]*(?: [a-z][\w-]*)?)/i, category: 'fact', fmt: (m) => `Name is ${m}` },
  { re: /\bcall me ([a-z][\w-]*)/i, category: 'fact', fmt: (m) => `Likes to be called ${m}` },
  { re: /\bi(?: am|'m) (?:a|an|the) ([\w -]{3,40}?)(?: at| in| for|[.,!]|$)/i, category: 'role', fmt: (m) => `Works as ${m}` },
  { re: /\bi work (?:in|on|for) ([\w &-]{3,40}?)(?:[.,!]|$)/i, category: 'role', fmt: (m) => `Works in/on ${m}` },
  { re: /\bi(?:'m| am) (?:focused on|responsible for) ([\w &-]{3,60}?)(?:[.,!]|$)/i, category: 'goal', fmt: (m) => `Focuses on ${m}` },
];

/** Offline fallback for memory extraction when Cortex LLM functions aren't available. */
export function extractWithRules(text: string): { text: string; category: MemoryCategory }[] {
  const out: { text: string; category: MemoryCategory }[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|\n/)) {
    for (const r of RULES) {
      const m = sentence.match(r.re);
      if (!m) continue;
      const captured = (m.length > 2 ? `${m[1]} ${m[2]}` : m[1]).trim().replace(/[.!?]+$/, '');
      out.push({ text: r.fmt(captured), category: r.category });
      break;
    }
  }
  return out;
}
