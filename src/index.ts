// ============================================================
// WORKFORCE MANAGEMENT SAAS - TYPE DEFINITIONS
// ============================================================

export interface BaseEntity {
  id: string;
  created_at: string;
  updated_at: string;
}

export type UserRole = 'admin' | 'planner' | 'employee';
export type BlockImpact = 'unavailable' | 'reduced' | 'preferred';
export type AssignmentStatus = 'draft' | 'confirmed' | 'published';

export interface UserProfile extends BaseEntity {
  role: UserRole;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  metadata: Record<string, unknown>;
}

export interface Warehouse extends BaseEntity {
  name: string;
  location: string | null;
  timezone: string;
  metadata: Record<string, unknown>;
}

export interface Department extends BaseEntity {
  warehouse_id: string;
  name: string;
  description: string | null;
  color: string;
  metadata: Record<string, unknown>;
}

export interface Employee extends BaseEntity {
  user_id: string | null;
  warehouse_id: string;
  department_id: string | null;
  employee_number: string | null;
  first_name: string;
  last_name: string;
  email: string;
  hourly_rate: number;
  contract_hours: number;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  department_name?: string;
  department_color?: string;
  warehouse_name?: string;
  skills?: EmployeeSkill[];
}

export interface Category extends BaseEntity {
  warehouse_id: string;
  name: string;
  code: string | null;
  description: string | null;
  color: string;
  hourly_budget: number | null;
  metadata: Record<string, unknown>;
}

export interface Skill extends BaseEntity {
  category_id: string | null;
  warehouse_id: string;
  name: string;
  description: string | null;
  priority_weight: number;
  color: string;
  metadata: Record<string, unknown>;
  category_name?: string;
}

export interface EmployeeSkill extends BaseEntity {
  employee_id: string;
  skill_id: string;
  proficiency: number;
  certified_at: string | null;
  expires_at: string | null;
  notes: string | null;
  skill_name?: string;
  skill_color?: string;
  skill_priority?: number;
}

export interface Shift extends BaseEntity {
  warehouse_id: string;
  name: string;
  code: string | null;
  start_time: string;
  end_time: string;
  break_minutes: number;
  cost_multiplier: number;
  color: string;
  is_overnight: boolean;
  min_rest_hours: number;
  metadata: Record<string, unknown>;
  net_hours?: number;
}

export interface TimeBlockType extends BaseEntity {
  warehouse_id: string;
  name: string;
  code: string;
  color: string;
  icon: string | null;
  impact: BlockImpact;
  counts_as_worked: boolean;
  paid: boolean;
  metadata: Record<string, unknown>;
}

export interface TimeBlock extends BaseEntity {
  warehouse_id: string;
  employee_id: string | null;
  type_id: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  impact: BlockImpact;
  priority: number;
  reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  metadata: Record<string, unknown>;
  type_name?: string;
  type_color?: string;
  type_code?: string;
  employee_name?: string;
}

export interface Demand extends BaseEntity {
  warehouse_id: string;
  department_id: string | null;
  category_id: string | null;
  skill_id: string | null;
  date: string;
  shift_id: string | null;
  required_staff: number;
  workload_units: number | null;
  notes: string | null;
}

export interface Schedule extends BaseEntity {
  warehouse_id: string;
  name: string;
  description: string | null;
  week_start: string;
  week_end: string;
  status: AssignmentStatus;
  is_scenario: boolean;
  parent_id: string | null;
  score: number | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  published_at: string | null;
}

export interface AssignmentExplanation {
  skill_score: number;
  availability_score: number;
  shift_score: number;
  fairness_score: number;
  total_score: number;
  penalties: string[];
  reasons: string[];
}

export interface ScheduleAssignment extends BaseEntity {
  schedule_id: string;
  employee_id: string;
  shift_id: string;
  skill_id: string | null;
  category_id: string | null;
  department_id: string | null;
  date: string;
  hours_worked: number;
  cost: number;
  score: number | null;
  explanation: AssignmentExplanation;
  status: AssignmentStatus;
  employee_name?: string;
  employee_rate?: number;
  shift_name?: string;
  shift_color?: string;
  shift_start?: string;
  shift_end?: string;
  skill_name?: string;
  department_name?: string;
  category_name?: string;
}

export interface CostHistory extends BaseEntity {
  warehouse_id: string;
  department_id: string | null;
  category_id: string | null;
  period_start: string;
  period_end: string;
  total_cost: number;
  total_hours: number | null;
  headcount: number | null;
  source: string;
  notes: string | null;
  metadata: Record<string, unknown>;
}

export interface BudgetTarget extends BaseEntity {
  warehouse_id: string;
  department_id: string | null;
  category_id: string | null;
  period_start: string;
  period_end: string;
  target_cost: number;
  warning_pct: number;
  critical_pct: number;
}

export interface ScenarioEvent extends BaseEntity {
  schedule_id: string;
  event_type: 'sickness' | 'absence' | 'extra_demand' | 'cost_change';
  employee_id: string | null;
  category_id: string | null;
  start_date: string;
  end_date: string;
  impact_value: number | null;
  description: string | null;
  metadata: Record<string, unknown>;
}

export interface SchedulingInput {
  scheduleId: string;
  warehouseId: string;
  weekStart: string;
  weekEnd: string;
  employees: Employee[];
  shifts: Shift[];
  skills: Skill[];
  employeeSkills: EmployeeSkill[];
  demand: Demand[];
  timeBlocks: TimeBlock[];
  scenarioEvents?: ScenarioEvent[];
}

export interface AssignmentCandidate {
  employeeId: string;
  shiftId: string;
  date: string;
  skillId: string | null;
  categoryId: string | null;
  departmentId: string | null;
  score: number;
  explanation: AssignmentExplanation;
  hoursWorked: number;
  cost: number;
}

export interface SchedulingResult {
  assignments: AssignmentCandidate[];
  score: number;
  warnings: SchedulingWarning[];
  stats: SchedulingStats;
}

export interface SchedulingWarning {
  type: 'understaffed' | 'overstaffed' | 'rest_violation' | 'skill_mismatch' | 'budget_exceeded';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  date?: string;
  employeeId?: string;
  departmentId?: string;
  categoryId?: string;
}

export interface SchedulingStats {
  totalAssignments: number;
  totalHours: number;
  totalCost: number;
  coverageRate: number;
  avgScore: number;
  understaffedSlots: number;
  overstaffedSlots: number;
}

export interface CostSummary {
  totalCost: number;
  totalHours: number;
  byDepartment: Record<string, number>;
  byCategory: Record<string, number>;
  byEmployee: Record<string, number>;
  byDate: Record<string, number>;
}

export interface CostComparison {
  current: number;
  historical: number;
  difference: number;
  percentChange: number;
  isBudgetExceeded: boolean;
  budgetTarget?: number;
  budgetUsagePct?: number;
}

export interface PlanningBoardState {
  selectedScheduleId: string | null;
  viewMode: 'week' | 'month';
  selectedDepartmentId: string | null;
  selectedWarehouseId: string | null;
  showScenarios: boolean;
  activeScenarioId: string | null;
}
