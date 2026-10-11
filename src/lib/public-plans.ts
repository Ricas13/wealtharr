import "server-only";
import { sql } from "@/lib/db";

export type PublicPlan = {
  slug: string;
  name: string;
  description: string;
  currency: string;
  maxStrategies: number | null;
  monthlyMinor: number | null;
  annualMinor: number | null;
  marketing: {
    title: string;
    subtitle: string;
    badge: string;
    cta: string;
    benefits: string[];
    featured: boolean;
  };
  stripeReady: boolean;
  paymentMethods: string[];
};

type RawPlan = Record<string, unknown>;
const stringValue = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const numberValue = (value: unknown) => value == null ? null : Number.isFinite(Number(value)) ? Number(value) : null;

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return parseJson(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function parseArray(value: unknown): string[] {
  if (typeof value === "string") {
    try { return parseArray(JSON.parse(value)); } catch { return []; }
  }
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
export function publicPlanFromRow(row: RawPlan): PublicPlan {
  const m = parseJson(row.marketing);
  const maxStrategies = numberValue(row.max_active_strategies);
  const defaults = maxStrategies === null ? ["Unlimited active strategies"] :
    [maxStrategies + " active " + (maxStrategies === 1 ? "strategy" : "strategies")];
  const benefits = parseArray(m.benefits).filter(Boolean).slice(0, 8);
  const paymentMethods = parseArray(row.payment_methods).filter(x => x === "STRIPE" || x === "PAYPAL");
  return {
    slug: stringValue(row.slug),
    name: stringValue(row.display_name),
    description: stringValue(row.description),
    currency: stringValue(row.billing_currency, "GBP"),
    maxStrategies,
    monthlyMinor: numberValue(row.monthly_minor),
    annualMinor: numberValue(row.annual_minor),
    marketing: {
      title: stringValue(m.title, stringValue(row.display_name)).slice(0, 70),
      subtitle: stringValue(m.subtitle, stringValue(row.description)).slice(0, 280),
      badge: stringValue(m.badge).slice(0, 40),
      cta: stringValue(m.cta, "Choose " + stringValue(row.display_name)).slice(0, 70),
      benefits: benefits.length ? benefits : defaults,
      featured: m.featured === true
    },
    stripeReady: Boolean(row.stripe_ready),
    paymentMethods
  };
}

/** All public prices come from active price rows. No fallback to stale plan defaults. */
export async function loadPublicPlans(): Promise<PublicPlan[]> {
  const rows = await sql.unsafe(
    "SELECT p.slug,p.display_name,p.description,p.billing_currency,p.max_active_strategies," +
    "p.marketing,p.payment_methods," +
    "CASE WHEN p.slug='free' THEN 0 ELSE monthly.amount_minor END AS monthly_minor," +
    "CASE WHEN p.slug='free' THEN 0 ELSE annual.amount_minor END AS annual_minor," +
    "(monthly.stripe_price_id IS NOT NULL OR annual.stripe_price_id IS NOT NULL) AS stripe_ready " +
    "FROM plans p " +
    "LEFT JOIN plan_prices monthly ON monthly.plan_id=p.id AND monthly.currency=p.billing_currency AND monthly.cadence='MONTHLY' AND monthly.active=true " +
    "LEFT JOIN plan_prices annual ON annual.plan_id=p.id AND annual.currency=p.billing_currency AND annual.cadence='ANNUAL' AND annual.active=true " +
    "WHERE p.visible=true AND p.archived=false ORDER BY p.sort_order,p.slug LIMIT 5"
  );
  return rows.map(row => publicPlanFromRow(row as RawPlan)).filter(p =>
    p.slug === "free" || (p.monthlyMinor !== null || p.annualMinor !== null)
  );
}