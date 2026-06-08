// The BUMBOT robot mark — a plain robot head (no chef hat), matching the Button
// Up Media brand: a charcoal head with light-grey antenna, ears, and eyes so the
// face reads on the dark chrome. Brand chrome — it never uses the status palette.
export default function BumbotMark({ size = 30, className }) {
  const head = '#2f343d';
  const accent = '#ccd2db';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="BUMBOT"
      fill="none"
    >
      {/* antenna */}
      <circle cx="32" cy="8" r="4" fill={accent} />
      <rect x="30.4" y="9.5" width="3.2" height="8" rx="1.6" fill={accent} />
      {/* ears (behind the head) */}
      <rect x="7" y="26.5" width="9" height="15" rx="4" fill={accent} />
      <rect x="48" y="26.5" width="9" height="15" rx="4" fill={accent} />
      {/* head */}
      <rect x="12.5" y="16.5" width="39" height="32" rx="8.5" fill={head} />
      {/* eyes */}
      <circle cx="25.5" cy="33" r="4.1" fill={accent} />
      <circle cx="38.5" cy="33" r="4.1" fill={accent} />
    </svg>
  );
}
