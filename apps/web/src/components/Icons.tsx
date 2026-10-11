/** Inline stroke icons, 20px grid, inheriting `currentColor`. */

type Props = { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
});

export const HomeIcon = ({ size = 20 }: Props) => (
  <svg {...base(size)}>
    <path d="M3 10.6 12 3.5l9 7.1V20a1 1 0 0 1-1 1h-5v-6H10v6H4a1 1 0 0 1-1-1z" />
  </svg>
);

export const PeopleIcon = ({ size = 20 }: Props) => (
  <svg {...base(size)}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.4c1.8.9 3 2.7 3 4.8" />
  </svg>
);

export const CalendarIcon = ({ size = 20 }: Props) => (
  <svg {...base(size)}>
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

export const FormsIcon = ({ size = 20 }: Props) => (
  <svg {...base(size)}>
    <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
    <path d="M14 3v5h5M8.5 13h7M8.5 17h4" />
  </svg>
);

export const ChartIcon = ({ size = 20 }: Props) => (
  <svg {...base(size)}>
    <path d="M4 20V11M10 20V4M16 20v-6M22 20H2" />
  </svg>
);

export const SearchIcon = ({ size = 18 }: Props) => (
  <svg {...base(size)} strokeWidth={1.9}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
);
