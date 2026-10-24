'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Artifact } from '@cowork/shared';
import { useSaveArtifact } from '@/lib/hooks';
import { Button, Modal, Toast, inputCls } from './ui';

export function SaveArtifactDialog({
  open,
  onClose,
  draft,
}: {
  open: boolean;
  onClose: () => void;
  draft: Partial<Artifact>;
}) {
  const [title, setTitle] = useState(draft.title ?? '');
  const [description, setDescription] = useState('');
  const save = useSaveArtifact();
  const [saved, setSaved] = useState<Artifact>();

  const submit = async () => {
    const a = await save.mutateAsync({ ...draft, title, description: description || undefined });
    setSaved(a);
    onClose();
    setTimeout(() => setSaved(undefined), 4000);
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title={`Save ${draft.type ?? ''} as artifact`}>
        <div className="space-y-3">
          <label className="block text-xs font-medium text-ink-2">
            Title
            <input autoFocus className={`${inputCls} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="block text-xs font-medium text-ink-2">
            Description (optional)
            <textarea rows={2} className={`${inputCls} mt-1`} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          {draft.sql && <p className="text-xs text-ink-3">The query is saved too, so you can refresh this artifact with live data.</p>}
          {save.error && <p className="text-xs text-danger">{(save.error as Error).message}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!title.trim() || save.isPending} onClick={submit}>
              Save
            </Button>
          </div>
        </div>
      </Modal>
      {saved && (
        <Toast>
          Saved to artifacts ·{' '}
          <Link href={`/artifacts/${saved.id}`} className="underline">
            Open
          </Link>
        </Toast>
      )}
    </>
  );
}
