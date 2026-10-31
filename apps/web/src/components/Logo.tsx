import { APP_NAME } from '@cowork/shared';

/** Flurry mark: a six-armed snowflake in the brand gradient (follows the user's accent). */
export function LogoMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="flurry-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-2)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#flurry-g)" />
      <g stroke="#fff" strokeWidth="2" strokeLinecap="round" fill="none">
        {[0, 60, 120].map((r) => (
          <g key={r} transform={`rotate(${r} 16 16)`}>
            <path d="M16 6.5v19" />
            <path d="M13 9l3 2.4L19 9M13 23l3-2.4 3 2.4" />
          </g>
        ))}
      </g>
      <circle cx="16" cy="16" r="2.2" fill="#fff" />
    </svg>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark size={size} />
      <span className="text-[15px] font-semibold tracking-tight">{APP_NAME}</span>
    </span>
  );
}
