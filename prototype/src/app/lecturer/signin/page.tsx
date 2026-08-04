import { redirect } from "next/navigation";

/**
 * A second, stale copy of the tutor sign-in form.
 *
 * Nothing linked to it, so it drifted: it still sent admins to `/lecturer` and
 * had none of the fixes the real form at `/auth/lecturer/signin` picked up.
 * Two sign-in forms for one portal is one too many — this is the redirect, the
 * form is over there.
 */
export default function LecturerSignInRedirect() {
  redirect("/auth/lecturer/signin");
}
