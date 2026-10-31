'use client';

import { create } from 'zustand';
import { BlockBuilder, type ContentBlock } from '@cowork/shared';
import { streamChat } from './sse';

/** A turn currently streaming (or just finished, until the persisted copy is loaded). */
export interface LiveTurn {
  userText: string;
  blocks: ContentBlock[];
  streaming: boolean;
  messageId?: string;
  memorySaved?: string[];
  error?: string;
}

interface ChatState {
  /** keyed by threadId; 'new' until the server assigns one */
  live: Record<string, LiveTurn>;
  aborts: Record<string, AbortController>;
  send: (opts: {
    threadId?: string;
    agentId: string;
    text: string;
    mode?: 'chat' | 'research' | 'dashboard';
    onThread?: (id: string) => void;
    onDone?: (threadId: string) => void;
  }) => Promise<void>;
  stop: (threadId: string) => void;
  clear: (threadId: string) => void;
}

const snapshot = (blocks: ContentBlock[]) => blocks.map((b) => ({ ...b }));

export const useChatStore = create<ChatState>((set, get) => ({
  live: {},
  aborts: {},

  async send({ threadId, agentId, text, mode, onThread, onDone }) {
    let key = threadId ?? 'new';
    const abort = new AbortController();
    const builder = new BlockBuilder();
    const patch = (p: Partial<LiveTurn>) =>
      set((s) => ({ live: { ...s.live, [key]: { ...s.live[key], ...p } as LiveTurn } }));
    set((s) => ({
      live: { ...s.live, [key]: { userText: text, blocks: [], streaming: true } },
      aborts: { ...s.aborts, [key]: abort },
    }));

    // Coalesce renders to one per frame while tokens stream in.
    let raf = 0;
    const flush = () => {
      raf = 0;
      patch({ blocks: snapshot(builder.blocks) });
    };

    try {
      await streamChat(
        { threadId, agentId, text, mode },
        (ev) => {
          if (ev.type === 'thread' && key === 'new') {
            const turn = get().live.new;
            set((s) => {
              const { new: _n, ...rest } = s.live;
              const { new: _a, ...restA } = s.aborts;
              return { live: { ...rest, [ev.threadId]: turn }, aborts: { ...restA, [ev.threadId]: abort } };
            });
            key = ev.threadId;
            onThread?.(ev.threadId);
            return;
          }
          if (ev.type === 'done') {
            patch({ messageId: ev.messageId, blocks: snapshot(builder.finalize()), streaming: false });
            onDone?.(key);
            return;
          }
          if (ev.type === 'memory') return patch({ memorySaved: ev.saved });
          builder.add(ev);
          if (!raf) raf = requestAnimationFrame(flush);
        },
        abort.signal,
      );
    } catch (e) {
      if (!abort.signal.aborted) patch({ error: (e as Error).message });
    } finally {
      cancelAnimationFrame(raf);
      patch({ streaming: false, blocks: snapshot(builder.finalize()) });
      onDone?.(key);
    }
  },

  stop(threadId) {
    get().aborts[threadId]?.abort();
  },

  clear(threadId) {
    set((s) => {
      const { [threadId]: _l, ...live } = s.live;
      const { [threadId]: _a, ...aborts } = s.aborts;
      return { live, aborts };
    });
  },
}));
