import { redirect } from "next/navigation";

/**
 * `/lecturer` is not a page any more.
 *
 * It used to be the first version of the tutor portal — a single screen with a
 * course form, a CSV box and a "Back to dashboard" link that went to the
 * STUDENT dashboard. Long after the real tutor portal was built at
 * `/lecturer/dashboard`, three pages still linked back here, so a tutor who
 * opened the gradebook and pressed back twice ended up in the student portal
 * with no way home.
 *
 * Its admin-only halves (create, delete and import courses) moved to
 * `/admin/courses`, where the `/api/admin/*` endpoints they always called
 * actually belong. Anyone arriving here — from a bookmark, an old link, or
 * habit — lands on the real dashboard instead.
 */
export default function LecturerIndexPage() {
  redirect("/lecturer/dashboard");
}
