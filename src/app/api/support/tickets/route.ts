import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MAX_BODY, MAX_SUBJECT, isTicketTopic, openTicket } from "@/lib/support";

export const dynamic = "force-dynamic";

/**
 * MY OWN HELP REQUESTS — the student's and the tutor's side of the desk.
 *
 * Scoped by the signed-in user and nothing else. There is deliberately no way
 * to ask this endpoint for somebody else's tickets, not even by id: the admin
 * queue is a separate route behind a capability, and keeping the two apart is
 * what stops "let me pass a userId" quietly becoming a feature.
 */
export async function GET() {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tickets = await prisma.supportTicket.findMany({
      where: { userId: session.user.id },
      orderBy: { lastMessageAt: "desc" },
      take: 50,
      select: {
        id: true,
        subject: true,
        topic: true,
        status: true,
        unreadForUser: true,
        lastMessageAt: true,
        createdAt: true,
        _count: { select: { messages: true } },
      },
    });

    return NextResponse.json({
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        subject: ticket.subject,
        topic: ticket.topic,
        status: ticket.status,
        unread: ticket.unreadForUser,
        messageCount: ticket._count.messages,
        lastMessageAt: ticket.lastMessageAt,
        createdAt: ticket.createdAt,
      })),
      // The dot on the question mark. Counted here rather than derived in the
      // browser so the launcher can ask one cheap question and render.
      unread: tickets.filter((ticket) => ticket.unreadForUser).length,
    });
  } catch (error) {
    console.error("Support tickets GET failed", error);
    return NextResponse.json({ error: "Could not load your help requests" }, { status: 500 });
  }
}

/** POST — ask a new question. */
export async function POST(request: Request) {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const subject = String(body.subject ?? "").trim();
    const message = String(body.body ?? "").trim();
    const topic = isTicketTopic(body.topic) ? body.topic : "other";
    const fromPath = typeof body.fromPath === "string" ? body.fromPath.slice(0, 200) : null;

    if (!subject) return NextResponse.json({ error: "Give your question a subject" }, { status: 400 });
    if (!message) return NextResponse.json({ error: "Tell us what is happening" }, { status: 400 });
    if (subject.length > MAX_SUBJECT || message.length > MAX_BODY) {
      return NextResponse.json({ error: "That is longer than we can accept" }, { status: 400 });
    }

    /**
     * ONE OPEN TICKET AT A TIME PER PERSON, roughly.
     *
     * Not a quota — it is a rate limit with a human face. A student who taps
     * send three times because the button did not visibly do anything should
     * end up with one thread the office can answer, not three the office has to
     * reconcile. Five is high enough that a genuinely unlucky week is not
     * refused.
     */
    const openCount = await prisma.supportTicket.count({
      where: { userId: session.user.id, status: { in: ["open", "pending"] } },
    });
    if (openCount >= 5) {
      return NextResponse.json(
        { error: "You already have several open questions. The office will get to them — please add to one of those instead." },
        { status: 429 },
      );
    }

    const student = await prisma.student.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });

    const ticket = await openTicket({
      userId: session.user.id,
      studentId: student?.id ?? null,
      subject,
      topic,
      body: message,
      fromPath,
      authorRole: String(session.user.role ?? "student").toLowerCase(),
      authorName: session.user.name ?? null,
    });

    return NextResponse.json({ ok: true, id: ticket.id });
  } catch (error) {
    console.error("Support ticket POST failed", error);
    return NextResponse.json({ error: "Could not send your question" }, { status: 500 });
  }
}
