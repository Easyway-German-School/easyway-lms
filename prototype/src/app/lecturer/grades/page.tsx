'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import LecturerShell from '@/components/LecturerShell';
import BrandLoader from '@/components/BrandLoader';

/**
 * Exam/Test grading moved into Gradebook — an "Exam sittings" section
 * alongside the running classwork marks, so there is one grading page and one
 * sidebar link instead of two competing ones. This route stays only so an old
 * bookmark or a stray link still lands somewhere real.
 */
export default function LecturerGradesRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/lecturer/gradebook');
  }, [router]);

  return (
    <LecturerShell>
      <BrandLoader fill size="lg" title="Moved" message="Exam grading now lives in Gradebook — taking you there." />
    </LecturerShell>
  );
}
