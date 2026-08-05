import { prisma } from "@/lib/prisma";
import type { AdminContext } from "@/lib/admin-roles";
import {
  PlanError,
  findAction,
  type ActionPreview,
  type AssistantAction,
} from "@/lib/assistant-actions";

/**
 * The gap between "the assistant suggested this" and "the school did this".
 *
 * A plan is a row. It is written when the model proposes something, it is inert
 * while it sits there, and it becomes an event only when a named human posts
 * its id back with a confirmation. Nothing else in the system can turn a
 * proposal into a write.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PLAN IS STORED SERVER-SIDE RATHER THAN HELD IN THE PAGE
 *
 * The tempting shape is: send the payload to the browser, let it come back on
 * confirm, execute what arrives. It is less code and it is wrong, because the
 * thing that comes back is then whatever the browser chose to send. An admin
 * who may message students would be one edited request away from messaging a
 * cohort nobody previewed — the confirm step would be checking a payload
 * against nothing.
 *
 * So the payload never leaves the server. The browser gets a preview to read
 * and an id to post back, and the id is the only thing it can influence.
 *
 * ---------------------------------------------------------------------------
 * WHY PLANS EXPIRE
 *
 * Because the cohort is frozen (see assistant-actions.ts), an old plan acts on
 * a world that has moved: three of those students have paid since, one has
 * withdrawn. Twenty minutes is long enough to read a card, walk to a
 * colleague's desk and come back, and short enough that the group is still
 * recognisably the group that was reviewed.
 */

const PLAN_TTL_MS = 20 * 60_000;

export type StoredPlan = {
  id: string;
  kind: string;
  summary: string;
  preview: ActionPreview;
  reversible: boolean;
  expiresAt: string;
};

/** What the model is told after proposing. Never the preview prose. */
export type PlanToolResult = {
  proposed: string;
  awaiting_confirmation: true;
  affected: number;
  /**
   * A directive rather than a sentence, for the same reason the read tools use
   * snake_case tokens: anything phrased as prose in a tool result is copy the
   * model will recite back to the admin, and "tell the user to press Confirm"
   * read aloud is worse than useless when the button is right there.
   */
  how_to_answer: "say_what_you_are_about_to_do_in_one_sentence__do_not_claim_it_is_done__do_not_mention_buttons";
};

export type PlanOutcome =
  | { ok: true; stored: StoredPlan; forModel: PlanToolResult }
  | { ok: false; forModel: { error: string } };

/**
 * Build a plan from the model's arguments and save it.
 *
 * A PlanError comes back as a tool result rather than an exception, so the
 * model can read "that message is too long" and try again inside the same
 * question instead of the admin being handed a failure.
 */
export async function createPlan(
  name: string,
  args: Record<string, unknown>,
  admin: AdminContext,
): Promise<PlanOutcome> {
  const action = findAction(name);
  if (!action) return { ok: false, forModel: { error: `There is no action called ${name}.` } };

  if (!admin.can(action.capability)) {
    return { ok: false, forModel: { error: `Your admin role does not cover ${action.capability}.` } };
  }

  let planned;
  try {
    planned = await action.plan(args, admin);
  } catch (error) {
    if (error instanceof PlanError) return { ok: false, forModel: { error: error.message } };
    console.error(`Planning ${name} failed`, error);
    return { ok: false, forModel: { error: "That could not be prepared. Say so rather than guessing." } };
  }

  const expiresAt = new Date(Date.now() + PLAN_TTL_MS);

  const row = await prisma.adminAction.create({
    data: {
      kind: action.name,
      // Stored rather than read back from the registry at execute time: a later
      // edit to the registry must not silently widen a plan made under the old
      // rules.
      capability: action.capability,
      summary: planned.preview.summary,
      payload: planned.payload as never,
      preview: planned.preview as never,
      affectedCount: planned.preview.affected,
      status: "pending",
      createdById: admin.userId,
      expiresAt,
    },
    select: { id: true },
  });

  return {
    ok: true,
    stored: {
      id: row.id,
      kind: action.name,
      summary: planned.preview.summary,
      preview: planned.preview,
      reversible: action.reversible,
      expiresAt: expiresAt.toISOString(),
    },
    forModel: {
      proposed: action.name,
      awaiting_confirmation: true,
      affected: planned.preview.affected,
      how_to_answer:
        "say_what_you_are_about_to_do_in_one_sentence__do_not_claim_it_is_done__do_not_mention_buttons",
    },
  };
}

