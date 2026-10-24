'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AUTO_AGENT_ID, blocksToText } from '@cowork/shared';
import { useChatStore } from '@/lib/chat-store';
import { useAgents, useMe, useSkills, useThread } from '@/lib/hooks';
import { AgentPicker } from './AgentPicker';
import { Composer, expandSkill } from './Composer';
import { AssistantMessage, UserMessage } from './Message';
import { Spinner } from './ui';

function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  return `Good ${part}, ${name.split(/[ ._]/)[0].replace(/^./, (c) => c.toUpperCase())}`;
}

export function ChatView({ threadId }: { threadId?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: agents = [] } = useAgents();
  const { data: skills = [] } = useSkills();
  const { data, isLoading } = useThread(threadId);
  const live = useChatStore((s) => s.live[threadId ?? 'new']);
  const { send, stop } = useChatStore.getState();
  const [picked, setPicked] = useState<string>();
  const [research, setResearch] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Deep link from the workflow playground: /?agent=<id>
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('agent');
    if (fromUrl) setPicked(fromUrl);
  }, []);

  const realAgents = agents.filter((a) => a.kind === 'agent');
  const agentId =
    data?.thread.agentId ?? picked ?? me?.settings.defaultAgentId ?? (realAgents.length > 1 ? AUTO_AGENT_ID : agents[0]?.id);
  const agent = agents.find((a) => a.id === agentId);
  const messages = useMemo(() => data?.messages ?? [], [data]);

  // Once the persisted copy of the live turn has loaded, render that instead.
  // The live entry stays (until the next send) so its memory notice survives.
  const persisted = !!live?.messageId && messages.some((m) => m.id === live.messageId);
  // While a turn is live, the saved copy of its question (stored before the answer) would show twice.
  const shown = useMemo(() => {
    if (!live || persisted) return messages;
    const last = messages[messages.length - 1];
    return last?.role === 'user' && blocksToText(last.content) === live.userText ? messages.slice(0, -1) : messages;
  }, [messages, live, persisted]);

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

  const onSend = (raw: string) => {
    if (!agentId) return;
    stick.current = true;
    const text = expandSkill(raw, skills);
    send({
      threadId,
      agentId,
      text,
      mode: research ? 'research' : 'chat',
      onThread: (id) => {
        router.replace(`/c/${id}`);
        qc.invalidateQueries({ queryKey: ['threads'] });
      },
      onDone: (id) => {
        qc.invalidateQueries({ queryKey: ['thread', id] });
        qc.invalidateQueries({ queryKey: ['threads'] });
        if (useChatStore.getState().live[id]?.memorySaved) qc.invalidateQueries({ queryKey: ['memories'] });
        if (research) qc.invalidateQueries({ queryKey: ['artifacts'] });
      },
    });
  };

  const picker = <AgentPicker agents={agents} value={agentId} onChange={setPicked} disabled={!!threadId} />;
  const isEmpty = !threadId && !live;

  if (isEmpty) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 pb-24">
        <div className="w-full max-w-2xl">
          <h1 className="mb-1 text-center text-3xl font-semibold tracking-tight">{me ? greeting(me.user.displayName ?? me.user.name) : ' '}</h1>
          <p className="mb-8 text-center text-sm text-ink-3">
            {agentId === AUTO_AGENT_ID
              ? 'Ask anything. The right agent is picked for each question'
              : agent
                ? `Ask ${agent.displayName} about your data`
                : 'Pick an agent to get started'}
          </p>
          <Composer
            onSend={onSend}
            onStop={() => undefined}
            streaming={false}
            skills={skills}
            left={picker}
            autoFocus
            research={research}
            onResearchChange={setResearch}
            placeholder={research ? 'What should be researched?' : undefined}
          />
          {!!agent?.sampleQuestions.length && (
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {agent.sampleQuestions.slice(0, 4).map((q) => (
                <button
                  key={q}
                  onClick={() => onSend(q)}
                  className="flex items-start gap-2 rounded-xl border border-line px-3.5 py-3 text-left text-sm text-ink-2 hover:bg-panel hover:text-ink"
                >
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" />
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const ctxFor = (messageId?: string, question?: string) => ({ threadId, messageId, agentId, question });
  const userTextBefore = (i: number) => {
    for (let j = i - 1; j >= 0; j--) if (shown[j].role === 'user') return blocksToText(shown[j].content);
    return undefined;
  };

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scroller}
        className="flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
      >
        <div ref={content} className="mx-auto max-w-3xl space-y-6 px-4 py-8">
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
                memorySaved={live?.messageId === m.id ? live.memorySaved : undefined}
              />
            ),
          )}
          {live && !persisted && (
            <>
              <UserMessage text={live.userText} />
              <AssistantMessage
                blocks={live.blocks}
                streaming={live.streaming}
                ctx={ctxFor(live.messageId, live.userText)}
                memorySaved={live.memorySaved}
              />
              {live.error && <div className="text-sm text-danger">{live.error}</div>}
            </>
          )}
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        <Composer
          onSend={onSend}
          onStop={() => threadId && stop(threadId)}
          streaming={!!live?.streaming}
          skills={skills}
          left={picker}
          placeholder={research ? 'What should be researched?' : 'Ask a follow-up…'}
          research={research}
          onResearchChange={setResearch}
        />
        <p className="mt-2 text-center text-[11px] text-ink-3">
          Answers are generated by Cortex Agents{me?.mode.cortexMock ? ' (mock mode)' : ''}. Check important results.
        </p>
      </div>
    </div>
  );
}
