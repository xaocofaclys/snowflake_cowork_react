'use client';

import { useEffect, useRef, useState } from 'react';
import { usePrefs } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import { vegaConfig } from '@/lib/vega-theme';

export interface ChartHandle {
  toImageURL: (type: 'png' | 'svg') => Promise<string>;
}

/**
 * Renders a Vega-Lite spec (from Cortex `response.chart`, the API fallback, or
 * an artifact). vega-embed is loaded on the client only.
 */
export function VegaChart({
  spec,
  onReady,
  height,
  onSelect,
}: {
  spec: Record<string, unknown>;
  onReady?: (h: ChartHandle) => void;
  height?: number;
  /** Called with the clicked mark's data (used for cross-filtering on dashboards). */
  onSelect?: (datum: Record<string, unknown>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { dark } = useTheme();
  const numberFormat = usePrefs().numberFormat ?? 'international';
  const [error, setError] = useState<string>();

  useEffect(() => {
    let view:
      | {
          finalize: () => void;
          toImageURL: (t: string, scale?: number) => Promise<string>;
          addEventListener: (type: string, cb: (e: unknown, item?: { datum?: Record<string, unknown> }) => void) => void;
        }
      | undefined;
    let cancelled = false;
    (async () => {
      const { default: embed } = await import('vega-embed');
      if (cancelled || !ref.current) return;
      try {
        // With an explicit height (tiles, modals) the whole chart, axes included, must fit inside it.
        const sized = height ? { height, autosize: { type: 'fit', contains: 'padding' } } : {};
        const s = { ...spec, ...sized, config: { ...vegaConfig(dark, numberFormat), ...((spec.config as object) ?? {}) } };
        const result = await embed(ref.current, s as never, { actions: false, renderer: 'svg', tooltip: { theme: dark ? 'dark' : 'light' } });
        const v = result.view as unknown as NonNullable<typeof view>;
        view = v;
        if (onSelect) v.addEventListener('click', (_e, item) => item?.datum && onSelect(item.datum));
        setError(undefined);
        onReady?.({ toImageURL: (t) => view!.toImageURL(t, 2) });
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      view?.finalize();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, dark, height, numberFormat]);

  if (error) return <div className="rounded-lg bg-raised p-3 text-xs text-danger">Chart could not render: {error}</div>;
  return <div ref={ref} className="w-full" />;
}
