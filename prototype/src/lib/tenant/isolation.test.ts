import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  TENANT_OWNED_MODELS,
  GLOBAL_MODELS,
  isTenantOwned,
  isGloballyShared,
  assertRegistryCoversSchema,
} from "./registry";
import { tenantClient, unscopedClient, TenantIsolationError } from "./client";
import { METERS, PLACEHOLDER_RATES_KOBO, costKobo, meterKey, type MeterName } from "@/lib/usage/meter";

/**
 * These tests exist because isolation is the one property of this system that
 * cannot be checked by looking at the app. A leak does not crash, does not log
 * and does not look wrong on screen — it shows one school a row belonging to
 * another, and the only way anyone finds out is a customer noticing.
 */

const schemaModels = Prisma.dmmf.datamodel.models.map((m) => m.name);

describe("registry covers the whole schema", () => {
  it("classifies every model in the Prisma schema", () => {
    const unclassified = assertRegistryCoversSchema(schemaModels);
    expect(
      unclassified,
      `Unclassified models: ${unclassified.join(", ")}. A model in neither list is readable by every tenant. Add it to TENANT_OWNED_MODELS or GLOBAL_MODELS.`,
    ).toEqual([]);
  });

  it("names no model that does not exist in the schema", () => {
    const known = new Set(schemaModels);
    const phantom = [...TENANT_OWNED_MODELS, ...Object.keys(GLOBAL_MODELS)].filter(
      (name) => !known.has(name),
    );
    expect(phantom, `Registry names models the schema does not have: ${phantom.join(", ")}`).toEqual([]);
  });

  it("puts no model in both lists", () => {
    const both = TENANT_OWNED_MODELS.filter((name) => isGloballyShared(name));
    expect(both).toEqual([]);
  });

  it("treats the models that hold student data as tenant-owned", () => {
    // Named individually rather than derived, so that removing one from the
    // registry fails here loudly instead of silently shrinking the list.
    for (const model of ["Student", "Payment", "Invoice", "Attendance", "Grade", "Certificate", "AuditLog"]) {
      expect(isTenantOwned(model), `${model} must be tenant-owned`).toBe(true);
    }
  });
});

describe("the scoped client fails closed", () => {
  it("refuses an empty tenant id", () => {
    expect(() => tenantClient("")).toThrow(TenantIsolationError);
  });

  it("refuses undefined dressed as a tenant id", () => {
    expect(() => tenantClient(undefined as unknown as string)).toThrow(TenantIsolationError);
    expect(() => tenantClient(null as unknown as string)).toThrow(TenantIsolationError);
  });

  it("accepts a real tenant id", () => {
    expect(() => tenantClient("tenant_easyway_root")).not.toThrow();
  });
});

describe("the unscoped escape hatch is deliberately awkward", () => {
  it("refuses to be called without a reason", () => {
    expect(() => unscopedClient("")).toThrow(TenantIsolationError);
  });

  it("refuses a reason too short to mean anything", () => {
    expect(() => unscopedClient("cron")).toThrow(TenantIsolationError);
  });

  it("allows a real explanation", () => {
    expect(() => unscopedClient("nightly backup runner spans every tenant by design")).not.toThrow();
  });
});

describe("metering arithmetic", () => {
  it("prices every meter", () => {
    for (const meter of Object.keys(METERS) as MeterName[]) {
      expect(PLACEHOLDER_RATES_KOBO[meter], `${meter} has no rate`).toBeTypeOf("number");
    }
  });

  it("charges per block, not per unit", () => {
    // 1000 tokens at 200 kobo per 1000 = 200, not 200_000.
    expect(costKobo("ai.tokens", 1000)).toBe(200);
    expect(costKobo("ai.tokens", 2000)).toBe(400);
  });

  it("counts a participant-minute per participant", () => {
    // ten people for an hour = 600 minutes, which is what LiveKit bills us.
    expect(costKobo("live.participant_minutes", 600)).toBe(30000);
  });

  it("returns whole kobo", () => {
    const value = costKobo("ai.tokens", 1);
    expect(Number.isInteger(value)).toBe(true);
  });

  it("costs nothing for nothing", () => {
    expect(costKobo("ai.tokens", 0)).toBe(0);
  });
});

describe("idempotency keys", () => {
  it("is stable for the same source event", () => {
    expect(meterKey("email.sent", "email:abc123")).toBe(meterKey("email.sent", "email:abc123"));
  });

  it("separates meters that share a source id", () => {
    expect(meterKey("ai.tokens", "sess_1")).not.toBe(meterKey("api.request", "sess_1"));
  });

  it("refuses a bare number, which is how double billing starts", () => {
    // Date.now() and a counter both land here. A key that changes on replay
    // does not deduplicate anything.
    expect(() => meterKey("ai.tokens", String(Date.now()))).toThrow();
    expect(() => meterKey("ai.tokens", "42")).toThrow();
  });

  it("refuses an empty source", () => {
    expect(() => meterKey("ai.tokens", "")).toThrow();
  });
});
