// ============================================================
// SCHEDULING ENGINE
// Greedy + Scoring Hybrid Algorithm
// src/services/schedulingEngine.ts
// ============================================================

import type {
  Employee,
  Shift,
  Skill,
  EmployeeSkill,
  Demand,
  TimeBlock,
  ScenarioEvent,
  SchedulingInput,
  SchedulingResult,
  AssignmentCandidate,
  AssignmentExplanation,
  SchedulingWarning,
  SchedulingStats,
} from '../types';
import { computeShiftNetHours } from '../utils/shiftUtils';
import { dateRange } from '../utils/dateUtils';
import { computeAssignmentCost } from './costEngine';

// ── Scoring Weights ───────────────────────────────────────────
const WEIGHTS = {
  SKILL_MATCH:    0.35,
  SKILL_PRIORITY: 0.20,
  AVAILABILITY:   0.20,
  SHIFT_COMPAT:   0.15,
  FAIRNESS:       0.10,
} as const;

const PENALTY = {
  REST_VIOLATION: 40,
  OVERBOOKING:    20,
  RULE_VIOLATION: 15,
  NO_SKILL:       10,
} as const;

// ── Types ────────────────────────────────────────────────────

interface EmployeeState {
  assignedHours: Map<string, number>; // date -> hours
  lastShiftEnd: Map<string, Date>;    // date -> end datetime
  totalHoursThisWeek: number;
  assignmentCount: number;
}

interface DemandSlot {
  demand: Demand;
  date: string;
  staffCovered: number;
}

// ── Main Engine ──────────────────────────────────────────────

export class SchedulingEngine {
  private input: SchedulingInput;
  private employeeSkillMap: Map<string, EmployeeSkill[]>;   // employeeId -> skills
  private skillMap: Map<string, Skill>;
  private shiftMap: Map<string, Shift>;
  private employeeMap: Map<string, Employee>;
  private blockedDates: Map<string, Set<string>>;           // employeeId -> Set<date>
  private employeeStates: Map<string, EmployeeState>;

  constructor(input: SchedulingInput) {
    this.input = input;
    this.employeeSkillMap = new Map();
    this.skillMap = new Map();
    this.shiftMap = new Map();
    this.employeeMap = new Map();
    this.blockedDates = new Map();
    this.employeeStates = new Map();
    this.initialize();
  }

  private initialize(): void {
    // Build skill map
    for (const skill of this.input.skills) {
      this.skillMap.set(skill.id, skill);
    }

    // Build shift map with computed hours
    for (const shift of this.input.shifts) {
      this.shiftMap.set(shift.id, {
        ...shift,
        net_hours: computeShiftNetHours(shift),
      });
    }

    // Build employee map
    for (const emp of this.input.employees) {
      if (!emp.is_active) continue;
      this.employeeMap.set(emp.id, emp);
      this.employeeStates.set(emp.id, {
        assignedHours: new Map(),
        lastShiftEnd: new Map(),
        totalHoursThisWeek: 0,
        assignmentCount: 0,
      });
    }

    // Build employee skills map
    for (const es of this.input.employeeSkills) {
      if (!this.employeeSkillMap.has(es.employee_id)) {
        this.employeeSkillMap.set(es.employee_id, []);
      }
      this.employeeSkillMap.get(es.employee_id)!.push(es);
    }

    // Build blocked dates from time blocks and scenario events
    this.buildBlockedDates();
  }

  private buildBlockedDates(): void {
    const blocks = [...this.input.timeBlocks];

    // Apply scenario events (sickness, absence)
    if (this.input.scenarioEvents) {
      for (const event of this.input.scenarioEvents) {
        if (
          (event.event_type === 'sickness' || event.event_type === 'absence') &&
          event.employee_id
        ) {
          blocks.push({
            id: `scenario-${event.id}`,
            warehouse_id: this.input.warehouseId,
            employee_id: event.employee_id,
            type_id: 'scenario',
            start_date: event.start_date,
            end_date: event.end_date,
            start_time: null,
            end_time: null,
            impact: 'unavailable',
            priority: 100,
            reason: event.description,
            approved_by: null,
            approved_at: null,
            metadata: {},
            created_at: event.created_at,
            updated_at: event.created_at,
          });
        }
      }
    }

    for (const block of blocks) {
      if (block.impact !== 'unavailable') continue;

      const dates = dateRange(block.start_date, block.end_date);
      const affectedEmployees = block.employee_id
        ? [block.employee_id]
        : Array.from(this.employeeMap.keys()); // global block

      for (const empId of affectedEmployees) {
        if (!this.blockedDates.has(empId)) {
          this.blockedDates.set(empId, new Set());
        }
        for (const date of dates) {
          this.blockedDates.get(empId)!.add(date);
        }
      }
    }
  }