export type ExecuteOutcome =
  | { ok: true; summary: string; details: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/**
 * Run a plan that a human just confirmed.
 *
 * Everything before the actual call is a refusal looking for a reason: wrong
 * person, wrong capability, already run, expired, or an action that no longer
 * exists. Each of those is a state where doing the work would be worse than
 * doing nothing.
 */
export async function executePlan(planId: string, admin: AdminContext): Promise<ExecuteOutcome> {
  const plan = await prisma.adminAction.findUnique({ where: { id: planId } });
  if (!plan) return { ok: false, status: 404, error: "That action has expired or was never made." };

  if (plan.status !== "pending") {
    return {
      ok: false,
      status: 409,
      // Named rather than generic: "already carried out" and "cancelled" mean
      // very different things to somebody who thought they were first to click.
      error:
        plan.status === "executed"
          ? "That action has already been carried out."
          : `That action was ${plan.status} and cannot be run.`,
    };
  }

  if (plan.expiresAt.getTime() < Date.now()) {
    await prisma.adminAction.update({ where: { id: plan.id }, data: { status: "expired" } });
    return {
      ok: false,
      status: 410,
      error: "That plan is over twenty minutes old, so the list may have changed. Ask again to get a fresh one.",
    };
  }

  // The capability is re-checked against the person clicking, not the person
  // who asked. A plan left open on a shared front-desk machine must not lend
  // its author's access to whoever sits down next.
  if (!admin.can(plan.capability as never)) {
    return { ok: false, status: 403, error: `Your admin role does not cover ${plan.capability}.` };
  }

  const action: AssistantAction | undefined = findAction(plan.kind);
  if (!action) {
    return { ok: false, status: 410, error: "That kind of action no longer exists in this version." };
  }

  /**
   * Claim the row BEFORE doing the work.
   *
   * `updateMany` with `status: "pending"` in the where clause is the lock: two
   * confirm clicks race, one updates a row and one updates nothing, and only
   * the winner proceeds. Marking it executed afterwards instead would leave a
   * window in which both clicks are inside the send.
   */
  const claim = await prisma.adminAction.updateMany({
    where: { id: plan.id, status: "pending" },
    data: { status: "executing", executedById: admin.userId },
  });
  if (claim.count === 0) {
    return { ok: false, status: 409, error: "Somebody just confirmed that action." };
  }

  try {
    const result = await action.execute(plan.payload as Record<string, unknown>, admin);

    await prisma.adminAction.update({
      where: { id: plan.id },
      data: {
        status: "executed",
        executedAt: new Date(),
        result: { summary: result.summary, ...result.details } as never,
      },
    });

    return { ok: true, summary: result.summary, details: result.details };
  } catch (error) {
    console.error(`Executing ${plan.kind} failed`, error);
    await prisma.adminAction.update({
      where: { id: plan.id },
      data: {
        status: "failed",
        executedAt: new Date(),
        error: error instanceof Error ? error.message.slice(0, 500) : "Unknown failure",
      },
    });
    return {
      ok: false,
      status: 500,
      // Deliberately not "nothing happened": an action that fails halfway may
      // have messaged some people already, and telling an admin it did nothing
      // invites them to run it again.
      error: "That failed part-way through. Check the area it touched before trying again.",
    };
  }
}

/** Drop a plan without running it. Recorded rather than deleted. */
export async function cancelPlan(planId: string, admin: AdminContext): Promise<boolean> {
  const result = await prisma.adminAction.updateMany({
    where: { id: planId, status: "pending", createdById: admin.userId },
    data: { status: "cancelled" },
  });
  return result.count > 0;
}
