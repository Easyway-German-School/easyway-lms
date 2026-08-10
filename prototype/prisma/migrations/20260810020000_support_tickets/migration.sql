-- The help desk: a student's question, and the thread of replies on it.
--
-- Deliberately not folded into `Lead`. The two land on the same admin screen
-- because the same person answers both, but a lead is a stranger who wants to
-- enrol and a ticket is a student who already has and cannot make something
-- work. Sharing a table would put support requests into every enrolment funnel
-- count in the product.
--
-- TWO UNREAD FLAGS, NOT ONE. "Unread" means something different at each end,
-- and a single boolean would have each side clearing the other's badge — the
-- office opening a ticket would silently mark the student's unread reply as
-- seen by the student.
--
-- `lastMessageAt` is denormalised so the queue can be ordered without joining
-- the messages table on every load. It is written by the same code path that
-- writes a message, in the same request.

CREATE TABLE IF NOT EXISTS "SupportTicket" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "studentId"      TEXT,
    "subject"        TEXT NOT NULL,
    "topic"          TEXT NOT NULL DEFAULT 'other',
    "status"         TEXT NOT NULL DEFAULT 'open',
    "fromPath"       TEXT,
    "assignedToId"   TEXT,
    "unreadForAdmin" BOOLEAN NOT NULL DEFAULT true,
    "unreadForUser"  BOOLEAN NOT NULL DEFAULT false,
    "lastMessageAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt"     TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    "tenantId"       TEXT,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SupportTicketMessage" (
    "id"         TEXT NOT NULL,
    "ticketId"   TEXT NOT NULL,
    "authorId"   TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "body"       TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId"   TEXT,

    CONSTRAINT "SupportTicketMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SupportTicket_status_lastMessageAt_idx" ON "SupportTicket"("status", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "SupportTicket_userId_createdAt_idx" ON "SupportTicket"("userId", "createdAt");
-- The badge query: "how many open tickets has nobody read?". Runs on every
-- admin page load, so it gets its own index rather than scanning the queue.
CREATE INDEX IF NOT EXISTS "SupportTicket_unreadForAdmin_status_idx" ON "SupportTicket"("unreadForAdmin", "status");
CREATE INDEX IF NOT EXISTS "SupportTicket_tenantId_idx" ON "SupportTicket"("tenantId");
CREATE INDEX IF NOT EXISTS "SupportTicketMessage_ticketId_createdAt_idx" ON "SupportTicketMessage"("ticketId", "createdAt");
CREATE INDEX IF NOT EXISTS "SupportTicketMessage_tenantId_idx" ON "SupportTicketMessage"("tenantId");

-- Foreign keys, each guarded so re-running the migration is harmless.
--
-- The cascade rules encode who owns what. A deleted account takes its own
-- questions with it (CASCADE), but an admin leaving the school must not delete
-- the tickets they happened to be handling (SET NULL) — and a student record
-- being removed must not erase a conversation the office may still need
-- (SET NULL on studentId; the ticket survives against the User).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupportTicket_userId_fkey') THEN
        ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupportTicket_studentId_fkey') THEN
        ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_studentId_fkey"
            FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupportTicket_assignedToId_fkey') THEN
        ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedToId_fkey"
            FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupportTicket_tenantId_fkey') THEN
        ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupportTicketMessage_ticketId_fkey') THEN
        ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_ticketId_fkey"
            FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupportTicketMessage_authorId_fkey') THEN
        ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_authorId_fkey"
            FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupportTicketMessage_tenantId_fkey') THEN
        ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
