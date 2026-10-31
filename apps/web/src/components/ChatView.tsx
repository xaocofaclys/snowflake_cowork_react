'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AUTO_AGENT_ID, blocksToText, type BlockOf } from '@cowork/shared';
import { ChatActions } from '@/lib/chat-actions';
import { useChatStore } from '@/lib/chat-store';
import { useAgents, useMe, useSkills, useThread } from '@/lib/hooks';
import { useUi, type ChatMode } from '@/lib/ui-store';
import { AgentPicker } from './AgentPicker';
import { CanvasPanel } from './Canvas';
import { Composer, expandSkill } from './Composer';
import { Home } from './Home';
import { AssistantMessage, UserMessage } from './Message';
import { Spinner } from './ui';

export function ChatView({ threadId }: { threadId?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: agents = [] } = useAgents();
  const { data: skills = [] } = useSkills();
  const { data, isLoading } = useThread(threadId);
  const live = useChatStore((s) => s.live[threadId ?? 'new']);
  const { send, stop } = useChatStore.getState();
  const canvas = useUi((s) => s.canvas);
  const openCanvas = useUi((s) => s.openCanvas);
  const closeCanvas = useUi((s) => s.closeCanvas);
  const [picked, setPicked] = useState<string>();
  const [mode, setMode] = useState<ChatMode>('chat');
  const [prefill, setPrefill] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const autoOpened = useRef(new Set<string>());

  // Deep links: /?agent=<id>, /?q=<prefill>, /?mode=research|dashboard
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('agent')) setPicked(params.get('agent')!);
    if (params.get('q')) setPrefill(params.get('q')!);
    const m = params.get('mode');
    if (m === 'research' || m === 'dashboard') setMode(m);
  }, []);

  // A different conversation shouldn't keep the previous one's canvas open.
  useEffect(() => closeCanvas, [threadId, closeCanvas]);

  const realAgents = agents.filter((a) => a.kind === 'agent');
  const agentId = data?.thread.agentId ?? picked ?? me?.settings.defaultAgentId ?? (realAgents.length > 1 ? AUTO_AGENT_ID : agents[0]?.id);
  const agent = agents.find((a) => a.id === agentId) ?? (agentId === AUTO_AGENT_ID ? realAgents[0] : undefined);
  const messages = useMemo(() => data?.messages ?? [], [data]);

  // Once the persisted copy of the live turn has loaded, render that instead.
  const persisted = !!live?.messageId && messages.some((m) => m.id === live.messageId);
  // While a turn is live, the saved copy of its question (stored before the answer) would show twice.
  const shown = useMemo(() => {
    if (!live || persisted) return messages;
    const last = messages[messages.length - 1];
    return last?.role === 'user' && blocksToText(last.content) === live.userText ? messages.slice(0, -1) : messages;
  }, [messages, live, persisted]);

  // A dashboard or report built in this turn opens in the canvas (on wide screens).
  useEffect(() => {
    const link = live?.blocks.find((b): b is BlockOf<'artifact_link'> => b.type === 'artifact_link');
    if (!link || autoOpened.current.has(link.artifactId) || window.innerWidth < 1024) return;
    autoOpened.current.add(link.artifactId);
    openCanvas(link.kind === 'dashboard' ? { kind: 'dashboard', id: link.artifactId, title: link.title } : { kind: 'artifact', id: link.artifactId, title: link.title });
  }, [live?.blocks, openCanvas]);

  // Follow the conversation as it grows (charts render async), unless the user scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !content.current) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content.current);
    return () => ro.disconnect();
  });

  const onSend = (raw: string, sendMode: ChatMode = mode) => {
    if (!agentId) return;
    stick.current = true;
    const text = expandSkill(raw, skills);
    send({
      threadId,
      agentId,
      text,
      mode: sendMode,
      onThread: (id) => {
        router.replace(`/c/${id}`);
        qc.invalidateQueries({ queryKey: ['threads'] });
      },
      onDone: (id) => {
        qc.invalidateQueries({ queryKey: ['thread', id] });
        qc.invalidateQueries({ queryKey: ['threads'] });
        if (useChatStore.getState().live[id]?.memorySaved) qc.invalidateQueries({ queryKey: ['memories'] });
        if (sendMode !== 'chat') {
          qc.invalidateQueries({ queryKey: ['artifacts'] });
          qc.invalidateQueries({ queryKey: ['dashboards'] });
        }
      },
    });
    // Research and dashboard are one-shot modes; follow-ups default back to Ask.
    if (sendMode !== 'chat') setMode('chat');
  };

  const picker = <AgentPicker agents={agents} value={agentId} onChange={setPicked} disabled={!!threadId} />;
  const isEmpty = !threadId && !live;
  const actions = { send: (text: string, m?: ChatMode) => onSend(text, m ?? 'chat') };

  if (isEmpty) {
    return (
      <ChatActions.Provider value={actions}>
        <Home
          agent={agent}
          onAsk={(q) => onSend(q)}
          onMode={setMode}
          composer={
            <Composer
              key={prefill}
              initialText={prefill}
              onSend={(t) => onSend(t)}
              onStop={() => undefined}
              streaming={false}
              skills={skills}
              left={picker}
              autoFocus
              mode={mode}
              onModeChange={setMode}
              size="lg"
            />
          }
        />
      </ChatActions.Provider>
    );
  }

  const ctxFor = (messageId?: string, question?: string) => ({ threadId, messageId, agentId, question });
  const userTextBefore = (i: number) => {
    for (let j = i - 1; j >= 0; j--) if (shown[j].role === 'user') return blocksToText(shown[j].content);
    return undefined;
  };
  const lastAssistant = [...shown].reverse().find((m) => m.role === 'assistant')?.id;

  return (
    <ChatActions.Provider value={actions}>
      <div className="flex h-full">
        <div className="flex h-full min-w-0 flex-1 flex-col">
          <div
            ref={scroller}
            className="flex-1 overflow-y-auto"
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
            }}
          >
            <div ref={content} className="mx-auto max-w-3xl space-y-7 px-4 py-8">
              {isLoading && threadId && !live && (
                <div className="flex justify-center py-10 text-ink-3">
                  <Spinner />
                </div>
              )}
              {shown.map((m, i) =>
                m.role === 'user' ? (
                  <UserMessage key={m.id} text={blocksToText(m.content)} />
                ) : (
                  <AssistantMessage
                    key={m.id}
                    blocks={m.content}
                    ctx={ctxFor(m.id, userTextBefore(i))}
                    feedback={m.feedback}
                    isLast={(!live || persisted) && m.id === lastAssistant}
                    memorySaved={live?.messageId === m.id ? live.memorySaved : undefined}
                  />
                ),
              )}
              {live && !persisted && (
                <>
                  <UserMessage text={live.userText} />
                  <AssistantMessage blocks={live.blocks} streaming={live.streaming} isLast ctx={ctxFor(live.messageId, live.userText)} memorySaved={live.memorySaved} />
                  {live.error && <div className="text-sm text-danger">{live.error}</div>}
                </>
              )}
            </div>
          </div>
          <div className="mx-auto w-full max-w-3xl px-4 pb-4">
            <Composer
              onSend={(t) => onSend(t)}
              onStop={() => threadId && stop(threadId)}
              streaming={!!live?.streaming}
              skills={skills}
              left={picker}
              placeholder={mode === 'chat' ? 'Ask a follow-up…' : undefined}
              mode={mode}
              onModeChange={setMode}
            />
            <p className="mt-2 text-center text-[11px] text-ink-3">
              Answers come from your Snowflake Cortex agents{me?.mode.cortexMock ? ' (mock mode)' : ''}. Check important results.
            </p>
          </div>
        </div>
        {canvas && <CanvasPanel item={canvas} />}
      </div>
    </ChatActions.Provider>
  );
}
