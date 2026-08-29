import { redirect } from "next/navigation";

/**
 * Folded into `/admin/exams` — this page's content (the only correct one of
 * three overlapping exam admin pages) moved to the shorter, canonical URL.
 * Kept as a redirect so old links and bookmarks still land somewhere real.
 */
export default function AdminExamCentreRedirect() {
  redirect("/admin/exams");
}