  // ── Core: generate a schedule ───────────────────────────────

  generate(): SchedulingResult {
    const assignments: AssignmentCandidate[] = [];
    const warnings: SchedulingWarning[] = [];
    const dates = dateRange(this.input.weekStart, this.input.weekEnd);

    // Sort demand by priority (higher priority_weight skills first)
    const sortedDemand = this.sortDemandByPriority(this.input.demand);

    for (const date of dates) {
      const demandForDate = sortedDemand.filter((d) => d.date === date);

      for (const demand of demandForDate) {
        const slots = this.fillDemandSlot(demand, date, assignments);
        const covered = slots.length;
        const required = demand.required_staff;

        if (covered < required) {
          warnings.push({
            type: 'understaffed',
            severity: covered === 0 ? 'critical' : 'warning',
            message: `${required - covered} staff missing for ${demand.category_id ?? 'general'} on ${date}`,
            date,
            departmentId: demand.department_id ?? undefined,
            categoryId: demand.category_id ?? undefined,
          });
        } else if (covered > required) {
          warnings.push({
            type: 'overstaffed',
            severity: 'info',
            message: `${covered - required} extra staff assigned on ${date}`,
            date,
          });
        }

        assignments.push(...slots);
      }
    }

    const stats = this.computeStats(assignments, warnings);
    const score = this.computeScheduleScore(stats, warnings);

    return { assignments, score, warnings, stats };
  }

  // Generate N alternative schedules with variation
  generateAlternatives(count = 3): SchedulingResult[] {
    const results: SchedulingResult[] = [];
    const shuffleStrategies = ['random', 'cost-first', 'skill-first', 'fairness-first'];

    for (let i = 0; i < count; i++) {
      const strategy = shuffleStrategies[i % shuffleStrategies.length];
      // Reset states for fresh generation
      this.resetStates();
      const result = this.generateWithStrategy(strategy);
      results.push(result);
    }

    return results.sort((a, b) => b.score - a.score);
  }

  private generateWithStrategy(strategy: string): SchedulingResult {
    const assignments: AssignmentCandidate[] = [];
    const warnings: SchedulingWarning[] = [];
    const dates = dateRange(this.input.weekStart, this.input.weekEnd);

    let sortedDemand = this.sortDemandByPriority(this.input.demand);

    if (strategy === 'random') {
      sortedDemand = [...sortedDemand].sort(() => Math.random() - 0.5);
    } else if (strategy === 'cost-first') {
      // Fill cheapest employees first
      sortedDemand = [...sortedDemand].reverse();
    }

    for (const date of dates) {
      const demandForDate = sortedDemand.filter((d) => d.date === date);
      for (const demand of demandForDate) {
        const slots = this.fillDemandSlot(demand, date, assignments, strategy);
        assignments.push(...slots);
        if (slots.length < demand.required_staff) {
          warnings.push({
            type: 'understaffed',
            severity: 'warning',
            message: `Understaffed (${strategy}) on ${date}`,
            date,
          });
        }
      }
    }

    const stats = this.computeStats(assignments, warnings);
    return {
      assignments,
      score: this.computeScheduleScore(stats, warnings),
      warnings,
      stats,
    };
  }

  // ── Fill one demand slot ──────────────────────────────────────

  private fillDemandSlot(
    demand: Demand,
    date: string,
    existingAssignments: AssignmentCandidate[],
    strategy = 'default'
  ): AssignmentCandidate[] {
    const filled: AssignmentCandidate[] = [];
    const needed = demand.required_staff;
    const assignedEmployees = new Set(
      existingAssignments
        .filter((a) => a.date === date && a.departmentId === demand.department_id)
        .map((a) => a.employeeId)
    );

    // Determine which shift to use
    const shift = demand.shift_id
      ? this.shiftMap.get(demand.shift_id)
      : this.pickBestShift();

    if (!shift) return [];

    // Score all eligible employees
    const candidates = this.scoreEmployeesForSlot(
      demand,
      date,
      shift,
      assignedEmployees,
      strategy
    );

    // Pick top N
    const topCandidates = candidates.slice(0, needed);

    for (const cand of topCandidates) {
      const emp = this.employeeMap.get(cand.employeeId)!;
      const hours = shift.net_hours ?? computeShiftNetHours(shift);
      const cost = computeAssignmentCost(emp.hourly_rate, hours, shift.cost_multiplier);

      const assignment: AssignmentCandidate = {
        employeeId: cand.employeeId,
        shiftId: shift.id,
        date,
        skillId: demand.skill_id,
        categoryId: demand.category_id,
        departmentId: demand.department_id,
        score: cand.score,
        explanation: cand.explanation,
        hoursWorked: hours,
        cost,
      };

      // Update employee state
      const state = this.employeeStates.get(cand.employeeId)!;
      state.totalHoursThisWeek += hours;
      state.assignmentCount++;
      state.assignedHours.set(date, (state.assignedHours.get(date) ?? 0) + hours);

      filled.push(assignment);
    }

    return filled;
  }

