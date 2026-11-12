// Web app manifest: lets phones "Add to Home Screen" and open the board
// full-screen (no browser chrome) with the BUMBOT icon.
export default function manifest() {
  return {
    name: 'BUMBOT Video Master Sheet',
    short_name: 'BUMBOT',
    start_url: '/',
    display: 'standalone',
    background_color: '#0B0D10',
    theme_color: '#0B0D10',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
