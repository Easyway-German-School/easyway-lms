/**
 * Creates a `StudentProfile` row for every existing Student, seeded from
 * their `admission` JSON blob — see src/lib/student-profile.ts for the typed
 * home this promotes fields into, and its `profileFromAdmissionBlob` for the
 * same field-name mapping reimplemented here in plain JS (this script runs
 * under plain node, not the Next.js TS toolchain, so it cannot import that
 * file directly).
 *
 * Idempotent and safe to re-run: only students with no `profile` row yet are
 * touched, in chunks so one bad row cannot abort the whole run.
 *
 *   node scripts/backfill-student-profiles.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CHUNK = 200;

function str(admission, ...keys) {
  for (const key of keys) {
    const value = admission?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

/**
 * The admission form's `dob` was free-typed as DD/MM/YYYY for most students
 * on file (e.g. "24/12/2000") — `new Date(...)` either misreads that as
 * MM/DD or rejects it outright. Tried first so a legacy value backfills
 * correctly instead of silently landing as null. Mirrors
 * src/lib/student-profile.ts's `parseDayMonthYear`, reimplemented here since
 * this script runs under plain node, not the Next.js TS toolchain.
 */
function parseDayMonthYear(value) {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return undefined;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return date;
}

function dateOf(admission, ...keys) {
  for (const key of keys) {
    const value = admission?.[key];
    if (typeof value === "string" && value.trim()) {
      const dayMonthYear = parseDayMonthYear(value);
      if (dayMonthYear) return dayMonthYear;
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return undefined;
}

/** Same alias set as normalizeProfileInput() in src/lib/student-profile.ts. */
function profileFromAdmission(admission) {
  const a = admission && typeof admission === "object" ? admission : {};
  const fields = {
    phone: str(a, "phone", "phoneNumber"),
    whatsapp: str(a, "whatsapp", "whatsAppNumber"),
    addressLine: str(a, "addressLine", "address"),
    city: str(a, "city"),
    stateRegion: str(a, "stateRegion", "state"),
    country: str(a, "country"),
    postalCode: str(a, "postalCode", "zip", "zipCode"),
    gender: str(a, "gender"),
    nationality: str(a, "nationality"),
    govIdType: str(a, "govIdType", "idType"),
    govIdNumber: str(a, "govIdNumber", "idNumber"),
    photoUrl: str(a, "photoUrl"),
    idProofUrl: str(a, "idProofUrl"),
    emergencyName: str(a, "emergencyName", "emergencyContactName"),
    emergencyPhone: str(a, "emergencyPhone", "emergencyContactInfo", "emergencyContactPhone"),
    guardianName: str(a, "guardianName", "fatherName", "motherName", "parentName"),
    guardianPhone: str(a, "guardianPhone", "fatherPhone", "motherPhone", "parentPhone"),
    occupation: str(a, "occupation", "profession"),
    employer: str(a, "employer", "fatherOccupation", "motherOccupation"),
    priorEducation: str(a, "priorEducation", "prevSchoolName"),
    heardFrom: str(a, "heardFrom"),
    dateOfBirth: dateOf(a, "dateOfBirth", "dob"),
  };
  // Drop undefined keys so `create` doesn't write a column of literal "undefined".
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
}

async function main() {
  let created = 0;
  let skipped = 0;

  while (true) {
    const batch = await prisma.student.findMany({
      where: { profile: { is: null } },
      take: CHUNK,
      select: { id: true, admission: true, tenantId: true },
      orderBy: { createdAt: "asc" },
    });
    if (batch.length === 0) break;

    for (const student of batch) {
      try {
        await prisma.studentProfile.create({
          data: {
            studentId: student.id,
            tenantId: student.tenantId,
            ...profileFromAdmission(student.admission),
          },
        });
        created += 1;
      } catch (error) {
        // A profile created by a concurrent request between the findMany and
        // this create is not a failure — move on.
        if (error?.code === "P2002") {
          skipped += 1;
          continue;
        }
        console.error(`Failed to backfill profile for student ${student.id}:`, error);
        skipped += 1;
      }
    }

    console.log(`Backfilled ${created} so far (${skipped} skipped)…`);
  }

  console.log(`Done. Created ${created} StudentProfile rows, skipped ${skipped}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
