import type { SVGProps } from 'react';

const paths: Record<string, string> = {
  dashboard: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  cart: 'M6 6h15l-1.5 8.5H7.5L6 6zm0 0L5 3H2m5 18a1 1 0 100-2 1 1 0 000 2zm11 0a1 1 0 100-2 1 1 0 000 2z',
  box: 'M21 8L12 3 3 8v8l9 5 9-5V8zm-9 5L3 8m9 5l9-5m-9 5v8',
  layers: 'M12 3l9 5-9 5-9-5 9-5zm-9 9l9 5 9-5m-18 4l9 5 9-5',
  history: 'M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8m0-5v5h5m4-1v5l3 2',
  cash: 'M2 7h20v10H2V7zm10 8a3 3 0 100-6 3 3 0 000 6zM5 7v10m14-10v10',
  chart: 'M4 20V10m6 10V4m6 16v-7m6 7H2',
  search: 'M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z',
  plus: 'M12 5v14m-7-7h14',
  minus: 'M5 12h14',
  trash: 'M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14',
  print:
    'M6 9V3h12v6M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2m-12-4h12v7H6v-7z',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4m7 14l5-5-5-5m5 5H9',
  scan: 'M3 7V4h3m12 0h3v3m0 10v3h-3M6 20H3v-3M7 12h10',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18M6 6l12 12',
  alert: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  info: 'M12 22a10 10 0 100-20 10 10 0 000 20zm0-14v4m0 4h.01',
  edit: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7m-1.5-9.5a2.1 2.1 0 013 3L12 18l-4 1 1-4 9.5-9.5z',
  refresh: 'M23 4v6h-6M1 20v-6h6m-3.5-4A9 9 0 0119.4 6.4L23 10M1 14l3.6 3.6A9 9 0 0020.5 14',
  card: 'M2 7h20v10H2V7zm0 3h20',
  qr: 'M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm11 0h3v3h-3v-3zm4 4h3v3h-3v-3z',
  receipt: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2V3zm3 5h8m-8 4h8m-8 4h5',
  tag: 'M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8zM7 7h.01',
  user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2m8-9a4 4 0 100-8 4 4 0 000 8z',
  arrowLeft: 'M19 12H5m7 7l-7-7 7-7',
  undo: 'M3 7v6h6M21 17a9 9 0 00-15-6.7L3 13',
  lock: 'M5 11h14v10H5V11zm3 0V7a4 4 0 118 0v4',
  unlock: 'M5 11h14v10H5V11zm3 0V7a4 4 0 017.8-1',
  grid: 'M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm11 0h7v7h-7v-7z',
  coffee: 'M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zm4-6v3m4-3v3m4-3v3',
  food: 'M3 11h18a9 9 0 00-18 0zm-1 3h20M4 17h16l-1 3H5l-1-3z',
  snack: 'M7 3h10l1 4H6l1-4zm-2 4h14l-1 14H6L5 7zm4 4v6m6-6v6',
  wallet: 'M21 7H5a2 2 0 01-2-2 2 2 0 012-2h14v4zm0 0v12H5a2 2 0 01-2-2V5m14 8h4v4h-4a2 2 0 010-4z',
  trend: 'M23 6l-9.5 9.5-5-5L1 18m16-12h6v6',
  expand: 'M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5',
  collapse: 'M3 8h5V3m13 5h-5V3M3 16h5v5m13-5h-5v5',
  monitor: 'M2 4h20v12H2V4zm6 16h8m-4-4v4',
};

export interface IconProps extends SVGProps<SVGSVGElement> {
  name: keyof typeof paths | string;
  size?: number;
}

export function Icon({ name, size = 18, ...rest }: IconProps) {
  const d = paths[name] ?? paths.info!;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={d} />
    </svg>
  );
}
