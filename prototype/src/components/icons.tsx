import type { ReactNode, SVGProps } from "react";

/**
 * The school's icon set.
 *
 * One vocabulary for the whole app. Before this file the three portals each
 * kept their own private handful of SVGs and everything else in the product
 * reached for an emoji, so the same idea appeared four different ways: a
 * lecture was 🎓 on one screen, a mortarboard SVG on another, and "◈" in a
 * sidebar. Emoji also render as whatever the operating system feels like —
 * a flat glyph on Windows, a glossy one on a Mac — which is why they read as
 * stray next to everything else on the page.
 *
 * House style, matching the SVGs the shells already used:
 *   24x24 box, no fill, 1.8 stroke, round caps and joins, currentColor.
 *
 * So an icon takes its colour from whatever it sits in and its size from a
 * Tailwind class. Default is h-4 w-4 because that is what the sidebars want;
 * pass className to go bigger.
 *
 *   <FlameIcon />
 *   <FlameIcon className="h-6 w-6 text-orange-500" />
 *
 * Everything here is decorative — aria-hidden is set on the <svg> — so the
 * meaning must live in neighbouring text, not in the icon alone.
 */

export type IconProps = {
  className?: string;
  strokeWidth?: number;
} & Omit<SVGProps<SVGSVGElement>, "className" | "strokeWidth">;

function icon(displayName: string, art: ReactNode) {
  function Icon({ className = "h-4 w-4", strokeWidth = 1.8, ...rest }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        className={className}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {art}
      </svg>
    );
  }
  Icon.displayName = displayName;
  return Icon;
}

/* ---------------------------------------------------------------- navigation */

export const DashboardIcon = icon("DashboardIcon", (
  <>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="4" rx="1.5" />
    <rect x="14" y="9" width="7" height="12" rx="1.5" />
    <rect x="3" y="12" width="7" height="9" rx="1.5" />
  </>
));

export const CalendarIcon = icon("CalendarIcon", (
  <>
    <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
    <path d="M8 2.5v4M16 2.5v4M3 10h18" />
  </>
));

export const TimetableIcon = icon("TimetableIcon", (
  <>
    <path d="M21 11V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6" />
    <path d="M8 3v4M16 3v4M3 11h18" />
    <circle cx="17.5" cy="17.5" r="4.5" />
    <path d="M17.5 15.6v2l1.3 1.1" />
  </>
));

export const ClockIcon = icon("ClockIcon", (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.2l3.4 2" />
  </>
));

export const BroadcastIcon = icon("BroadcastIcon", (
  <>
    <circle cx="12" cy="12" r="2.5" />
    <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4" />
    <path d="M4.9 4.9a10 10 0 0 0 0 14.2M19.1 19.1a10 10 0 0 0 0-14.2" />
  </>
));

export const VideoIcon = icon("VideoIcon", (
  <>
    <rect x="2" y="6" width="14" height="12" rx="2.5" />
    <path d="m17 10 5-3v10l-5-3z" />
  </>
));

export const PencilIcon = icon("PencilIcon", (
  <>
    <path d="M16.6 3.4a2.1 2.1 0 0 1 3 3L7.5 18.5 3 20l1.5-4.5z" />
    <path d="m14.5 5.5 4 4" />
  </>
));

export const BookOpenIcon = icon("BookOpenIcon", (
  <>
    <path d="M12 7.5v13" />
    <path d="M3 5h4.5A4.5 4.5 0 0 1 12 7.5 4.5 4.5 0 0 1 16.5 5H21v13h-5a4 4 0 0 0-4 2.5A4 4 0 0 0 8 18H3z" />
  </>
));

export const CommunityIcon = icon("CommunityIcon", (
  <>
    <path d="M20 13.5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3.5V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5z" />
    <circle cx="8.5" cy="10" r="1" />
    <circle cx="12" cy="10" r="1" />
    <circle cx="15.5" cy="10" r="1" />
  </>
));

