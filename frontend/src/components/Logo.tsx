import { useId } from "react";

/** The Sport Agent mark: a heartbeat pulse on the blue→green tile. Same drawing as public/favicon.svg. */
export default function Logo({ size = 24 }: { size?: number }) {
  const gradient = useId(); // unique per instance: the header and login page can both render one
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2a78d6" />
          <stop offset="1" stopColor="#1baf7a" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gradient})`} />
      <path
        d="M6 17.5h5.2l2.6-6.5 4.2 11 2.8-7h5.2"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
