import { redirect } from "next/navigation";

/**
 * There were two notification pages: this one, and /notifications in the
 * sidebar. The sidebar's was three hardcoded fake alerts and this one was
 * real but unreachable — nothing in the app linked to it. /notifications is
 * now the real page, and this address redirects there rather than 404ing on
 * anyone who had it bookmarked.
 */
export default function StudentNotificationsRedirect() {
  redirect("/notifications");
}
