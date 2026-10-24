'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function Markdown({ text, caret }: { text: string; caret?: boolean }) {
  return (
    <div className={`prose-chat ${caret ? 'caret' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
