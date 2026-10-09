import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'BotCooks', template: '%s · BotCooks' },
  description: 'Describe your ideal Discord server, review the plan, and let BotCooks build it safely.',
};

export const viewport: Viewport = { themeColor: '#0c0a09', colorScheme: 'dark' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
