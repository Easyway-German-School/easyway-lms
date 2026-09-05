/**
 * Which tables belong to a tenant, and which are shared by everybody.
 *
 * This file is the single source of truth for isolation. The Prisma extension
 * reads it to decide what to filter, the migration generator reads it to decide
 * where to put a `tenantId` column and a row-level-security policy, and the
 * test suite reads it to check that nothing has been added to the schema
 * without a decision being made about it.
 *
 * That last part is the point. The failure mode this whole design exists to
 * prevent is somebody adding a model in six months and nobody noticing it has
 * no tenant column — one forgotten table is one school reading another
 * school's students. `assertRegistryCoversSchema()` turns that from something
 * you have to remember into a failing test.
 */

/**
 * Tenant-owned. Every row belongs to exactly one tenant and must never be
 * visible to another.
 *
 * The column is denormalised onto each table rather than reached through a
 * relation (Payment -> Student -> User -> tenantId). Two reasons, and both are
 * load-bearing:
 *
 *  1. Postgres row-level security policies are evaluated per row. A policy that
 *     has to join three tables to find out who owns the row is both slow and,
 *     in practice, unwritable. A plain column comparison is neither.
 *  2. A relation path can be broken by a nullable link. `Student.branchId` is
 *     nullable — sixteen students currently have none — so an isolation rule
 *     that reads tenant through the branch would silently stop protecting
 *     those exact rows. Isolation must not depend on optional data.
 */
