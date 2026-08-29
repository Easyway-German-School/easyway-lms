import { redirect } from "next/navigation";

/**
 * Retired: this page wrote `ExamRegistration` rows with no `examId`, bypassing
 * seat capacity, payment tracking and publish gating. `/admin/exams` is the
 * one canonical exam page now. Kept as a redirect so old links still land
 * somewhere real.
 */
export default function AdminExamRegistrationsRedirect() {
  redirect("/admin/exams");
}
