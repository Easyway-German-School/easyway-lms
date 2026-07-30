/**
 * What makes the online branch different — in one place.
 *
 * The online branch is deliberately a normal `Branch` row, so branch + level
 * queries, fees, spaces, tutors, certificates and promotion all work on it
 * unchanged. Only the genuine differences live here.
 *
 * No prisma import: the signup form, the shells and the student dashboard all
 * need `isOnlineBranchName`, and any server-only dependency would stop this
 * crossing into the browser.
 */

export const ONLINE_BRANCH_NAME = "Online";

/** Branch names that mean "delivered over video", however they were typed. */
const ONLINE_NAME_KEYWORDS = ["online", "virtual", "remote"] as const;

/**
 * Detect an online branch from its name.
 *
 * `Branch.mode` is the real source of truth, but the name is what most call
 * sites have to hand (the signup form has only the dropdown label, and
 * `feeTierForBranch` takes a name). Both agree because the seeder sets them
 * together; this is the fallback for a branch an admin typed by hand.
 */
export function isOnlineBranchName(branchName?: string | null): boolean {
  const name = String(branchName ?? "").toLowerCase();
  return ONLINE_NAME_KEYWORDS.some((keyword) => name.includes(keyword));
}

/** The authoritative check, when the caller actually has the branch row. */
export function isOnlineBranch(branch?: { name?: string | null; mode?: string | null } | null): boolean {
  if (!branch) return false;
  if (branch.mode) return branch.mode === "online";
  return isOnlineBranchName(branch.name);
}

/**
 * How an online student joins class. Asked at signup because it decides what
 * we optimise for: a phone on mobile data is a different product from a laptop
 * on fibre, and the classroom uses this to pick its opening video quality
 * instead of making everyone discover Data Saver the hard way.
 */
export const CONNECTION_OPTIONS = [
  { value: "fibre", label: "Home fibre / broadband", hint: "Stable — full video by default" },
  { value: "wifi", label: "Wi-Fi router (MiFi / hotspot)", hint: "Usually fine — we watch and adapt" },
  { value: "mobile", label: "Mobile data (4G / 5G)", hint: "We start you on a lighter stream" },
  { value: "shared", label: "Shared or public Wi-Fi", hint: "We start you on a lighter stream" },
  { value: "unstable", label: "It drops a lot", hint: "We start you audio-first and record everything" },
] as const;

export const DEVICE_OPTIONS = [
  { value: "phone", label: "Phone" },
  { value: "laptop", label: "Laptop or desktop" },
  { value: "tablet", label: "Tablet" },
  { value: "shared-device", label: "A shared or borrowed device" },
] as const;

/**
 * Online students are not all in Nigeria — the branch exists partly to reach
 * the diaspora — so their timetable has to be shown in their own time. Kept to
 * the offsets the school actually sees rather than the full IANA list.
 */
export const TIMEZONE_OPTIONS = [
  { value: "Africa/Lagos", label: "Nigeria (WAT, UTC+1)" },
  { value: "Europe/Berlin", label: "Germany (CET/CEST)" },
  { value: "Europe/London", label: "United Kingdom (GMT/BST)" },
  { value: "Africa/Nairobi", label: "East Africa (EAT, UTC+3)" },
  { value: "Africa/Accra", label: "Ghana (GMT)" },
  { value: "America/New_York", label: "US Eastern" },
  { value: "America/Chicago", label: "US Central" },
  { value: "America/Los_Angeles", label: "US Pacific" },
  { value: "Asia/Dubai", label: "Gulf (GST, UTC+4)" },
  { value: "Etc/UTC", label: "Somewhere else (UTC)" },
] as const;

export type ConnectionQualityValue = (typeof CONNECTION_OPTIONS)[number]["value"];

/**
 * Opening video quality for a student's stated connection.
 *
 * Starting a mobile-data student on 720p and letting the SFU walk them down
 * costs them ten seconds of frozen video and a bad first impression of the
 * whole branch. Starting low and letting it walk *up* costs nothing.
 */
export function initialVideoQualityFor(connection?: string | null): "high" | "medium" | "low" | "audio" {
  switch (String(connection ?? "").toLowerCase()) {
    case "fibre":
      return "high";
    case "wifi":
      return "medium";
    case "mobile":
    case "shared":
      return "low";
    case "unstable":
      return "audio";
    default:
      return "medium";
  }
}

/** Read the online answers back out of the `admission` JSON blob. */
export type OnlineProfile = {
  timezone?: string;
  device?: string;
  connection?: string;
  dataSaverDefault?: boolean;
};

export function readOnlineProfile(admission: unknown): OnlineProfile {
  if (!admission || typeof admission !== "object") return {};
  const record = admission as Record<string, unknown>;
  const raw = (record.online ?? record) as Record<string, unknown>;
  return {
    timezone: typeof raw.timezone === "string" ? raw.timezone : undefined,
    device: typeof raw.device === "string" ? raw.device : undefined,
    connection: typeof raw.connection === "string" ? raw.connection : undefined,
    dataSaverDefault: typeof raw.dataSaverDefault === "boolean" ? raw.dataSaverDefault : undefined,
  };
}
