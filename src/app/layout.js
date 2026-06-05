import './globals.css';
import { Figtree, Epilogue, Plus_Jakarta_Sans, Roboto_Mono } from 'next/font/google';

// Button Up Media's web typefaces, self-hosted by next/font at build time:
// Figtree (body), Epilogue (display/wordmark), Plus Jakarta Sans (hero/login),
// Roboto Mono (IDs, counts, timestamps). Exposed as CSS variables on <html>.
const figtree = Figtree({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const epilogue = Epilogue({ subsets: ['latin'], variable: '--font-display', display: 'swap' });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-hero', display: 'swap' });
const mono = Roboto_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata = {
  title: 'BUM BOT · Status Board',
  description: 'Button Up Media — live, read-only mirror of ClickUp video-task status.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0B0D10',
};

export default function RootLayout({ children }) {
  const fontVars = `${figtree.variable} ${epilogue.variable} ${jakarta.variable} ${mono.variable}`;
  return (
    <html lang="en" className={fontVars}>
      <body>{children}</body>
    </html>
  );
}
