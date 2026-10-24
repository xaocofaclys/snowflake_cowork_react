import { ChatView } from '@/components/ChatView';

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChatView key={id} threadId={id} />;
}
