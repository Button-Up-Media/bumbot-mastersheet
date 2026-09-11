import Board from '@/components/Board.js';

// The board is fully client-driven (it polls /api/board), so the page itself is
// a thin server shell. The board is open (no passcode) but noindexed — see
// next.config.mjs (X-Robots-Tag) + the robots metadata in layout.js.
export default function Page() {
  return <Board />;
}