export const ResultsIcon = icon("ResultsIcon", (
  <>
    <path d="M3 21h18" />
    <rect x="4.5" y="12" width="4" height="6" rx="1" />
    <rect x="10" y="8" width="4" height="10" rx="1" />
    <rect x="15.5" y="4" width="4" height="14" rx="1" />
  </>
));

export const ExamCentreIcon = icon("ExamCentreIcon", (
  <>
    <path d="M2.5 9.5 12 4l9.5 5.5" />
    <path d="M4.5 10.5V18M9.5 10.5V18M14.5 10.5V18M19.5 10.5V18" />
    <path d="M3 21h18" />
  </>
));

export const AttendanceIcon = icon("AttendanceIcon", (
  <>
    <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
    <path d="M8 2.5v4M16 2.5v4M3 10h18" />
    <path d="m8.5 15 2 2 4-4" />
  </>
));

export const CertificateIcon = icon("CertificateIcon", (
  <>
    <circle cx="12" cy="9" r="5.5" />
    <path d="m8.5 13.6-1.2 7.4L12 18.7l4.7 2.3-1.2-7.4" />
  </>
));

export const BellIcon = icon("BellIcon", (
  <>
    <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9" />
    <path d="M13.7 19a2 2 0 0 1-3.4 0" />
  </>
));

export const BellOffIcon = icon("BellOffIcon", (
  <>
    <path d="M18.5 14.5c-.4-.9-.5-2.6-.5-5.5a6 6 0 0 0-8.6-5.4" />
    <path d="M6.3 6.3A6 6 0 0 0 6 9c0 5-2 6.5-2 6.5h12.5" />
    <path d="M13.7 19a2 2 0 0 1-3.4 0" />
    <path d="m3 3 18 18" />
  </>
));

export const PaymentIcon = icon("PaymentIcon", (
  <>
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <path d="M2.5 10h19" />
    <path d="M6.5 14.5h3" />
  </>
));

export const WalletIcon = icon("WalletIcon", (
  <>
    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18v2.5" />
    <path d="M3 7.5v9A2.5 2.5 0 0 0 5.5 19h13a2.5 2.5 0 0 0 2.5-2.5v-6a2.5 2.5 0 0 0-2.5-2.5H3" />
    <path d="M16.5 13.5h.01" />
  </>
));

export const ProfileIcon = icon("ProfileIcon", (
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="10" r="3" />
    <path d="M5.9 19a6.5 6.5 0 0 1 12.2 0" />
  </>
));

export const SettingsIcon = icon("SettingsIcon", (
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H10a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V10a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1" />
  </>
));

/* --------------------------------------------------------------------- people */

export const UsersIcon = icon("UsersIcon", (
  <>
    <path d="M16 21v-1.8a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V21" />
    <circle cx="9.5" cy="7.5" r="3.5" />
    <path d="M22 21v-1.8a4 4 0 0 0-3-3.87" />
    <path d="M16.5 4.2a4 4 0 0 1 0 7.6" />
  </>
));

export const UserIcon = icon("UserIcon", (
  <>
    <path d="M19 21v-2a5 5 0 0 0-5-5h-4a5 5 0 0 0-5 5v2" />
    <circle cx="12" cy="7.5" r="4" />
  </>
));

export const UserPlusIcon = icon("UserPlusIcon", (
  <>
    <path d="M15 21v-2a5 5 0 0 0-5-5H7a5 5 0 0 0-5 5v2" />
    <circle cx="8.5" cy="7.5" r="4" />
    <path d="M18.5 8v6M21.5 11h-6" />
  </>
));

export const PrivateClassIcon = icon("PrivateClassIcon", (
  <>
    <circle cx="9.5" cy="7.5" r="4" />
    <path d="M2.5 20.5v-1.5a5.5 5.5 0 0 1 5.5-5.5h2" />
    <rect x="13.5" y="15" width="8" height="6.5" rx="1.6" />
    <path d="M15.5 15v-2a2 2 0 0 1 4 0v2" />
  </>
));

