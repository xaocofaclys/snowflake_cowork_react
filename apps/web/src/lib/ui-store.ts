'use client';

import { create } from 'zustand';
import type { ResultContext, ResultGroup } from '@/components/blocks/ResultCard';

/** What the live canvas (right-hand panel next to the chat) shows. */
export type CanvasItem =
  | { kind: 'result'; title: string; group: ResultGroup; ctx: ResultContext }
  | { kind: 'artifact'; title: string; id: string }
  | { kind: 'dashboard'; title: string; id: string };

export type ChatMode = 'chat' | 'research' | 'dashboard';

interface UiState {
  palette: boolean;
  setPalette: (open: boolean) => void;
  canvas: CanvasItem | null;
  openCanvas: (item: CanvasItem) => void;
  closeCanvas: () => void;
  /** Text pushed into the composer (click-to-ask, edit & resend); nonce re-applies the same text. */
  draft: { text: string; nonce: number; mode?: ChatMode };
  setDraft: (text: string, mode?: ChatMode) => void;
  drawer: boolean;
  setDrawer: (open: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  palette: false,
  setPalette: (palette) => set({ palette }),
  canvas: null,
  openCanvas: (canvas) => set({ canvas }),
  closeCanvas: () => set({ canvas: null }),
  draft: { text: '', nonce: 0 },
  setDraft: (text, mode) => set((s) => ({ draft: { text, mode, nonce: s.draft.nonce + 1 } })),
  drawer: false,
  setDrawer: (drawer) => set({ drawer }),
}));
