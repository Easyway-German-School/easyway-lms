import type { ReactNode } from "react";

type IconProps = { className?: string };

function make(children: ReactNode) {
  return function Icon({ className }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {children}
      </svg>
    );
  };
}

export const ArrowRightIcon = make(<path d="M5 12h14M13 6l6 6-6 6" />);
export const CheckIcon = make(<path d="M5 12.5l4.5 4.5L19 7.5" />);
export const PlaneIcon = make(
  <>
    <path d="M21.5 3L2.5 10.5l7 3 3 7 9-17.5z" />
    <path d="M9.5 13.5L21.5 3" />
  </>,
);
export const ClockIcon = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>,
);
export const PenIcon = make(<path d="M4 20l4-1 11-11a2.1 2.1 0 00-3-3L5 16l-1 4zM14 7l3 3" />);
export const PassportIcon = make(
  <>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <circle cx="12" cy="10" r="3" />
    <path d="M8.5 16.5h7" />
  </>,
);
export const PhoneOffIcon = make(
  <>
    <rect x="7" y="2.5" width="10" height="19" rx="2" />
    <path d="M3 3l18 18" />
  </>,
);
export const BanIcon = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M6 6l12 12" />
  </>,
);
export const CalendarIcon = make(
  <>
    <rect x="3" y="4.5" width="18" height="16" rx="2" />
    <path d="M3 9.5h18M8 3v3M16 3v3" />
  </>,
);
export const MapPinIcon = make(
  <>
    <path d="M12 21s7-6.2 7-11.5A7 7 0 005 9.5C5 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </>,
);
export const ShieldCheckIcon = make(
  <>
    <path d="M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6l8-3z" />
    <path d="M8.5 12l2.5 2.5 4.5-5" />
  </>,
);
export const CardIcon = make(
  <>
    <rect x="2.5" y="5" width="19" height="14" rx="2" />
    <path d="M2.5 10h19M6 15h4" />
  </>,
);
export const BankIcon = make(
  <>
    <path d="M3 9l9-5 9 5" />
    <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />
  </>,
);
export const UploadIcon = make(
  <>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
  </>,
);
export const SeatIcon = make(
  <>
    <path d="M7 4h8a2 2 0 012 2v6H5V6a2 2 0 012-2z" />
    <path d="M4 12h16v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM7 17v3M17 17v3" />
  </>,
);
export const FormIcon = make(
  <>
    <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </>,
);
export const GradCapIcon = make(
  <>
    <path d="M2 9l10-5 10 5-10 5L2 9z" />
    <path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5M22 9v6" />
  </>,
);
export const BriefcaseIcon = make(
  <>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M3 13h18" />
  </>,
);
export const HomeIcon = make(
  <>
    <path d="M3 11l9-8 9 8" />
    <path d="M5 10v10h14V10M10 20v-6h4v6" />
  </>,
);
export const MountainIcon = make(<path d="M2 20l6.5-11 4 6.5L15 12l7 8H2z" />);
