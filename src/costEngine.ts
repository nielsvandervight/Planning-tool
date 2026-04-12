// ============================================================
// COST ENGINE
// src/services/costEngine.ts
// ============================================================

import type {
  ScheduleAssignment,
  CostHistory,
  BudgetTarget,
  CostSummary,
  CostComparison,
} from '../types';

// ── Core calculation ──────────────────────────────────────────

/**
 * cost = hours × hourly_rate × shift_cost_multiplier
 */
export function computeAssignmentCost(
  hourlyRate: number,
  hoursWorked: number,
  costMultiplier = 1.0
): number {
  return parseFloat((hoursWorked * hourlyRate * costMultiplier).toFixed(2));
}

// ── Aggregate from assignments ─────────────────────────────────

export function computeCostSummary(
  assignments: ScheduleAssignment[]
): CostSummary {
  const byDepartment: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byEmployee: Record<string, number> = {};
  const byDate: Record<string, number> = {};

  let totalCost = 0;
  let totalHours = 0;

  for (const a of assignments) {
    totalCost += a.cost;
    totalHours += a.hours_worked;

    if (a.department_id) {
      byDepartment[a.department_id] = (byDepartment[a.department_id] ?? 0) + a.cost;
    }
    if (a.category_id) {
      byCategory[a.category_id] = (byCategory[a.category_id] ?? 0) + a.cost;
    }
    byEmployee[a.employee_id] = (byEmployee[a.employee_id] ?? 0) + a.cost;
    byDate[a.date] = (byDate[a.date] ?? 0) + a.cost;
  }

  return { totalCost, totalHours, byDepartment, byCategory, byEmployee, byDate };
}

// ── Compare current vs historical ────────────────────────────

export function compareCosts(
  currentCost: number,
  historicalCost: number,
  budgetTarget?: BudgetTarget
): CostComparison {
  const difference = currentCost - historicalCost;
  const percentChange =
    historicalCost !== 0 ? (difference / historicalCost) * 100 : 0;

  const result: CostComparison = {
    current: currentCost,
    historical: historicalCost,
    difference,
    percentChange: parseFloat(percentChange.toFixed(2)),
    isBudgetExceeded: false,
  };

  if (budgetTarget) {
    const targetCost = budgetTarget.target_cost;
    const usagePct = targetCost > 0 ? (currentCost / targetCost) * 100 : 0;
    result.budgetTarget = targetCost;
    result.budgetUsagePct = parseFloat(usagePct.toFixed(2));
    result.isBudgetExceeded = usagePct >= budgetTarget.critical_pct;
  }

  return result;
}

// ── Period aggregation ────────────────────────────────────────

export type PeriodType = 'day' | 'week' | 'month' | 'year';

export function aggregateCostByPeriod(
  assignments: ScheduleAssignment[],
  period: PeriodType
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const a of assignments) {
    const key = getPeriodKey(a.date, period);
    result[key] = (result[key] ?? 0) + a.cost;
  }

  return result;
}

function getPeriodKey(date: string, period: PeriodType): string {
  const d = new Date(date);
  switch (period) {
    case 'day':
      return date;
    case 'week': {
      const monday = getMonday(d);
      return monday.toISOString().split('T')[0];
    }
    case 'month':
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    case 'year':
      return String(d.getFullYear());
  }
}

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

// ── Budget warning levels ─────────────────────────────────────

export type BudgetSeverity = 'ok' | 'warning' | 'critical' | 'exceeded';

export function getBudgetSeverity(
  currentCost: number,
  target: BudgetTarget
): BudgetSeverity {
  const pct = (currentCost / target.target_cost) * 100;
  if (pct >= target.critical_pct) return 'exceeded';
  if (pct >= target.warning_pct) return 'critical';
  if (pct >= target.warning_pct * 0.8) return 'warning';
  return 'ok';
}

// ── Historical cost lookup ────────────────────────────────────

export function findHistoricalCost(
  history: CostHistory[],
  warehouseId: string,
  departmentId?: string,
  categoryId?: string,
  periodStart?: string,
  periodEnd?: string
): number {
  const filtered = history.filter((h) => {
    if (h.warehouse_id !== warehouseId) return false;
    if (departmentId && h.department_id !== departmentId) return false;
    if (categoryId && h.category_id !== categoryId) return false;
    if (periodStart && h.period_end < periodStart) return false;
    if (periodEnd && h.period_start > periodEnd) return false;
    return true;
  });

  return filtered.reduce((sum, h) => sum + h.total_cost, 0);
}

// ── Cost forecast from demand ─────────────────────────────────

export interface DemandCostEstimate {
  date: string;
  estimatedCost: number;
  estimatedHours: number;
  staffCount: number;
}

export function estimateCostFromDemand(
  demands: import('../types').Demand[],
  avgHourlyRate: number,
  avgShiftHours: number,
  avgMultiplier = 1.0
): DemandCostEstimate[] {
  const byDate: Record<string, { staff: number; hours: number; cost: number }> = {};

  for (const d of demands) {
    if (!byDate[d.date]) byDate[d.date] = { staff: 0, hours: 0, cost: 0 };
    const staff = d.required_staff;
    const hours = staff * avgShiftHours;
    const cost = hours * avgHourlyRate * avgMultiplier;
    byDate[d.date].staff += staff;
    byDate[d.date].hours += hours;
    byDate[d.date].cost += cost;
  }

  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      estimatedCost: parseFloat(v.cost.toFixed(2)),
      estimatedHours: parseFloat(v.hours.toFixed(2)),
      staffCount: v.staff,
    }));
}

// ── Scenario cost delta ───────────────────────────────────────

export function computeScenarioCostDelta(
  baseAssignments: ScheduleAssignment[],
  scenarioAssignments: ScheduleAssignment[]
): { delta: number; percentDelta: number } {
  const baseCost = baseAssignments.reduce((s, a) => s + a.cost, 0);
  const scenarioCost = scenarioAssignments.reduce((s, a) => s + a.cost, 0);
  const delta = scenarioCost - baseCost;
  const percentDelta = baseCost !== 0 ? (delta / baseCost) * 100 : 0;
  return { delta, percentDelta };
}