export const LecturerIcon = icon("LecturerIcon", (
  <>
    <path d="M12 3 2.5 8 12 13l9.5-5z" />
    <path d="M6.5 10.5V16c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-5.5" />
    <path d="M21.5 8v6" />
  </>
));

export const RosterIcon = icon("RosterIcon", (
  <>
    <rect x="4" y="3" width="16" height="18" rx="2.5" />
    <path d="M9 3v18" />
    <path d="M13 8h4M13 12h4M13 16h4" />
  </>
));

/* -------------------------------------------------------------- coursework */

export const AssignmentIcon = icon("AssignmentIcon", (
  <>
    <path d="M9 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
    <rect x="9" y="2.5" width="6" height="3.5" rx="1.2" />
    <path d="M9 12h6M9 16h4" />
  </>
));

export const GradebookIcon = icon("GradebookIcon", (
  <>
    <path d="M9 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
    <rect x="9" y="2.5" width="6" height="3.5" rx="1.2" />
    <path d="m8.8 12.5 1.7 1.7 3.7-3.7" />
    <path d="M8.8 17.5h6.4" />
  </>
));

export const ExamIcon = icon("ExamIcon", (
  <>
    <path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5z" />
    <path d="M14 2.5v5h5" />
    <path d="m9 14.5 1.8 1.8 3.6-3.6" />
  </>
));

export const LessonBuilderIcon = icon("LessonBuilderIcon", (
  <>
    <path d="m12 2.5 9 4.5-9 4.5-9-4.5z" />
    <path d="m3 12 9 4.5 9-4.5" />
    <path d="m3 16.5 9 4.5 9-4.5" />
  </>
));

export const CustomiseIcon = icon("CustomiseIcon", (
  <>
    <path d="M4 6h7M16 6h4M4 12h4M13 12h7M4 18h9M18 18h2" />
    <circle cx="13.5" cy="6" r="2.2" />
    <circle cx="10.5" cy="12" r="2.2" />
    <circle cx="15.5" cy="18" r="2.2" />
  </>
));

export const QuizIcon = icon("QuizIcon", (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.3a2.5 2.5 0 1 1 3.3 3c-.6.3-.9.9-.9 1.6" />
    <path d="M12 17.2h.01" />
  </>
));

export const EssayIcon = icon("EssayIcon", (
  <>
    <path d="M20.5 3.5C11.7 4.6 6.6 9.4 5 15l3.9 3.9C14.5 17.3 19.4 12.3 20.5 3.5" />
    <path d="M8.5 15.5 13 11" />
    <path d="m3 21 2.5-2.5" />
  </>
));

/* ------------------------------------------------------------------- content */

export const DocumentIcon = icon("DocumentIcon", (
  <>
    <path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5z" />
    <path d="M14 2.5v5h5" />
    <path d="M9 13h6M9 17h4" />
  </>
));

export const SlideDeckIcon = icon("SlideDeckIcon", (
  <>
    <rect x="3" y="3.5" width="18" height="12" rx="2" />
    <path d="M12 15.5V19" />
    <path d="m8.5 21.5 3.5-2.5 3.5 2.5" />
  </>
));

export const AudioIcon = icon("AudioIcon", (
  <>
    <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
    <rect x="2.5" y="13.5" width="4.5" height="6.5" rx="2.2" />
    <rect x="17" y="13.5" width="4.5" height="6.5" rx="2.2" />
  </>
));

export const ImageIcon = icon("ImageIcon", (
  <>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <circle cx="8.5" cy="9.5" r="1.7" />
    <path d="m4 17.5 4.5-4.5 4 3.5 3-2.5 4.5 4" />
  </>
));

export const FilmIcon = icon("FilmIcon", (
  <>
    <rect x="2.5" y="4" width="19" height="16" rx="2.5" />
    <path d="M7 4v16M17 4v16M2.5 12h19M2.5 8h4.5M2.5 16h4.5M17 8h4.5M17 16h4.5" />
  </>
));

