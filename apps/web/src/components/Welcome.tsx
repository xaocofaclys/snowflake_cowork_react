'use client';

import clsx from 'clsx';
import { CalendarClock, MessageSquareText, Telescope } from 'lucide-react';
import { useState } from 'react';
import { APP_NAME, APP_TAGLINE } from '@cowork/shared';
import { useMe, useUpdateSettings } from '@/lib/hooks';
import { LogoMark } from './Logo';
import { Button } from './ui';

const STEPS = [
  {
    icon: MessageSquareText,
    title: 'Ask in plain English',
    body: 'Ask about your Snowflake data and get answers with the SQL, tables and charts behind them. Auto picks the right agent for each question.',
  },
  {
    icon: Telescope,
    title: 'Go deeper',
    body: 'Switch to Deep research for a cited multi-step report, or Dashboard to have a live, filterable dashboard built for you.',
  },
  {
    icon: CalendarClock,
    title: 'Make it routine',
    body: 'Pin what matters to Home, schedule briefs with automations, share with your team, export to PDF or PowerPoint. Press ⌘K anytime to jump anywhere.',
  },
];

/** First-run tour, shown once per user. */
export function Welcome() {
  const { data: me } = useMe();
  const update = useUpdateSettings();
  const [step, setStep] = useState(-1);
  if (!me || me.settings.onboarded) return null;
  const done = () => update.mutate({ onboarded: true });
  const s = STEPS[step];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="animate-fade-up w-full max-w-md overflow-hidden rounded-3xl border border-line bg-bg shadow-lift">
        {step < 0 ? (
          <div className="hero-snow px-8 pb-8 pt-10 text-center">
            <LogoMark size={56} className="mx-auto" />
            <h2 className="mt-5 text-2xl font-semibold tracking-tight">Welcome to {APP_NAME}</h2>
            <p className="mt-2 text-sm text-ink-2">{APP_TAGLINE}.</p>
            <div className="mt-7 flex justify-center gap-2">
              <Button variant="ghost" onClick={done}>
                Skip
              </Button>
              <Button variant="primary" onClick={() => setStep(0)}>
                Take the 30-second tour
              </Button>
            </div>
          </div>
        ) : (
          <div className="px-8 pb-7 pt-8">
            <div className="bg-brand mb-5 flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-soft">
              <s.icon className="h-6 w-6" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight">{s.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{s.body}</p>
            <div className="mt-7 flex items-center">
              <div className="flex gap-1.5">
                {STEPS.map((_, i) => (
                  <span key={i} className={clsx('h-1.5 rounded-full transition-all', i === step ? 'bg-brand w-6' : 'w-1.5 bg-line')} />
                ))}
              </div>
              <div className="ml-auto flex gap-2">
                {step > 0 && (
                  <Button variant="ghost" onClick={() => setStep(step - 1)}>
                    Back
                  </Button>
                )}
                <Button variant="primary" onClick={() => (step === STEPS.length - 1 ? done() : setStep(step + 1))}>
                  {step === STEPS.length - 1 ? 'Get started' : 'Next'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

