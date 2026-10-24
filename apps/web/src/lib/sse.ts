import type { StreamEvent } from '@cowork/shared';
import { API_URL, ApiError } from './api';

/** POSTs a chat turn and calls onEvent for each normalized SSE event until the stream ends. */
export function streamChat(
  body: { threadId?: string; agentId: string; text: string; mode?: 'chat' | 'research' },
  onEvent: (ev: StreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  return streamPost('/chat/stream', body, onEvent, signal);
}

/** POSTs JSON to an SSE endpoint and calls onEvent per event until the stream ends. */
export async function streamPost(path: string, body: unknown, onEvent: (ev: StreamEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      msg = Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? msg);
    } catch {
      /* not JSON */
    }
    throw new ApiError(msg, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const data = raw
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (data) onEvent(JSON.parse(data) as StreamEvent);
    }
  }
}