export const TENANT_OWNED_MODELS = [
  "Student",
  "Lecturer",
  "Branch",
  "Class",
  "ClassSession",
  "PrivateClass",
  "PrivateClassSeries",
  "SchoolHoliday",
  "Course",
  "Module",
  "Lesson",
  "Material",
  "Pathway",
  "Enrollment",
  "Progress",
  "Completion",
  "Grade",
  "Assignment",
  "AssignmentTarget",
  "AssignmentSubmission",
  "Attendance",
  "Exam",
  "ExamRegistration",
  "Certificate",
  "Invoice",
  "Payment",
  "TuitionCharge",
  "PaymentPlan",
  "Lead",
  "Notification",
  "NotificationSetting",
  /**
   * The certificate wording and signatories. Tenant-owned because one school's
   * Head of Department must never appear on another school's document.
   */
  "CertificateTemplate",
  /**
   * One person's own delivery preferences. Tenant-owned because it is read as
   * "my settings" — a query that must never be able to return, or overwrite,
   * somebody at another school. It carries no student data itself, but the
   * registry classifies by who may read a row, not by how sensitive it looks.
   */
  "NotificationPreference",
  "EmailLog",
  "EmailMessage",
  "SmsMessage",
  "TutorPayRate",
  "PayrollPayment",
  "EmailSuppression",
  "PushSubscription",
  "Space",
  "Channel",
  "ChannelRead",
  "TypingPing",
  "Message",
  "ClassRecording",
  "ClassTranscript",
  "StudentClassNote",
  "VideoProgress",
  /**
   * The live classroom. Added by the presence work and never classified, so
   * this test has been failing since — which is exactly the oversight the test
   * exists to catch, caught late.
   *
   * A session names a room and holds the join code that gets somebody INTO it;
   * an invite names a student by id. Both are unambiguously one school's, and
   * a leak here is not a privacy footnote — a join code readable across
   * tenants is a stranger in a live lesson.
   */
  "LiveClassSession",
  "LiveClassInvite",
  /**
   * The help desk. A ticket names a student and quotes whatever they were
   * struggling with — often a payment or an account problem — and the thread on
   * it is a conversation between one school's office and one school's student.
   * There is no reading of either that another tenant has any business doing.
   */
  "SupportTicket",
  "SupportTicketMessage",
  "BetaFeedback",
  "LearnerUsageEvent",
  "LearnerBehaviourProfile",
  /**
   * The live quiz game. A game carries a PIN that admits somebody to it, a
   * frozen copy of one school's question paper, and a leaderboard of one
   * school's students by name. All three are the same category of leak as a
   * live class join code — see LiveClassSession above — and the answer rows
   * additionally record how long each named child took to answer.
   */
  "QuizGame",
  "QuizGamePlayer",
  "QuizGameAnswer",
  /**
   * Satzkette. A story is written by one school's named students and reads as a
   * transcript of who wrote what and when — the same category of leak as the
   * group chat it lives beside. The decks additionally carry a school's own
   * vocabulary lists, which is teaching material rather than shared reference.
   */
  "GameMatch",
  "GameTurn",
  "ConstraintDeck",
  "MissionProgress",
  "DailyMission",
  "MaterialQuestAttempt",
  "PersonalizedPlan",
  "JourneyEvent",
  "IntegrationConnector",
  "AdminAction",
  "AuditLog",

  /**
   * Both already carry a non-null `tenantId`, so the column script skips them.
   *
   * Listed as tenant-owned because of how they are READ in the partner
   * dashboard: "show me my API keys" must never be able to show somebody
   * else's. The pre-authentication lookup in resolveApiKey() is unaffected —
   * it deliberately uses the raw client, because finding the key is precisely
   * how the tenant gets identified in the first place. That is the one query
   * that cannot be tenant-scoped, and it is scoped by a 256-bit secret
   * instead.
   */
  "ApiKey",
  "IdempotencyRecord",

  /**
   * Billing. A tenant reads its own usage, its own balance and its own
   * statement; nobody reads anybody else's. The nightly rollup and the
   * operator's cross-tenant revenue view both go through runUnscoped, which is
   * the correct amount of friction for the two jobs that need it.
   */
  "UsageEvent",
  "UsageDaily",
  "TenantCredit",
  "CreditTransaction",

  /** A partner's own endpoints and the deliveries made to them. */
  "WebhookEndpoint",
  "WebhookDelivery",

  /** How one school runs: which sittings it offers at which level. */
  "SchoolSetting",

  /** Who reacted to which chat message, and with what. */
  "MessageReaction",

  /** Students the office has stopped from posting, until a moment in time. */
  "CommunityMute",

  /**
   * A parent/guardian account and the child it claims. Tenant-owned for the
   * same reason Student is: it names a real family, and one school's parent
   * must never be reachable from another school's admin console.
   */
  "Parent",
  /** The real parent-child link (Parent.studentId only ever held one). Same
   * reasoning as Parent — it names a real family. */
  "ParentStudent",

  /**
   * The private-tier 1:1 DM and the tutor's write-up after each session.
   * Both name one school's student and one school's tutor by id and quote
   * what was actually said or taught — the same category of leak as
   * SupportTicket above, and just as clearly nobody else's to read.
   */
  "TutorMessage",
  "SessionNote",
  "StudentAiUsage",
  "StudentSkillMastery",
  /**
   * The typed profile and the per-level enrolment history — see
   * lib/student-profile.ts and lib/student-enrolment.ts. Both are 1:1/1:many
   * children of Student and just as clearly one school's records as the
   * Student row itself.
   */
  "StudentProfile",
  "StudentEnrolment",

  /**
   * The Terms and Conditions consent trail and the refund requests it gates.
   * Both name one school's student and quote what they agreed to or asked
   * for — the same category of leak as SupportTicket above, and this one
   * doubles as the legal record a school would need to produce on its own,
   * never another tenant's.
   */
  "TermsAcceptance",
  "RefundRequest",

  /**
   * The Work Drive (docs/WORK_DRIVE.md). A staff-only file store: a workspace
   * and its folders, files, versions, extracted text, shares, activity feed
   * and comments. Every one names one school's staff and holds one school's
   * documents — policies, finance spreadsheets, scanned contracts. There is no
   * reading of any of it that another tenant has any business doing, and a
   * leak here is the same category as SupportTicket: one office's private
   * paperwork.
   */
  "Workspace",
  "WorkspaceMember",
  "DriveFolder",
  "DriveFile",
  "DriveFileVersion",
  "DriveFileText",
  "FileShare",
  "FileActivity",
  "FileComment",
  /**
   * The staff calendar (Phase 3). An event names one school's staff and, for
   * a public webinar, one school's registrants by email; the tasks and
   * attached files are that school's planning. Same category of leak as the
   * files pillar it sits beside.
   */
  "WorkEvent",
  "EventAttendee",
  "EventTask",
  "EventResource",
  /**
   * Webinars (Phase 4). The room name admits people to a live session, the
   * Q&A names one school's staff and audience, and a public webinar's
   * registrant list is that school's marketing data. Same category of leak as
   * a live class join code — see LiveClassSession above.
   */
  "Webinar",
  "WebinarQuestion",
  "WebinarQuestionVote",
] as const;

