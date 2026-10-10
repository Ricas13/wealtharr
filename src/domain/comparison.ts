import Decimal from "decimal.js";

export type IndexPoint = { date: string; value: Decimal.Value };
export type ExternalFlow = { date: string; amount: Decimal.Value };
export type CounterfactualPoint = { date: string; value: Decimal };

export function simulateSameCashFlows(input: {
  index: IndexPoint[];
  anchorDate: string;
  anchorValue: Decimal.Value;
  flows: ExternalFlow[];
}) {
  const anchorValue = new Decimal(input.anchorValue);
  if (!anchorValue.isFinite() || anchorValue.lt(0)) throw new Error("INVALID_ANCHOR_VALUE");

  const points = [...input.index]
    .filter((point) => point.date >= input.anchorDate)
    .map((point) => ({ date: point.date, value: new Decimal(point.value) }))
    .sort((a,b) => a.date.localeCompare(b.date));

  if (!points.length || points[0].date!==input.anchorDate) return [] as CounterfactualPoint[];
  // Never silently drop bad prices and invent a convincing counterfactual curve.
  if(points.some(point=>!point.value.isFinite()||point.value.lte(0)||
      !/^\d{4}-\d{2}-\d{2}$/.test(point.date)||
      new Date(point.date+"T00:00:00Z").toISOString().slice(0,10)!==point.date))
    throw new Error("INVALID_BENCHMARK_SERIES");
  if(new Set(points.map(point=>point.date)).size!==points.length)throw new Error("DUPLICATE_BENCHMARK_DATE");

  const flows = [...input.flows]
    .filter((flow) => flow.date > input.anchorDate)
    .map((flow) => ({ date: flow.date, amount: new Decimal(flow.amount) }))
    .filter((flow) => !flow.amount.eq(0))
    .sort((a,b) => a.date.localeCompare(b.date));

  if(flows.some(flow=>!flow.amount.isFinite()||!/^\d{4}-\d{2}-\d{2}$/.test(flow.date)))
    throw new Error("INVALID_BENCHMARK_FLOW");
  // Flow timing is a financial fact: never apply a deposit at a later index close.
  // If no price exists on that date, comparisons are unavailable until source coverage improves.
  const marketDays=new Set(points.map(point=>point.date));
  if(flows.some(flow=>!marketDays.has(flow.date)))return [] as CounterfactualPoint[];
  let units = anchorValue.div(points[0].value);
  let flowIndex = 0;
  const result: CounterfactualPoint[] = [];

  for (const point of points) {
    while (flowIndex < flows.length && flows[flowIndex].date <= point.date) {
      units = units.plus(flows[flowIndex].amount.div(point.value));
      if (units.lt(0)) throw new Error("COUNTERFACTUAL_WITHDRAWAL_EXCEEDS_VALUE");
      flowIndex += 1;
    }
    result.push({ date: point.date, value: units.mul(point.value) });
  }

  return result;
}
