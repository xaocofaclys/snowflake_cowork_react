'use client';

import { Snowflake } from 'lucide-react';
import { APP_NAME, APP_TAGLINE } from '@cowork/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Button, inputCls } from '@/components/ui';
import { api, API_URL } from '@/lib/api';

function Login() {
  const [cfg, setCfg] = useState<{ authMode: 'oauth' | 'dev' | 'spcs'; cortexMock: boolean }>();
  const [name, setName] = useState('');
  const router = useRouter();
  const error = useSearchParams().get('error');

  useEffect(() => {
    api<{ authMode: 'oauth' | 'dev' | 'spcs'; cortexMock: boolean }>('/auth/config').then(setCfg).catch(() => undefined);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-bg p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Snowflake className="h-9 w-9 text-accent" />
          <h1 className="text-xl font-semibold">Sign in to {APP_NAME}</h1>
          <p className="text-sm text-ink-3">{APP_TAGLINE}</p>
        </div>
        {error && <p className="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">Sign-in failed: {error}</p>}
        {!cfg && <p className="text-center text-sm text-ink-3">Connecting to API at {API_URL}…</p>}
        {cfg?.authMode === 'oauth' && (
          <Button variant="primary" className="w-full" onClick={() => (location.href = `${API_URL}/auth/login`)}>
            Sign in with Snowflake
          </Button>
        )}
        {cfg?.authMode === 'spcs' && (
          <div className="space-y-3 text-center text-sm text-ink-2">
            <p>Snowflake didn't pass your identity to the app. Reload to sign in again.</p>
            <Button variant="primary" className="w-full" onClick={() => (location.href = '/')}>
              Reload
            </Button>
          </div>
        )}
        {cfg?.authMode === 'dev' && (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              await api('/auth/dev-login', { method: 'POST', json: { name } });
              router.replace('/');
            }}
          >
            <input className={inputCls} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <Button variant="primary" className="w-full" type="submit">
              Continue (dev mode)
            </Button>
            <p className="text-center text-xs text-ink-3">
              AUTH_MODE=dev{cfg.cortexMock ? ' · Cortex mock' : ''}. Set AUTH_MODE=oauth to use Snowflake sign-in.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
