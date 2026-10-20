/**
 * The job inside the Growth Desk. Everyone under the `growth` admin role
 * holds the identical capability — this is purely about which dashboard a
 * person lands on and what the daily task engine generates for them. See
 * User.growthTitle in schema.prisma.
 */
export const GROWTH_TITLES = ["bdm", "sales_lead", "rep"] as const;
export type GrowthTitle = (typeof GROWTH_TITLES)[number];

export const GROWTH_TITLE_LABELS: Record<GrowthTitle, string> = {
  bdm: "Business Development Manager",
  sales_lead: "Sales & Marketing Teamlead",
  rep: "Sales Rep",
};

/** Null, or anything unrecognised, reads as "rep" — the default working account. */
export function normalizeGrowthTitle(value: unknown): GrowthTitle {
  const v = String(value ?? "");
  return (GROWTH_TITLES as readonly string[]).includes(v) ? (v as GrowthTitle) : "rep";
}