/**
 * Deliberately NOT tenant-scoped. Each one is a decision, not an oversight.
 */
export const GLOBAL_MODELS = {
  /**
   * The tenant list itself. Scoping it to a tenant would make it unreadable by
   * the operator who has to administer all of them.
   */
  Tenant: "the tenant registry; access is controlled by operator role, not by tenant",

  /**
   * Backup runs are database-wide infrastructure, not a per-school record.
   * `pg_dump` writes every tenant's rows into one artifact, the restore drill
   * restores the whole database, and there is one Neon instance behind the
   * platform — "this school's backup" is not a real unit.
   *
   * It was tenant-owned until 2026-09-03, and that was a live bug, not a
   * defensible call: the jobs that record a run — the GitHub Actions check-in
   * at POST /api/backup/report, and scripts/snapshot-db.mjs — run with no user
   * session and therefore no tenant in context, so every row they wrote landed
   * with `tenantId = NULL`. The security page reads through the tenant-scoped
   * client, which filters them straight back out, so /admin/security sat frozen
   * on the last row that predated the tenant column and reported every backup
   * since as "Overdue" / "Never run" no matter how well the jobs ran. Global is
   * the classification that matches how the data is actually produced and read.
   *
   * The health check is a per-database operational signal; on a multi-tenant
   * platform every operator should see the one true backup status, not a
   * separate always-empty card each.
   */
  BackupRun: "database-wide infrastructure; recorded by sessionless jobs, read as one operational signal",

  /**
   * Keyed by sha256 of task + input, so two tenants asking to summarise the
   * same material hit the same row. That sharing IS the cost model — it is what
   * takes ~1,300 model calls a day down to ~20 — and giving each tenant a
   * private cache would multiply the AI bill by the number of customers.
   *
   * Safe only because the key is a hash of the input: a tenant can never read a
   * cache entry without already possessing the exact content that produced it.
   * If a cache task is ever added whose input is not fully supplied by the
   * caller, this reasoning stops holding and it must move to the list above.
   */
  AiCache: "content-addressed by input hash; sharing is the cost model",

  /**
   * Auth sessions, reached only by the user who owns them and never listed.
   * The tenant is carried on User.
   */
  Session: "per-user auth token, resolved through User",

  /**
   * Reset tokens, reached only by exact hash and never listed.
   *
   * Global for a reason that is easy to get wrong: the reset flow runs
   * *before* anyone is signed in, so there is no session and therefore no
   * tenant to scope by. A tenant filter here would not add safety — the
   * lookup key is already 256 bits of unguessable secret, and it is unique
   * across the whole table — but it would break the flow entirely, because
   * the one moment we need to find the row is the one moment we cannot know
   * whose tenant to look in.
   *
   * The tenant boundary is enforced one step later instead: the token points
   * at a User, and User carries the tenant.
   */
  PasswordResetToken: "looked up by unguessable hash, pre-authentication; tenant comes from the User it points at",

  /**
   * The public-signup gate. Same shape as PasswordResetToken: it is looked up
   * by an unguessable one-time token (or a Paystack reference) at
   * `/auth/signup`, which by definition runs before the visitor has any
   * session or tenant. A tenant filter here would break the one lookup the
   * table exists for. It records `tenantId` (resolved from the request host at
   * mint time) as a plain audit column, and the real tenant boundary is the
   * User/Student the token is spent on — see the model doc in schema.prisma.
   */
  SignupToken: "looked up by unguessable token/ref, pre-authentication; tenant is stamped on the account it creates",

  /**
   * Carries its own tenantId already and is the join point for the others.
   */
  User: "tenant column already present; scoped by the extension directly",
} as const;

export type TenantOwnedModel = (typeof TENANT_OWNED_MODELS)[number];

const tenantOwnedSet = new Set<string>(TENANT_OWNED_MODELS);

export function isTenantOwned(model: string): boolean {
  return tenantOwnedSet.has(model);
}

export function isGloballyShared(model: string): boolean {
  return model in GLOBAL_MODELS;
}

/**
 * Every model must be classified one way or the other.
 *
 * Called by the test suite against the real Prisma DMMF. A model that is in
 * neither list fails the build rather than quietly defaulting to "visible to
 * everyone", which is what an unclassified table effectively is.
 */
export function assertRegistryCoversSchema(modelNames: string[]): string[] {
  return modelNames.filter((name) => !isTenantOwned(name) && !isGloballyShared(name));
}
