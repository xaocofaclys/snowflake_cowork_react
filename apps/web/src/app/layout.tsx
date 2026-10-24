import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { APP_NAME, APP_TAGLINE } from '@cowork/shared';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = { title: APP_NAME, description: `${APP_TAGLINE}: an AI work agent on Snowflake Cortex Agents` };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before paint to avoid a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var m=localStorage.getItem('theme');if(m==='dark'||(m!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
