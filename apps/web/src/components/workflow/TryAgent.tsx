'use client';

import { useRef, useState } from 'react';
import { BlockBuilder, type AgentInfo, type BlockOf, type WorkflowGraph } from '@cowork/shared';
import { streamPost } from '@/lib/sse';
import { AssistantMessage } from '../Message';
import { Button, Modal, inputCls } from '../ui';

/** Playground: send one message to an agent and see exactly what it returns (runs a 1-node workflow). */
export function TryAgent({ agent, onClose }: { agent: AgentInfo; onClose: () => void }) {
  const [text, setText] = useState(agent.sampleQuestions[0] ?? '');
  const [blocks, setBlocks] = useState<BlockOf<'workflow'>['steps'][number]['blocks'] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const abort = useRef<AbortController | null>(null);

  const run = async () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 } },
        { id: 'agent', type: 'agent', agentId: agent.id, label: agent.displayName, inputTemplate: '{{input}}', position: { x: 0, y: 0 } },
        { id: 'end', type: 'end', position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'agent' },
        { id: 'e2', source: 'agent', target: 'end' },
      ],
    };
    const b = new BlockBuilder();
    abort.current = new AbortController();
    setRunning(true);
    setError(undefined);
    setBlocks([]);
    try {
      await streamPost(
        '/workflows/run',
        { graph, input: text },
        (ev) => {
          b.add(ev);
          const wf = b.blocks.find((x) => x.type === 'workflow') as BlockOf<'workflow'> | undefined;
          const step = wf?.steps.find((s) => s.nodeId === 'agent');
          if (step) setBlocks(step.blocks.map((x) => ({ ...x })));
          if (ev.type === 'node_end' && ev.nodeId === 'agent' && ev.error) setError(ev.error);
        },
        abort.current.signal,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal open onClose={() => (abort.current?.abort(), onClose())} title={`Try ${agent.displayName}`} wide>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !running && run()} placeholder="Message to the agent" autoFocus />
          <Button variant="primary" disabled={!text.trim() || running} onClick={run}>
            Send
          </Button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {blocks && <AssistantMessage blocks={blocks} streaming={running} ctx={{ agentId: agent.id, question: text }} />}
          {error && <p className="text-sm text-danger">{error}</p>}
          {!blocks && <p className="text-sm text-ink-3">The agent's answer, reasoning, SQL, tables and charts appear here, exactly what the next step in a workflow would receive.</p>}
        </div>
      </div>
    </Modal>
  );
}