  // ── Score all employees for a slot ───────────────────────────

  private scoreEmployeesForSlot(
    demand: Demand,
    date: string,
    shift: Shift,
    excludedEmployees: Set<string>,
    strategy: string
  ): Array<{ employeeId: string; score: number; explanation: AssignmentExplanation }> {
    const results: Array<{ employeeId: string; score: number; explanation: AssignmentExplanation }> = [];

    for (const [empId, emp] of this.employeeMap) {
      // Skip excluded or blocked employees
      if (excludedEmployees.has(empId)) continue;
      if (this.blockedDates.get(empId)?.has(date)) continue;
      if (!emp.is_active) continue;

      const explanation = this.scoreEmployee(emp, demand, date, shift, strategy);
      if (explanation.total_score > 0) {
        results.push({ employeeId: empId, score: explanation.total_score, explanation });
      }
    }

    // Sort by score descending
    return results.sort((a, b) => b.score - a.score);
  }

  // ── Score a single employee ───────────────────────────────────

  private scoreEmployee(
    emp: Employee,
    demand: Demand,
    date: string,
    shift: Shift,
    strategy: string
  ): AssignmentExplanation {
    const penalties: string[] = [];
    const reasons: string[] = [];

    // 1. Skill match score
    let skillScore = 0;
    let skillPriorityScore = 0;

    if (demand.skill_id) {
      const empSkills = this.employeeSkillMap.get(emp.id) ?? [];
      const matchingSkill = empSkills.find((es) => es.skill_id === demand.skill_id);

      if (matchingSkill) {
        skillScore = matchingSkill.proficiency / 100;
        const skill = this.skillMap.get(demand.skill_id);
        skillPriorityScore = skill
          ? Math.min(skill.priority_weight / 5, 1)
          : 0;
        reasons.push(`Skill match: ${Math.round(skillScore * 100)}% proficiency`);
      } else {
        penalties.push('No matching skill');
        skillScore = 0;
        skillScore -= PENALTY.NO_SKILL / 100;
      }
    } else {
      skillScore = 0.5; // No skill required
      reasons.push('No specific skill required');
    }

    // 2. Availability score
    let availabilityScore = 1.0;
    const state = this.employeeStates.get(emp.id)!;
    const contractHoursPerDay = emp.contract_hours / 5;
    const dailyHours = state.assignedHours.get(date) ?? 0;

    if (dailyHours > 0) {
      availabilityScore = 0.3;
      penalties.push('Already assigned today');
    }

    // Check weekly hours vs contract
    const weeklyRatio = state.totalHoursThisWeek / emp.contract_hours;
    if (weeklyRatio > 0.9) {
      availabilityScore *= 0.5;
      penalties.push('Near weekly hour limit');
    } else if (weeklyRatio < 0.5) {
      availabilityScore *= 1.1; // Bonus for underutilized
      reasons.push('Has available hours');
    }

    reasons.push(`Weekly utilization: ${Math.round(weeklyRatio * 100)}%`);

    // 3. Shift compatibility
    let shiftScore = 1.0;
    const lastEnd = state.lastShiftEnd.get(this.getPreviousDate(date));
    if (lastEnd) {
      const shiftStart = this.parseShiftDateTime(date, shift.start_time);
      const restHours = (shiftStart.getTime() - lastEnd.getTime()) / 3_600_000;
      if (restHours < shift.min_rest_hours) {
        shiftScore = 0;
        penalties.push(`Rest violation: ${restHours.toFixed(1)}h < ${shift.min_rest_hours}h required`);
      } else {
        shiftScore = Math.min(restHours / (shift.min_rest_hours * 2), 1);
      }
    }

    // 4. Fairness score (prefer employees with fewer assignments)
    const maxAssignments = Math.max(
      ...Array.from(this.employeeStates.values()).map((s) => s.assignmentCount),
      1
    );
    const fairnessScore =
      1 - state.assignmentCount / (maxAssignments + 1);

    // 5. Strategy modifier
    let strategyBonus = 0;
    if (strategy === 'cost-first') {
      // Prefer cheaper employees
      const maxRate = Math.max(...Array.from(this.employeeMap.values()).map((e) => e.hourly_rate), 1);
      strategyBonus = 1 - emp.hourly_rate / maxRate;
    } else if (strategy === 'skill-first') {
      strategyBonus = skillScore * 0.2;
    } else if (strategy === 'fairness-first') {
      strategyBonus = fairnessScore * 0.2;
    }

    // Weighted total
    const rawScore =
      skillScore * WEIGHTS.SKILL_MATCH +
      skillPriorityScore * WEIGHTS.SKILL_PRIORITY +
      availabilityScore * WEIGHTS.AVAILABILITY +
      shiftScore * WEIGHTS.SHIFT_COMPAT +
      fairnessScore * WEIGHTS.FAIRNESS +
      strategyBonus;

    const total_score = Math.max(0, Math.min(100, rawScore * 100));

    return {
      skill_score: Math.round(skillScore * 100),
      availability_score: Math.round(availabilityScore * 100),
      shift_score: Math.round(shiftScore * 100),
      fairness_score: Math.round(fairnessScore * 100),
      total_score: Math.round(total_score),
      penalties,
      reasons,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────

  private sortDemandByPriority(demand: Demand[]): Demand[] {
    return [...demand].sort((a, b) => {
      const skillA = a.skill_id ? this.skillMap.get(a.skill_id)?.priority_weight ?? 1 : 1;
      const skillB = b.skill_id ? this.skillMap.get(b.skill_id)?.priority_weight ?? 1 : 1;
      return skillB - skillA;
    });
  }

  private pickBestShift(): Shift | undefined {
    // Default to earliest starting shift
    return [...this.shiftMap.values()].sort((a, b) =>
      a.start_time.localeCompare(b.start_time)
    )[0];
  }

  private getPreviousDate(date: string): string {
    const d = new Date(date);
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }

  private parseShiftDateTime(date: string, time: string): Date {
    return new Date(`${date}T${time}:00`);
  }

  private computeStats(
    assignments: AssignmentCandidate[],
    warnings: SchedulingWarning[]
  ): SchedulingStats {
    const totalAssignments = assignments.length;
    const totalHours = assignments.reduce((s, a) => s + a.hoursWorked, 0);
    const totalCost = assignments.reduce((s, a) => s + a.cost, 0);
    const totalDemand = this.input.demand.reduce((s, d) => s + d.required_staff, 0);
    const understaffed = warnings.filter((w) => w.type === 'understaffed').length;
    const overstaffed = warnings.filter((w) => w.type === 'overstaffed').length;
    const avgScore =
      totalAssignments > 0
        ? assignments.reduce((s, a) => s + a.score, 0) / totalAssignments
        : 0;

    return {
      totalAssignments,
      totalHours,
      totalCost,
      coverageRate: totalDemand > 0 ? Math.min(totalAssignments / totalDemand, 1) : 0,
      avgScore,
      understaffedSlots: understaffed,
      overstaffedSlots: overstaffed,
    };
  }

  private computeScheduleScore(stats: SchedulingStats, warnings: SchedulingWarning[]): number {
    let score = stats.coverageRate * 60;
    score += stats.avgScore * 0.3;
    score -= warnings.filter((w) => w.severity === 'critical').length * 10;
    score -= warnings.filter((w) => w.severity === 'warning').length * 3;
    return Math.max(0, Math.min(100, score));
  }

  private resetStates(): void {
    for (const empId of this.employeeMap.keys()) {
      this.employeeStates.set(empId, {
        assignedHours: new Map(),
        lastShiftEnd: new Map(),
        totalHoursThisWeek: 0,
        assignmentCount: 0,
      });
    }
    this.buildBlockedDates();
  }
}

// ── Incremental update (recalculate only affected dates) ──────

export function recalculateAffectedDates(
  existingAssignments: AssignmentCandidate[],
  affectedDates: string[],
  input: SchedulingInput
): AssignmentCandidate[] {
  // Keep assignments not on affected dates
  const kept = existingAssignments.filter(
    (a) => !affectedDates.includes(a.date)
  );

  // Re-run engine only for affected dates
  const partialInput: SchedulingInput = {
    ...input,
    demand: input.demand.filter((d) => affectedDates.includes(d.date)),
    weekStart: affectedDates[0],
    weekEnd: affectedDates[affectedDates.length - 1],
  };

  const engine = new SchedulingEngine(partialInput);
  const result = engine.generate();

  return [...kept, ...result.assignments];
}
