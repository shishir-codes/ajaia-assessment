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
      <rect width="32" height="32" rx="8" fill="#0f766e" />
      <path d="M10 7.5h8.5l4.5 4.5v12.5H10z" fill="#fff" />
      <path d="M18.5 7.5V12H23" fill="#ccfbf1" />
      <path d="M13 16h7M13 19h7M13 22h4.5" stroke="#0f766e" strokeWidth="1.6" strokeLinecap="round" />
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
