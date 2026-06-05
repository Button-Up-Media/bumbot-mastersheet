import Board from '@/components/Board.js';

// The board is fully client-driven (it polls /api/board), so the page itself is
// a thin server shell. Auth is enforced upstream by the Edge middleware.
export default function Page() {
  return <Board />;
}
