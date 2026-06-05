// The BUM BOT chef-robot mark, inline so it inherits chrome color via
// currentColor (the header paints it Paper). Eyes/mouth are knocked out in the
// chrome background color so the face reads on the dark header. This is brand
// chrome — it never uses the status palette.
export default function BumbotMark({ size = 30, eye = 'var(--ink)', className }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="BUM BOT"
      fill="none"
    >
      <g fill="currentColor">
        <circle cx="22" cy="18" r="9" />
        <circle cx="32" cy="14" r="10" />
        <circle cx="42" cy="18" r="9" />
        <circle cx="16" cy="22" r="6.5" />
        <circle cx="48" cy="22" r="6.5" />
        <rect x="17" y="23" width="30" height="8" rx="2.5" />
        <rect x="12" y="38" width="4" height="9" rx="2" />
        <rect x="48" y="38" width="4" height="9" rx="2" />
        <rect x="16" y="31" width="32" height="25" rx="6" />
      </g>
      <g fill={eye}>
        <circle cx="26" cy="41" r="3.2" />
        <circle cx="38" cy="41" r="3.2" />
        <rect x="25" y="47.5" width="14" height="3.2" rx="1.6" />
      </g>
    </svg>
  );
}