export const PlayIcon = icon("PlayIcon", (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M10.2 8.6 15.5 12l-5.3 3.4z" />
  </>
));

export const FolderIcon = icon("FolderIcon", (
  <path d="M3 7.5A2 2 0 0 1 5 5.5h3.6a2 2 0 0 1 1.5.7l1.2 1.4H19a2 2 0 0 1 2 2v7.4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
));

export const AttachmentIcon = icon("AttachmentIcon", (
  <path d="M20 11.5 12.3 19a4.6 4.6 0 0 1-6.5-6.5l7.7-7.6a3 3 0 0 1 4.3 4.3l-7.7 7.6a1.5 1.5 0 0 1-2.1-2.1l7-7" />
));

export const LinkIcon = icon("LinkIcon", (
  <>
    <path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.6 1.6" />
    <path d="M14 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.6-1.6" />
  </>
));

export const UploadIcon = icon("UploadIcon", (
  <>
    <path d="M21 15.5v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3" />
    <path d="M12 3.5v11" />
    <path d="m7.5 8 4.5-4.5L16.5 8" />
  </>
));

export const DownloadIcon = icon("DownloadIcon", (
  <>
    <path d="M21 15.5v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3" />
    <path d="M12 3.5v11" />
    <path d="M7.5 10 12 14.5 16.5 10" />
  </>
));

export const PackageIcon = icon("PackageIcon", (
  <>
    <path d="M20.5 7.8v8.4a2 2 0 0 1-1 1.7l-6.5 3.7a2 2 0 0 1-2 0l-6.5-3.7a2 2 0 0 1-1-1.7V7.8a2 2 0 0 1 1-1.7l6.5-3.7a2 2 0 0 1 2 0l6.5 3.7a2 2 0 0 1 1 1.7" />
    <path d="m3.8 6.9 8.2 4.7 8.2-4.7M12 21v-9.4" />
  </>
));

export const PrinterIcon = icon("PrinterIcon", (
  <>
    <path d="M6.5 9V3.5h11V9" />
    <path d="M6.5 17.5H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1.5" />
    <rect x="6.5" y="14" width="11" height="6.5" rx="1.5" />
  </>
));

/* ------------------------------------------------------------------ progress */

export const FlameIcon = icon("FlameIcon", (
  <>
    <path d="M12 2.5c3.5 4 6 6.5 6 10a6 6 0 0 1-12 0c0-1.7.7-3.2 2-4.6.3 1.4 1 2.3 2 2.6.4-3.4 1-6 2-8" />
    <path d="M12 21a3 3 0 0 0 3-3c0-1.4-1-2.4-3-4-2 1.6-3 2.6-3 4a3 3 0 0 0 3 3" />
  </>
));

export const TrophyIcon = icon("TrophyIcon", (
  <>
    <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
    <path d="M7 5.5H4.5v1.5A3.5 3.5 0 0 0 8 10.5M17 5.5h2.5V7A3.5 3.5 0 0 1 16 10.5" />
    <path d="M12 14v3.5M8.5 21h7M9.5 17.5h5V21" />
  </>
));

export const MedalIcon = icon("MedalIcon", (
  <>
    <path d="M7.5 2.5 10 8M16.5 2.5 14 8" />
    <circle cx="12" cy="14.5" r="6" />
    <path d="m12 11.5 1 2.1 2.2.3-1.6 1.6.4 2.3-2-1.1-2 1.1.4-2.3L8.8 14l2.2-.3z" />
  </>
));

export const TargetIcon = icon("TargetIcon", (
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.3" />
  </>
));

export const TrendingUpIcon = icon("TrendingUpIcon", (
  <>
    <path d="m3 16.5 5.5-5.5 3.5 3.5L21 5.5" />
    <path d="M15.5 5.5H21v5.5" />
  </>
));

