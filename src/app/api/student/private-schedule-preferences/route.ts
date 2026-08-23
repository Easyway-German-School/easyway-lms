import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { KIND, notify } from "@/lib/notify";
import { NextResponse } from "next/server";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const WINDOWS = ["morning", "afternoon", "evening"] as const;
const FREQUENCIES = ["weekly", "twice-weekly", "flexible"] as const;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

type Preferences = { days: string[]; windows: string[]; preferredTimes: string[]; examTimes: string[]; frequency: string; timezone: string; notes: string; submittedAt?: string };

function readPreferences(admission: unknown): Preferences | null {
  if (!admission || typeof admission !== "object" || Array.isArray(admission)) return null;
  const value = (admission as Record<string, unknown>).privateSchedulePreferences;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    days: Array.isArray(record.days) ? record.days.filter((day): day is string => typeof day === "string") : [],
    windows: Array.isArray(record.windows) ? record.windows.filter((window): window is string => typeof window === "string") : [],
    preferredTimes: Array.isArray(record.preferredTimes) ? record.preferredTimes.filter((time): time is string => typeof time === "string") : [],
    examTimes: Array.isArray(record.examTimes) ? record.examTimes.filter((time): time is string => typeof time === "string") : [],
    frequency: typeof record.frequency === "string" ? record.frequency : "weekly",
    timezone: typeof record.timezone === "string" ? record.timezone : "UTC",
    notes: typeof record.notes === "string" ? record.notes : "",
    submittedAt: typeof record.submittedAt === "string" ? record.submittedAt : undefined,
  };
}

async function getStudent(userId: string) {
  return prisma.student.findUnique({
    where: { userId },
    select: {
      id: true, classType: true, admission: true,
      tutor: { select: { userId: true, user: { select: { name: true } } } },
      user: { select: { name: true } },
    },
  });
}

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const student = await getStudent(session.user.id);
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  const preferences = readPreferences(student.admission);
  return NextResponse.json({ eligible: student.classType === "private", submitted: Boolean(preferences), preferences });
}

export async function POST(req: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const student = await getStudent(session.user.id);
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  if (student.classType !== "private") return NextResponse.json({ error: "This schedule is for private students only" }, { status: 400 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const days = Array.isArray(body?.days) ? body.days.filter((day): day is string => typeof day === "string" && DAYS.includes(day as never)) : [];
  const windows = Array.isArray(body?.windows) ? body.windows.filter((window): window is string => typeof window === "string" && WINDOWS.includes(window as never)) : [];
  const readTimes = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((time): time is string => typeof time === "string" && TIME_PATTERN.test(time)))].sort() : [];
  const preferredTimes = readTimes(body?.preferredTimes);
  const examTimes = readTimes(body?.examTimes);
  const frequency = typeof body?.frequency === "string" && FREQUENCIES.includes(body.frequency as never) ? body.frequency : "weekly";
  const timezone = typeof body?.timezone === "string" && body.timezone.trim() ? body.timezone.trim().slice(0, 80) : "UTC";
  const notes = typeof body?.notes === "string" ? body.notes.trim().slice(0, 1000) : "";
  if (days.length === 0 || windows.length === 0) return NextResponse.json({ error: "Choose at least one day and time window" }, { status: 400 });

  const preferences: Preferences = { days, windows, preferredTimes, examTimes, frequency, timezone, notes, submittedAt: new Date().toISOString() };
  const admission = student.admission && typeof student.admission === "object" && !Array.isArray(student.admission) ? student.admission as Record<string, unknown> : {};
  await prisma.student.update({ where: { id: student.id }, data: { admission: { ...admission, privateSchedulePreferences: preferences } } });

  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  const recipients = [...admins.map((admin) => admin.id), student.tutor?.userId].filter((id): id is string => Boolean(id));
  if (recipients.length > 0) {
    await notify({
      to: { userIds: recipients }, kind: KIND.privateClassUpdated, severity: "info",
      title: "Private timetable preferences received",
      message: `${student.user.name ?? "A private student"} has shared preferred days and times for their one-to-one classes.`,
      link: `/lecturer/private-classes?studentId=${encodeURIComponent(student.id)}`, dedupeKey: `private-schedule-preferences:${student.id}:${preferences.submittedAt}`,
    });
  }
  return NextResponse.json({ ok: true, preferences });
}
