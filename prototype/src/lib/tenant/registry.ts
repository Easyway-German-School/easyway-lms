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
  "EmailSuppression",
  "PushSubscription",
  "Space",
  "Channel",
  "ChannelRead",
  "Thread",
  "Comment",
  "ClassRecording",
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
  "MissionProgress",
  "PersonalizedPlan",
  "JourneyEvent",
  "IntegrationConnector",
  "AdminAction",
  "AuditLog",
  "BackupRun",

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
