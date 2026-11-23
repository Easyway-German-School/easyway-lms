/**
 * Runs ON the push-server box via crontab, every minute — see
 * src/lib/infra-guard.ts for the decision logic and the "five rules" this
 * follows. This file is the ONLY place that actually touches systemctl;
 * the lib stays pure and testable, this stays the one narrow side effect.
 *
 * Deliberately systemctl, not a kill signal or an HTTP control endpoint:
 * it's the one mechanism already proven (the service is already managed
 * this way) and it's what a human checking `systemctl status push-server`
 * sees too — no second source of truth about whether it's running.
 */
import { execSync } from "node:child_process";
import { decideInfraGuardAction, logInfraGuardDecision, type PushServerRunningState } from "../src/lib/infra-guard";

function currentState(): PushServerRunningState {
  try {
    const out = execSync("systemctl is-active push-server", { encoding: "utf8" }).trim();
    return out === "active" ? "running" : "stopped";
  } catch {
    // systemctl is-active exits non-zero for any state that isn't "active".
    return "stopped";
  }
}

async function main() {
  const decision = await decideInfraGuardAction(currentState());

  switch (decision.action) {
    case "stop_push_server":
      console.log(`[infra-guard] ${decision.activeConnections} active DB connections — stopping push-server`);
      execSync("systemctl stop push-server");
      break;
    case "restart_push_server":
      console.log(`[infra-guard] DB recovered (${decision.activeConnections} active) — restarting push-server`);
      execSync("systemctl start push-server");
      break;
    case "dry_run_stop":
      console.log(`[infra-guard] DRY RUN: would stop push-server (${decision.activeConnections} active connections)`);
      break;
    case "dry_run_restart":
      console.log(`[infra-guard] DRY RUN: would restart push-server (${decision.activeConnections} active connections)`);
      break;
    case "none":
      // Quiet on purpose for the common "healthy" case — cooldown/already_* are
      // still logged below so the Patterns tab shows real activity, not silence,
      // but they don't need a console line every single minute.
      break;
  }

  await logInfraGuardDecision(decision);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[infra-guard] failed:", error);
    process.exit(1);
  });
