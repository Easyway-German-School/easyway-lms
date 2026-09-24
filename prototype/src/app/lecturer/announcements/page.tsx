'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import LecturerShell from '@/components/LecturerShell';
import BrandLoader from '@/components/BrandLoader';

/**
 * Announcements merged into Messages — one compose box (with the urgent flag
 * and AI drafting aid this page had) instead of two sidebar rows both doing
 * "broadcast to the class". This route stays only so an old bookmark or a
 * stray link still lands somewhere real.
 */
export default function LecturerAnnouncementsRedirect() {
  const router = useRouter();

  useEffect(() => {
    // Carry over `?students=...&label=...` — the "Message this group" button
    // on the roster used to deep-link here, and an old bookmark or stray
    // link should still land the tutor on the same pre-filled audience.
    const query = typeof window !== 'undefined' ? window.location.search : '';
    router.replace(`/lecturer/messages${query}`);
  }, [router]);

  return (
    <LecturerShell>
      <BrandLoader fill size="lg" title="Moved" message="Announcements now lives in Messages — taking you there." />
    </LecturerShell>
  );
}
