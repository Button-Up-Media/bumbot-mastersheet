import './globals.css';

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
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
