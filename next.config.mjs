/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep this internal board out of every search index. The X-Robots-Tag header
  // is the authoritative signal (honored on pages AND the JSON APIs), paired
  // with a <meta name="robots"> in the root layout. We deliberately DON'T ship a
  // `Disallow: /` robots.txt — blocking the crawl would stop crawlers from ever
  // seeing the noindex directive, which weakens the guarantee instead of helping.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
    ];
  },
};

export default nextConfig;