export const TrendingDownIcon = icon("TrendingDownIcon", (
  <>
    <path d="m3 7.5 5.5 5.5 3.5-3.5L21 18.5" />
    <path d="M15.5 18.5H21V13" />
  </>
));

export const SparklesIcon = icon("SparklesIcon", (
  <>
    <path d="m12 3 1.7 4.6L18.5 9l-4.8 1.4L12 15l-1.7-4.6L5.5 9l4.8-1.4z" />
    <path d="M18.5 15.5 19.4 18l2.6.8-2.6.9-.9 2.5-.9-2.5-2.6-.9 2.6-.8z" />
  </>
));

export const LevelUpIcon = icon("LevelUpIcon", (
  <>
    <path d="M12 3.5 5 10.5h4v10h6v-10h4z" />
  </>
));

export const StarIcon = icon("StarIcon", (
  <path d="m12 3 2.7 5.7 6.1.9-4.4 4.4 1 6.2-5.4-2.9-5.4 2.9 1-6.2L3.2 9.6l6.1-.9z" />
));

/* ------------------------------------------------------------------- status */

export const CheckIcon = icon("CheckIcon", (
  <path d="m4.5 12.5 5 5 10-11" />
));

export const CheckCircleIcon = icon("CheckCircleIcon", (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.2 2.7 2.7L16.2 9.4" />
  </>
));

export const CrossIcon = icon("CrossIcon", (
  <path d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5" />
));

/** Opens the sidebar on a phone, where it is a drawer rather than a column. */
export const MenuIcon = icon("MenuIcon", (
  <path d="M4 7h16M4 12h16M4 17h16" />
));

export const CrossCircleIcon = icon("CrossCircleIcon", (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m9 9 6 6M15 9l-6 6" />
  </>
));

export const AlertIcon = icon("AlertIcon", (
  <>
    <path d="M10.3 3.9a2 2 0 0 1 3.4 0l7.4 12.7a2 2 0 0 1-1.7 3H4.6a2 2 0 0 1-1.7-3z" />
    <path d="M12 9.5v4.2M12 17.2h.01" />
  </>
));

export const InfoIcon = icon("InfoIcon", (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.2M12 7.8h.01" />
  </>
));

export const PendingIcon = icon("PendingIcon", (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12h.01M12 12h.01M16 12h.01" />
  </>
));

export const EmptyIcon = icon("EmptyIcon", (
  <>
    <rect x="3" y="7" width="18" height="13.5" rx="2" />
    <path d="M3 7l2.2-3.2A2 2 0 0 1 6.8 3h10.4a2 2 0 0 1 1.6.8L21 7" />
    <path d="M9.5 11.5h5" />
  </>
));

/* ------------------------------------------------------------------ security */

export const LockIcon = icon("LockIcon", (
  <>
    <rect x="4" y="10" width="16" height="11" rx="2.5" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    <path d="M12 14.5v2.5" />
  </>
));

export const UnlockIcon = icon("UnlockIcon", (
  <>
    <rect x="4" y="10" width="16" height="11" rx="2.5" />
    <path d="M8 10V7a4 4 0 0 1 7.4-2.1" />
    <path d="M12 14.5v2.5" />
  </>
));

export const ShieldIcon = icon("ShieldIcon", (
  <>
    <path d="M12 2.5 4.5 5.5v6c0 4.6 3.1 8.4 7.5 10 4.4-1.6 7.5-5.4 7.5-10v-6z" />
    <path d="m9 12 2.2 2.2L15.2 10" />
  </>
));

export const KeyIcon = icon("KeyIcon", (
  <>
    <circle cx="8" cy="16" r="3.5" />
    <path d="m10.5 13.5 8-8" />
    <path d="m15.5 8.5 2 2M18 6l2.2 2.2" />
  </>
));

/* --------------------------------------------------------------- comms & ops */

