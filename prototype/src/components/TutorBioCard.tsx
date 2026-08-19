"use client";

import { UserIcon, StarIcon } from "@/components/icons";

/**
 * Who you're actually paying for. Shows up right under the session widget on
 * a private student's dashboard — the piece that turns "a tutor" into a real
 * person with a name, a specialty and a photo, which is most of what
 * justifies the price over a group seat.
 */

type Props = {
  tutorName?: string | null;
  tutorPhotoUrl?: string | null;
  tutorSpecialization?: string | null;
  tutorBio?: string | null;
};

export default function TutorBioCard({ tutorName, tutorPhotoUrl, tutorSpecialization, tutorBio }: Props) {
  if (!tutorName) return null;

  return (
    <div className="relative overflow-hidden rounded-[32px] border border-[#D4AF37]/25 bg-[radial-gradient(circle_at_15%_0%,_#1c1917_0%,_#0b0a09_60%,_#000000_100%)] p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-10 -bottom-10 h-40 w-40 rounded-full bg-[#D4AF37] opacity-[0.12] blur-3xl"
      />
      <div className="relative flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#E8C766]">Your tutor</p>
        <span className="inline-flex items-center gap-1 text-[#E8C766]/70">
          {[0, 1, 2].map((i) => (
            <StarIcon key={i} className="h-3 w-3" strokeWidth={1.4} />
          ))}
        </span>
      </div>

      <div className="relative mt-4 flex items-center gap-4">
        <span className="grid h-16 w-16 flex-none place-items-center overflow-hidden rounded-full border border-[#D4AF37]/40 bg-[#D4AF37]/10 text-[#E8C766]">
          {tutorPhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tutorPhotoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <UserIcon className="h-7 w-7" />
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-white">{tutorName}</p>
          {tutorSpecialization && <p className="mt-0.5 truncate text-sm text-[#E8C766]">{tutorSpecialization}</p>}
        </div>
      </div>

      {tutorBio ? (
        <p className="relative mt-4 text-sm leading-6 text-white/50">{tutorBio}</p>
      ) : (
        <p className="relative mt-4 text-sm leading-6 text-white/40">
          Your tutor hasn&apos;t added a bio yet — you&apos;ll still see everything they teach right here.
        </p>
      )}
    </div>
  );
}
