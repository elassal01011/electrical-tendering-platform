export type CostInputs = {
  material: number;
  labor: number;
  engineering: number;
  testing: number;
  busbar: number;
  enclosure: number;
  accessories: number;
  transport: number;
  overheadPct: number;
  contingencyPct: number;
  warrantyPct: number;
  financePct: number;
  commissionPct: number;
  targetPct: number;
  mode: "MARGIN" | "MARKUP";
};
export function costModel(i: CostInputs) {
  if (
    Object.entries(i).some(
      ([k, v]) => k !== "mode" && (!Number.isFinite(v) || Number(v) < 0),
    ) ||
    i.targetPct >= 100
  )
    throw new Error("Enter non-negative amounts and a target below 100%.");
  const direct =
    i.material +
    i.labor +
    i.engineering +
    i.testing +
    i.busbar +
    i.enclosure +
    i.accessories +
    i.transport;
  const overhead = (direct * i.overheadPct) / 100,
    contingency = (direct * i.contingencyPct) / 100,
    warranty = (direct * i.warrantyPct) / 100,
    finance = (direct * i.financePct) / 100,
    commission = (direct * i.commissionPct) / 100,
    totalCost =
      direct + overhead + contingency + warranty + finance + commission;
  const selling =
    i.mode === "MARGIN"
      ? totalCost / (1 - i.targetPct / 100)
      : totalCost * (1 + i.targetPct / 100);
  return {
    direct,
    overhead,
    contingency,
    warranty,
    finance,
    commission,
    totalCost,
    selling,
    profit: selling - totalCost,
    marginPct: selling ? ((selling - totalCost) / selling) * 100 : 0,
    markupPct: totalCost ? ((selling - totalCost) / totalCost) * 100 : 0,
  };
}
export const DEFAULT_PROFILES = {
  AGGRESSIVE: {
    targetPct: 12,
    overheadPct: 5,
    contingencyPct: 1,
    warrantyPct: 1,
    financePct: 0,
    commissionPct: 0,
  },
  STANDARD: {
    targetPct: 20,
    overheadPct: 8,
    contingencyPct: 3,
    warrantyPct: 2,
    financePct: 0,
    commissionPct: 0,
  },
  SAFE: {
    targetPct: 25,
    overheadPct: 10,
    contingencyPct: 5,
    warrantyPct: 3,
    financePct: 0,
    commissionPct: 0,
  },
};