export const MailIcon = icon("MailIcon", (
  <>
    <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
    <path d="m3.5 7 7.4 5.3a2 2 0 0 0 2.2 0L20.5 7" />
  </>
));

export const SendIcon = icon("SendIcon", (
  <>
    <path d="M21 3 10.5 13.5" />
    <path d="M21 3 14.4 21l-3.9-7.5L3 9.6z" />
  </>
));

export const InboxIcon = icon("InboxIcon", (
  <>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M3 13.5h4.5l1.4 2.3h6.2l1.4-2.3H21" />
  </>
));

export const BranchIcon = icon("BranchIcon", (
  <>
    <path d="M4 21V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v15" />
    <path d="M15 10h3a2 2 0 0 1 2 2v9" />
    <path d="M2.5 21h19" />
    <path d="M8 8h3M8 12h3M8 16h3" />
  </>
));

export const IntegrationIcon = icon("IntegrationIcon", (
  <>
    <path d="M9 2.5v5M15 2.5v5" />
    <path d="M6.5 7.5h11v4a5.5 5.5 0 0 1-11 0z" />
    <path d="M12 17v4.5" />
  </>
));

export const PaletteIcon = icon("PaletteIcon", (
  <>
    <path d="M12 21a9 9 0 1 1 9-9c0 1.9-1.6 2.6-3.2 2.6h-1.5a2 2 0 0 0-1.4 3.4c.5.6.2 3-2.9 3" />
    <path d="M7.5 10.5h.01M10.5 7.5h.01M14.5 7.8h.01M17 11h.01" />
  </>
));

export const RobotIcon = icon("RobotIcon", (
  <>
    <rect x="4" y="8" width="16" height="12" rx="3" />
    <path d="M12 4.5V8" />
    <circle cx="12" cy="3.2" r="1.2" />
    <path d="M9 13h.01M15 13h.01M9.5 16.5h5" />
  </>
));

export const CompassIcon = icon("CompassIcon", (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.5 8.5-2 5-5 2 2-5z" />
  </>
));

export const MapIcon = icon("MapIcon", (
  <>
    <path d="m9 4.5-6 2.5v12.5l6-2.5 6 2.5 6-2.5V4.5l-6 2.5z" />
    <path d="M9 4.5V17M15 7v12.5" />
  </>
));

export const PinIcon = icon("PinIcon", (
  <>
    <path d="M12 21.5c4-4.5 7-7.8 7-11.2a7 7 0 1 0-14 0c0 3.4 3 6.7 7 11.2" />
    <circle cx="12" cy="10" r="2.6" />
  </>
));

export const SearchIcon = icon("SearchIcon", (
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m16.2 16.2 4.3 4.3" />
  </>
));

export const RefreshIcon = icon("RefreshIcon", (
  <>
    <path d="M20.5 11a8.5 8.5 0 0 0-14.6-5L3 9" />
    <path d="M3.5 13a8.5 8.5 0 0 0 14.6 5l2.9-3" />
    <path d="M3 4.5V9h4.5M21 19.5V15h-4.5" />
  </>
));

export const DoorIcon = icon("DoorIcon", (
  <>
    <path d="M5.5 21V4a1.5 1.5 0 0 1 1.5-1.5h10A1.5 1.5 0 0 1 18.5 4v17" />
    <path d="M3 21h18" />
    <path d="M14.5 12h.01" />
  </>
));

export const FlagIcon = icon("FlagIcon", (
  <>
    <path d="M5 21V4" />
    <path d="M5 4.5h12.5l-2.2 4 2.2 4H5" />
  </>
));

export const ExitIcon = icon("ExitIcon", (
  <>
    <path d="M15 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3" />
    <path d="M10 8 6 12l4 4" />
    <path d="M6 12h9" />
  </>
));

/* ----------------------------------------------------------------- classroom */

export const MicIcon = icon("MicIcon", (
  <>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
    <path d="M12 18v3.5" />
  </>
));

