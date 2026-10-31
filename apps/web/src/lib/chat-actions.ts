'use client';

import { createContext, useContext } from 'react';
import type { ChatMode } from './ui-store';

/** Lets messages send follow-ups (suggestion chips, regenerate) through the current conversation. */
export const ChatActions = createContext<{ send: (text: string, mode?: ChatMode) => void } | null>(null);

export const useChatActions = () => useContext(ChatActions);
