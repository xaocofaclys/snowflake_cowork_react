import '@fontsource-variable/inter';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { APP_NAME, APP_TAGLINE } from '@cowork/shared';
import './globals.css';
import { Providers } from './providers';

// Inter is bundled from npm (@fontsource-variable/inter) and served by the app: no network at build or run time.

export const metadata: Metadata = { title: APP_NAME, description: `${APP_TAGLINE}: an AI work agent on Snowflake Cortex Agents` };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme and accent before paint to avoid a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var m=localStorage.getItem('theme');if(m==='dark'||(m!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark');var a=localStorage.getItem('accent');if(a)document.documentElement.dataset.accent=a}catch(e){}`,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