export const MicOffIcon = icon("MicOffIcon", (
  <>
    <path d="M15 5v-.5a3 3 0 0 0-6 0V11" />
    <path d="M15 9.5v1a3 3 0 0 1-4.4 2.7" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 10.2 5.3M18.5 11.5v-.5" />
    <path d="M12 18v3.5" />
    <path d="m3 3 18 18" />
  </>
));

export const CameraIcon = icon("CameraIcon", (
  <>
    <path d="M4 20.5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.2l1.4-2.4A2 2 0 0 1 9.3 5h5.4a2 2 0 0 1 1.7 1.1L17.8 8.5H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2z" />
    <circle cx="12" cy="14" r="3.6" />
  </>
));

export const ScreenShareIcon = icon("ScreenShareIcon", (
  <>
    <rect x="2.5" y="4" width="19" height="12.5" rx="2.5" />
    <path d="M8.5 20.5h7M12 16.5v4" />
    <path d="M12 12.5V8M9.6 10.4 12 8l2.4 2.4" />
  </>
));

export const SpeakerIcon = icon("SpeakerIcon", (
  <>
    <path d="M11 4.5 6 9H3v6h3l5 4.5z" />
    <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18.5 6.5a7.5 7.5 0 0 1 0 11" />
  </>
));

export const SpeakerOffIcon = icon("SpeakerOffIcon", (
  <>
    <path d="M11 4.5 6 9H3v6h3l5 4.5z" />
    <path d="m16 9.5 5 5M21 9.5l-5 5" />
  </>
));

export const SignalIcon = icon("SignalIcon", (
  <>
    <path d="M4 20.5v-3M9.3 20.5v-6.5M14.7 20.5v-10M20 20.5v-14" />
  </>
));

export const HandIcon = icon("HandIcon", (
  <>
    <path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M14 11V6a1.5 1.5 0 0 1 3 0v5" />
    <path d="M17 11.5V9a1.5 1.5 0 0 1 3 0v5.5a7 7 0 0 1-7 7h-1a6 6 0 0 1-4.6-2.2L4 14.5a1.6 1.6 0 0 1 2.4-2.1L8 14" />
    <path d="M8 14V6.5a1.5 1.5 0 0 1 3 0V11" />
  </>
));

/* ----------------------------------------------------------------- chevrons */

export const ChevronLeftIcon = icon("ChevronLeftIcon", <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />);
export const ChevronRightIcon = icon("ChevronRightIcon", <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />);
export const ChevronDownIcon = icon("ChevronDownIcon", <path d="m5.5 9.5 6.5 6.5 6.5-6.5" />);
export const ArrowRightIcon = icon("ArrowRightIcon", <><path d="M4 12h15" /><path d="m13 6 6 6-6 6" /></>);
export const ArrowLeftIcon = icon("ArrowLeftIcon", <><path d="M20 12H5" /><path d="m11 6-6 6 6 6" /></>);
export const PlusIcon = icon("PlusIcon", <path d="M12 5v14M5 12h14" />);
export const TrashIcon = icon("TrashIcon", (
  <>
    <path d="M3.5 6.5h17" />
    <path d="M9 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h3.4A1.3 1.3 0 0 1 15 4.8v1.7" />
    <path d="M6 6.5 6.9 19a2 2 0 0 0 2 1.9h6.2a2 2 0 0 0 2-1.9L18 6.5" />
    <path d="M10.5 10.5v6M13.5 10.5v6" />
  </>
));
export const EyeIcon = icon("EyeIcon", (
  <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12" />
    <circle cx="12" cy="12" r="3.2" />
  </>
));

/* ----------------------------------------------------------------------- ai */

/** A single pulse line: the activity feed — "what just happened". */
export const PulseIcon = icon("PulseIcon", (
  <path d="M2.5 12h4l2.5-6 4 12 2.5-6h4" />
));

/**
 * A tutor telling their whole class something at once — distinct from MailIcon
 * (one message to one person) and from BroadcastIcon, which is the live-class
 * transmission glyph.
 */
