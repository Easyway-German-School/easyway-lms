"use client";

import { UserIcon } from "@/components/icons";

/**
 * Who teaches you — every tutor the office has linked to this student.
 *
 * The dashboard only ever showed a tutor to PRIVATE students, and only the
 * primary one. A group student the office had put with a tutor — or with two,
 * a campus tutor and an online tutor — saw nobody, which is the "I was never
 * told who my tutor is" message the office kept fielding. This is the group
 * student's version: names, and for a hybrid student which tutor is which.
 *
 * The caller decides WHEN to show it (after the deposit — the tutor is
 * revealed on payment, see lib/tutor-reveal.ts); this only draws it.
 */

type Tutor = { id: string; name: string | null; role?: string | null };

type Props = {
  deliveryMode?: string | null;
  primary: { id: string | null; name: string | null; photoUrl?: string | null } | null;
  coTutors: Tutor[];
};

export function teachingTeamLabel(deliveryMode: string | null | undefined, isPrimary: boolean, role?: string | null): string {
  if (deliveryMode === "hybrid") {
    if (isPrimary) return "Campus tutor";
    return role === "online" ? "Online tutor" : "Co-tutor";
  }
  return isPrimary ? "Tutor" : "Co-tutor";
}

export default function TeachingTeamCard({ deliveryMode, primary, coTutors }: Props) {
  const team = [
    ...(primary?.name ? [{ id: primary.id ?? "primary", name: primary.name, photoUrl: primary.photoUrl ?? null, label: teachingTeamLabel(deliveryMode, true) }] : []),
    ...coTutors
      .filter((tutor) => tutor.name)
      .map((tutor) => ({
        id: tutor.id,
        name: tutor.name as string,
        photoUrl: null as string | null,
        label: teachingTeamLabel(deliveryMode, false, tutor.role),
      })),
  ];
  if (!team.length) return null;

  return (
    <div className="rounded-[32px] border border-[#D4AF37]/25 bg-[radial-gradient(circle_at_15%_0%,_#1c1917_0%,_#0b0a09_60%,_#000000_100%)] p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#E8C766]">
        {team.length > 1 ? "Your teaching team" : "Your tutor"}
      </p>
      <ul className="mt-4 space-y-3">
        {team.map((tutor) => (
          <li key={tutor.id} className="flex items-center gap-3">
            <span className="grid h-11 w-11 flex-none place-items-center overflow-hidden rounded-full border border-[#D4AF37]/40 bg-[#D4AF37]/10 text-[#E8C766]">
              {tutor.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={tutor.photoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <UserIcon className="h-5 w-5" />
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{tutor.name}</p>
              <p className="truncate text-xs text-white/50">{tutor.label}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
