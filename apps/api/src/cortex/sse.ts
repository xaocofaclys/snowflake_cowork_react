export interface SseRecord {
  event: string;
  data: string;
}

/** Parses a text/event-stream body into records (handles chunk boundaries and multi-line data). */
export async function* parseSse(body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>): AsyncGenerator<SseRecord> {
  const decoder = new TextDecoder();
  let buf = '';
  let event = 'message';
  let data: string[] = [];

  const flush = (): SseRecord | null => {
    if (!data.length) {
      event = 'message';
      return null;
    }
    const rec = { event, data: data.join('\n') };
    event = 'message';
    data = [];
    return rec;
  };

  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line === '') {
        const rec = flush();
        if (rec) yield rec;
      } else if (line.startsWith(':')) {
        continue;
      } else if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''));
      }
    }
  }
  const rec = flush();
  if (rec) yield rec;
}
