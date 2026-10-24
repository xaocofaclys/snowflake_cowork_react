import { describe, expect, it } from 'vitest';
import { extractWithRules } from '../src/memory/rules';

describe('extractWithRules', () => {
  it('captures preferences, names and roles', () => {
    const out = extractWithRules('I prefer bar charts. My name is Priya. I am a finance analyst at Acme.');
    expect(out.map((o) => o.text)).toEqual(['Prefers bar charts', 'Name is Priya', 'Works as finance analyst']);
  });

  it('ignores ordinary questions', () => {
    expect(extractWithRules('Show monthly revenue for 1997')).toEqual([]);
  });
});
