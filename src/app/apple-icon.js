import { ImageResponse } from 'next/og';

// iOS home-screen icon (iOS ignores SVG icons). Same robot as app/icon.svg, but
// full-bleed — iOS rounds the corners itself. Rendered once at build time.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

const BOT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="180" height="180">
  <rect width="64" height="64" fill="#0B0D10"/>
  <g transform="translate(6.4 7.2) scale(0.8)">
    <g fill="#cdd3dc">
      <circle cx="32" cy="9" r="3.6"/>
      <rect x="30.5" y="10.5" width="3" height="7.5" rx="1.5"/>
      <rect x="8" y="27" width="8.5" height="14" rx="3.8"/>
      <rect x="47.5" y="27" width="8.5" height="14" rx="3.8"/>
    </g>
    <rect x="13" y="17" width="38" height="31" rx="8" fill="#363c46"/>
    <g fill="#e8ecf1">
      <circle cx="26" cy="33.5" r="3.9"/>
      <circle cx="38" cy="33.5" r="3.9"/>
    </g>
  </g>
</svg>`;

export default function AppleIcon() {
  const src = `data:image/svg+xml;base64,${Buffer.from(BOT).toString('base64')}`;
  return new ImageResponse(
    (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} width={180} height={180} alt="" />
    ),
    size,
  );
}
