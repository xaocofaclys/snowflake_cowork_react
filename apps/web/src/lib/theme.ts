'use client';

import { create } from 'zustand';

type Mode = 'light' | 'dark' | 'system';

function systemDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(mode: Mode) {
  const dark = mode === 'dark' || (mode === 'system' && systemDark());
  document.documentElement.classList.toggle('dark', dark);
  return dark;
}

export const useTheme = create<{ mode: Mode; dark: boolean; setMode: (m: Mode) => void; init: () => void }>((set) => ({
  mode: 'system',
  dark: false,
  setMode(mode) {
    try {
      localStorage.setItem('theme', mode);
    } catch {
      /* storage unavailable */
    }
    set({ mode, dark: apply(mode) });
  },
  init() {
    let mode: Mode = 'system';
    try {
      mode = (localStorage.getItem('theme') as Mode) || 'system';
    } catch {
      /* storage unavailable */
    }
    set({ mode, dark: apply(mode) });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const m = useTheme.getState().mode;
      if (m === 'system') set({ dark: apply(m) });
    });
  },
}));
