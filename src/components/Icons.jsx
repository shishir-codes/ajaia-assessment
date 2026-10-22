// Inline SVG icons. All are decorative (aria-hidden); the buttons that use them carry the label.
function Svg({ children, className = 'icon', viewBox = '0 0 24 24' }) {
  return (
    <svg
      className={className}
      viewBox={viewBox}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function LogoMark({ className = 'brand-mark' }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ajaia-logo-bg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#14b8a6" />
          <stop offset="0.55" stopColor="#0f766e" />
          <stop offset="1" stopColor="#0d5f58" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#ajaia-logo-bg)" />
      <path d="M10 6.5h8.8l4.7 4.7v13.3a1.5 1.5 0 0 1-1.5 1.5H10a1.5 1.5 0 0 1-1.5-1.5V8A1.5 1.5 0 0 1 10 6.5z" fill="#fff" />
      <path d="M18.8 6.5v3.2a1.5 1.5 0 0 0 1.5 1.5h3.2z" fill="#a7f3d0" />
      <path d="M12 15.5h8M12 18.5h8M12 21.5h5" stroke="#0f766e" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="21.5" cy="21.5" r="2.2" fill="#22c55e" />
    </svg>
  );
}

// Empty state art: a small stack of paper pages with a folded corner.
export function EmptyPagesArt({ className = 'state-art' }) {
  return (
    <svg className={className} viewBox="0 0 112 84" aria-hidden="true" focusable="false" fill="none">
      <ellipse cx="56" cy="78" rx="34" ry="4" fill="#0f766e" opacity="0.08" />
      <rect x="24" y="14" width="44" height="56" rx="5" transform="rotate(-9 46 42)" fill="#ecf6f4" stroke="#c3d1ce" />
      <rect x="44" y="12" width="44" height="56" rx="5" transform="rotate(8 66 40)" fill="#f4faf8" stroke="#c3d1ce" />
      <path d="M36 8h22l12 12v50a4 4 0 0 1-4 4H36a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4z" fill="#fff" stroke="#0f766e" strokeWidth="1.5" />
      <path d="M58 8v8a4 4 0 0 0 4 4h8z" fill="#ccfbf1" stroke="#0f766e" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M40 32h22M40 40h22M40 48h14" stroke="#9fd8cd" strokeWidth="3" strokeLinecap="round" />
      <circle cx="64" cy="62" r="7" fill="#22c55e" />
      <path d="M64 58.5v7M60.5 62h7" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export const PlusIcon = (p) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const UploadIcon = (p) => (
  <Svg {...p}>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" />
  </Svg>
);

export const DocIcon = (p) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h6" />
  </Svg>
);

export const BackIcon = (p) => (
  <Svg {...p}>
    <path d="M15 18l-6-6 6-6" />
  </Svg>
);

export const ShareIcon = (p) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    <path d="M18 8v6M15 11h6" />
  </Svg>
);

export const TrashIcon = (p) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </Svg>
);

export const UndoIcon = (p) => (
  <Svg {...p}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
  </Svg>
);

export const RedoIcon = (p) => (
  <Svg {...p}>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H9a5 5 0 0 0 0 10h3" />
  </Svg>
);

export const BulletListIcon = (p) => (
  <Svg {...p}>
    <path d="M10 6h10M10 12h10M10 18h10" />
    <circle cx="5" cy="6" r="1" fill="currentColor" />
    <circle cx="5" cy="12" r="1" fill="currentColor" />
    <circle cx="5" cy="18" r="1" fill="currentColor" />
  </Svg>
);

export const NumberedListIcon = (p) => (
  <Svg {...p}>
    <path d="M10 6h10M10 12h10M10 18h10" />
    <path d="M4 4.5h1.5V9M4 9h3" strokeWidth="1.5" />
    <path d="M4 14.2c.3-.5.9-.8 1.5-.8.8 0 1.5.6 1.5 1.3 0 1.2-3 2.1-3 3.8h3" strokeWidth="1.5" />
  </Svg>
);

export const AlertIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5M12 16.5h.01" />
  </Svg>
);

export const CheckIcon = (p) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);

export const CloseIcon = (p) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const EyeIcon = (p) => (
  <Svg {...p}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