export const BroadcastMessageIcon = icon("BroadcastMessageIcon", (
  <>
    <path d="M3 10.5v3a1.5 1.5 0 0 0 1.5 1.5H7l5.5 4V5L7 9H4.5A1.5 1.5 0 0 0 3 10.5" />
    <path d="M16.5 9.2a4 4 0 0 1 0 5.6" />
    <path d="M19.4 6.4a8 8 0 0 1 0 11.2" />
  </>
));

/* --------------------------------------------------------- the eight roads */

/**
 * One glyph per reason somebody learns German — see lib/germany-goals.ts.
 *
 * These are the only place in the portal where an icon has to carry a whole
 * life plan, so they are drawn as the OBJECT of the goal (a mortarboard, a
 * ward, a front door) rather than as an abstraction of it. A student picking
 * their road scans nine cards in about two seconds and the picture is what
 * they scan.
 */

/** University. */
export const GraduationCapIcon = icon("GraduationCapIcon", (
  <>
    <path d="M12 4 2.5 8.5 12 13l9.5-4.5z" />
    <path d="M6.5 10.8v4.4c0 1.7 2.5 3 5.5 3s5.5-1.3 5.5-3v-4.4" />
    <path d="M21.5 8.5v5" />
  </>
));

/** Ausbildung: a toolbox, because the trade is the point of it. */
export const ToolboxIcon = icon("ToolboxIcon", (
  <>
    <rect x="2.5" y="8.5" width="19" height="11" rx="2" />
    <path d="M9 8.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2.5" />
    <path d="M2.5 13h19" />
    <path d="M9.5 11.5v3M14.5 11.5v3" />
  </>
));

/** Skilled work. */
export const BriefcaseIcon = icon("BriefcaseIcon", (
  <>
    <rect x="2.5" y="7.5" width="19" height="12" rx="2" />
    <path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5" />
    <path d="M2.5 12.5h19" />
    <path d="M10.5 12.5h3" />
  </>
));

/** Nursing and care: a heart on a monitor line. */
export const CareIcon = icon("CareIcon", (
  <>
    <path d="M12 20s-7-4.4-7-9.2A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.8c0 1.2-.44 2.3-1.1 3.3" />
    <path d="M3 15.5h4l1.5-3 2 5 1.6-3.4H16" />
  </>
));

/** Au pair, and anything chosen out of affection rather than paperwork. */
export const HeartIcon = icon("HeartIcon", (
  <path d="M12 20s-7.5-4.7-7.5-9.8A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.8C19.5 15.3 12 20 12 20" />
));

/** Family reunification: two adults and a child, together. */
export const FamilyIcon = icon("FamilyIcon", (
  <>
    <circle cx="7" cy="7" r="2.6" />
    <circle cx="17" cy="7" r="2.6" />
    <circle cx="12" cy="13.5" r="2" />
    <path d="M2.5 19c0-2.6 2-4.4 4.5-4.4S11.5 16.4 11.5 19" />
    <path d="M12.5 19c0-2.6 2-4.4 4.5-4.4s4.5 1.8 4.5 4.4" />
  </>
));

/** Settling: a door of your own. */
export const HomeIcon = icon("HomeIcon", (
  <>
    <path d="M3.5 10.5 12 4l8.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19z" />
    <path d="M9.5 20.5v-6h5v6" />
  </>
));

/** The dense read: the same journey as a list rather than a map. */
export const ListIcon = icon("ListIcon", (
  <>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" strokeWidth="2.6" />
  </>
));

/** The trip itself — and the flight at the top of the journey map. */
export const PlaneIcon = icon("PlaneIcon", (
  <path d="M10.5 19.5 12 15l7.5-2.2a1.8 1.8 0 0 0 0-3.4L4 4.5l2.5 6L11 12l-4.5 1.5L4 12.2l.8 3.3-.8 3.3 3.2-1.6z" />
));
