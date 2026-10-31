import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@cowork/shared';
import { AssistantService } from '../src/chat/assistant.service';

function setup(classification: unknown = null) {
  const store: { id: string; text: string }[] = [{ id: 'm1', text: 'Prefers bar charts' }];
  const memory = {
    listPublic: async () => store.map((m) => ({ ...m, category: 'preference' })),
    create: async (_u: string, text: string) => (store.push({ id: `m${store.length + 1}`, text }), { text }),
    remove: async (_u: string, id: string) => void store.splice(store.findIndex((m) => m.id === id), 1),
  };
  const cortex = { listAgents: async () => [{ id: 'D.S.NBA', displayName: 'NBA Field Rep Assistant', sampleQuestions: ['Top HCPs this week'], kind: 'agent' }] };
  const llm = { completeJson: async () => classification };
  const svc = new AssistantService(llm as never, memory as never, cortex as never);
  const run = async (text: string, extra: object = {}) => {
    const events: StreamEvent[] = [];
    const handled = await svc.handle(text, { userId: 'u', threadId: 't', memoryEnabled: true, ...extra }, (e) => events.push(e));
    const reply = events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('');
    return { handled, reply, events };
  };
  return { run, store };
}

describe('AssistantService', () => {
  it('saves "add this as a user preference" using the model, without an agent', async () => {
    const { run, store } = setup({ intent: 'memory_add', memories: [{ text: 'Wants revenue shown in crores', category: 'preference' }] });
    const r = await run('add this as a user preference', { previousQuestion: 'show revenue in crores please' });
    expect(r.handled).toBe(true);
    expect(store.map((m) => m.text)).toContain('Wants revenue shown in crores');
    expect(r.events.some((e) => e.type === 'memory')).toBe(true);
  });

  it('falls back to rules offline: remember, this-reference, forget and list', async () => {
    const { run, store } = setup();
    expect((await run('remember that I cover the South zone')).handled).toBe(true);
    expect(store.map((m) => m.text)).toContain('I cover the South zone');
    await run('add this as a user preference', { previousQuestion: 'Always show values in lakhs' });
    expect(store.map((m) => m.text)).toContain('Always show values in lakhs');
    expect((await run('forget that I prefer bar charts')).reply).toContain('Forgotten: "Prefers bar charts"');
    expect((await run('what do you remember about me?')).reply).toContain('South zone');
  });

  it('answers help and small talk directly', async () => {
    const { run } = setup();
    expect((await run('what can you do?')).reply).toContain('Deep research');
    expect((await run('thanks!')).handled).toBe(true);
  });

  it('leaves data questions to the agent', async () => {
    const { run } = setup({ intent: 'data' });
    expect((await run('how do I see revenue by region?')).handled).toBe(false);
    expect((await run('Top HCPs by follow-through this week')).handled).toBe(false);
    expect(AssistantService.looksLikeAssistant('Show monthly revenue for 1997')).toBe(false);
  });

  it('respects memory being turned off', async () => {
    const { run, store } = setup({ intent: 'memory_add', memories: [{ text: 'Likes donuts' }] });
    const r = await run('remember I like donut charts', { memoryEnabled: false });
    expect(r.reply).toContain('Memory is turned off');
    expect(store.map((m) => m.text)).not.toContain('Likes donuts');
  });
});
