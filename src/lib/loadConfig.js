// Web/config loader. Next.js (webpack) imports JSON natively, so both server
// and client modules read config.json through this single shim. config.json
// holds only IDs / names / quota — no secrets (those are env vars).
import config from '../../config.json';

export default config;
