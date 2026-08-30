/**
 * Who gets the offline library, in one place.
 *
 * Downloading a class for offline watching is offered to the students who
 * genuinely have no other way to see it again on a bad line: the Online branch,
 * the hybrid students who attend that branch's class over video, and every
 * private one-to-one student. A physical group student sits in the room — they
 * get the notes-offline upsell instead (see the moment queue), not video
 * downloads.
 *
 * `deliveryMode` and `classType` both live on `Student` — see the schema
 * comments there for the full meaning of each value.
 */

export type DeliveryShape = {
  deliveryMode?: string | null;
  classType?: string | null;
};

/** Online, hybrid, or any private student. */
export function canDownloadOffline(student: DeliveryShape): boolean {
  const mode = String(student.deliveryMode ?? "physical").toLowerCase();
  const type = String(student.classType ?? "group").toLowerCase();
  return mode === "online" || mode === "hybrid" || type === "private";
}

/** A physical group student — the one who gets "install for offline notes". */
export function isPhysicalGroupStudent(student: DeliveryShape): boolean {
  const mode = String(student.deliveryMode ?? "physical").toLowerCase();
  const type = String(student.classType ?? "group").toLowerCase();
  return mode === "physical" && type === "group";
}
