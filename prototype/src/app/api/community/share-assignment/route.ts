import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveSpaceScope, studentsInSpace } from "@/lib/community-spaces";
import { announceChatMessage } from "@/lib/community-notify";
import { notify, KIND } from "@/lib/notify";
import { assignmentVisibleToWhere, studentsVisibleToAssignment } from "@/lib/student-assignments";
import { resolveOnlineBranchId } from "@/lib/online-branch-server";

/**
 * Reposting a tutor's assignment into class chat, student to student.
 *
 * This exists because assignmentVisibleToWhere's own rule still misses some
 * students for reasons not yet diagnosed — a tutor link that didn't move the
 * sitting, a target snapshot that missed a late joiner, and so on. Rather than
 * leave those students with nothing until each cause is found and fixed one
 * at a time, anyone who CAN see an assignment may post it into "Homework &
 * help" for the whole room, optionally naming the one classmate it's for —
 * which is the only part that needs a check: the sharer must see the
 * assignment themselves, and (if naming someone) that person must genuinely
 * be unable to see it, confirmed against the same rule the Assignments tab
 * uses, not just asserted by the client.
 */

const CHANNEL_SLUG = "grammar"; // "Homework & help" — see community-spaces.ts's DEFAULT_CHANNELS.

async function currentStudentForShare(userId: string) {
  return prisma.student.findUnique({
    where: { userId },
    select: {
      id: true,
      level: true,
      branchId: true,
      sessionSlot: true,
      deliveryMode: true,
      hybridOnlineSlot: true,
      tutorId: true,
      admission: true,
      coTutors: { select: { lecturerId: true } },
      user: { select: { tenantId: true, name: true } },
    },
  });
}

/** The channel + space a student's own repost lands in — their primary (campus) cohort. */
async function myHomeworkChannel(viewer: { userId: string; role: string }) {
  const scope = await resolveSpaceScope(viewer);
  const spaceId = scope.spaceIds[0];
  if (!spaceId) return null;
  const channel = await prisma.channel.findUnique({
    where: { spaceId_slug: { spaceId, slug: CHANNEL_SLUG } },
    select: { id: true, name: true, spaceId: true },
  });
  if (!channel) return null;
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { branchId: true, level: true, sessionSlot: true, batch: true },
  });
  return space ? { channel, space } : null;
}

/** GET ?assignmentId=… — classmates in my own room confirmed NOT to see this assignment. */
export async function GET(request: NextRequest) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const assignmentId = new URL(request.url).searchParams.get("assignmentId");
  if (!assignmentId) return NextResponse.json({ error: "assignmentId is required" }, { status: 400 });

  const student = await currentStudentForShare(session.user.id as string);
  if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const onlineBranchId = await resolveOnlineBranchId(student.user?.tenantId ?? null);
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, ...assignmentVisibleToWhere(student, onlineBranchId) },
    select: { id: true, level: true, branchId: true, sessionSlot: true, lecturerId: true },
  });
  if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });

  const home = await myHomeworkChannel({ userId: session.user.id as string, role: (session.user as any).role });
  if (!home) return NextResponse.json({ candidates: [] });

  const cohort = (await studentsInSpace(home.space)).filter((row) => row.id !== student.id);
  if (!cohort.length) return NextResponse.json({ candidates: [] });

  const canSeeIds = new Set(
    (
      await prisma.student.findMany({
        where: { id: { in: cohort.map((row) => row.id) }, ...studentsVisibleToAssignment(assignment, onlineBranchId) },
        select: { id: true },
      })
    ).map((row) => row.id),
  );

  const cantSee = cohort.filter((row) => !canSeeIds.has(row.id));
  if (!cantSee.length) return NextResponse.json({ candidates: [] });

  const names = await prisma.user.findMany({
    where: { id: { in: cantSee.map((row) => row.userId) } },
    select: { id: true, name: true },
  });

  return NextResponse.json({
    candidates: names.map((user) => ({ userId: user.id, name: user.name ?? "Classmate" })),
  });
}

/** POST { assignmentId, mentionedUserId? } — post it into "Homework & help". */
export async function POST(request: NextRequest) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await currentStudentForShare(session.user.id as string);
  if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const assignmentId = String(body.assignmentId ?? "");
  const mentionedUserId = body.mentionedUserId ? String(body.mentionedUserId) : null;
  if (!assignmentId) return NextResponse.json({ error: "assignmentId is required" }, { status: 400 });

  const onlineBranchId = await resolveOnlineBranchId(student.user?.tenantId ?? null);

  // The sharer must see this assignment themselves — reposting is "I can see
  // it, you can't", never an open repost of any id in the school.
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, ...assignmentVisibleToWhere(student, onlineBranchId) },
    select: { id: true, title: true, description: true, type: true, dueAt: true, level: true, branchId: true, sessionSlot: true, lecturerId: true },
  });
  if (!assignment) {
    return NextResponse.json({ error: "You can't repost an assignment you can't see yourself." }, { status: 403 });
  }

  const viewer = { userId: session.user.id as string, role: (session.user as any).role };
  const home = await myHomeworkChannel(viewer);
  if (!home) return NextResponse.json({ error: "Your class chat isn't set up yet." }, { status: 404 });

  if (mentionedUserId) {
    const cohort = await studentsInSpace(home.space);
    const target = cohort.find((row) => row.userId === mentionedUserId);
    if (!target) {
      return NextResponse.json({ error: "That classmate isn't in your class chat." }, { status: 400 });
    }
    const alreadySees = await prisma.student.findFirst({
      where: { id: target.id, ...studentsVisibleToAssignment(assignment, onlineBranchId) },
      select: { id: true },
    });
    if (alreadySees) {
      return NextResponse.json({ error: "That classmate can already see this assignment." }, { status: 400 });
    }
  }

  const created = await prisma.message.create({
    data: {
      channelId: home.channel.id,
      authorId: viewer.userId,
      body: `Reposted "${assignment.title}" so everyone in class can see it — it wasn't showing up for everyone.`,
      kind: "assignment_share",
      sharedAssignmentId: assignment.id,
      mentionedUserId,
    },
    include: {
      author: { select: { id: true, name: true, role: true, student: { select: { avatar: true } } } },
      sharedAssignment: { select: { id: true, title: true, description: true, type: true, dueAt: true } },
      mentionedUser: { select: { id: true, name: true } },
    },
  });

  announceChatMessage({
    channelId: home.channel.id,
    channelName: home.channel.name,
    spaceId: home.channel.spaceId,
    messageId: created.id,
    authorId: viewer.userId,
    authorName: created.author.name ?? "A classmate",
    body: `Reposted an assignment: ${assignment.title}`,
    hasAttachment: false,
    attachmentType: null,
  });

  if (mentionedUserId) {
    notify({
      to: { userIds: [mentionedUserId] },
      kind: KIND.assignmentShared,
      severity: "info",
      title: "A classmate reposted an assignment for you",
      message: `${created.author.name ?? "A classmate"} posted "${assignment.title}" in Homework & help because it wasn't showing up in your Assignments tab.`,
      link: `/community?channel=${home.channel.id}`,
      push: true,
      senderId: viewer.userId,
      dedupeKey: `assignment-shared:${assignment.id}:${mentionedUserId}`,
    }).catch((error) => console.error("Assignment-shared notification failed", error));
  }

  return NextResponse.json({
    channelId: home.channel.id,
    message: {
      id: created.id,
      body: created.body,
      sharedAssignment: created.sharedAssignment,
      mentionedUser: created.mentionedUser,
    },
  });
}
