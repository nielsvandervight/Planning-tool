-- ============================================================
-- WORKFORCE MANAGEMENT SAAS - COMPLETE DATABASE SCHEMA
-- PostgreSQL / Supabase
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM ('admin', 'planner', 'employee');
CREATE TYPE time_block_type AS ENUM ('sick', 'vacation', 'training', 'custom');
CREATE TYPE time_block_impact AS ENUM ('unavailable', 'reduced', 'available');
CREATE TYPE assignment_status AS ENUM ('draft', 'confirmed', 'published');
CREATE TYPE scenario_status AS ENUM ('active', 'archived', 'baseline');

-- ============================================================
-- PROFILES (extends Supabase auth.users)
-- ============================================================

CREATE TABLE public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'employee',
  avatar_url    TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profiles_role ON public.profiles(role);
CREATE INDEX idx_profiles_email ON public.profiles(email);

-- ============================================================
-- WAREHOUSES
-- ============================================================

CREATE TABLE public.warehouses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  code          TEXT NOT NULL UNIQUE,
  address       TEXT,
  timezone      TEXT NOT NULL DEFAULT 'Europe/Amsterdam',
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_by    UUID REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_warehouses_code ON public.warehouses(code);

-- ============================================================
-- DEPARTMENTS
-- ============================================================

CREATE TABLE public.departments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  warehouse_id  UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  code          TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#3B82F6',
  budget_monthly NUMERIC(12,2),
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(warehouse_id, code)
);

CREATE INDEX idx_departments_warehouse ON public.departments(warehouse_id);

-- ============================================================
-- CATEGORIES (clients)
-- ============================================================

CREATE TABLE public.categories (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  code          TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#10B981',
  priority      INTEGER NOT NULL DEFAULT 1,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(department_id, code)
);

CREATE INDEX idx_categories_department ON public.categories(department_id);

-- ============================================================
-- SKILLS
-- ============================================================

CREATE TABLE public.skills (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id     UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  code            TEXT NOT NULL UNIQUE,
  description     TEXT,
  priority_weight NUMERIC(5,2) NOT NULL DEFAULT 1.0,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_skills_category ON public.skills(category_id);
CREATE INDEX idx_skills_priority ON public.skills(priority_weight DESC);

-- ============================================================
-- EMPLOYEES
-- ============================================================

CREATE TABLE public.employees (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  warehouse_id    UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  department_id   UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  employee_number TEXT NOT NULL UNIQUE,
  full_name       TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT,
  hourly_rate     NUMERIC(8,2) NOT NULL DEFAULT 0,
  contract_hours  NUMERIC(5,2) NOT NULL DEFAULT 40,
  start_date      DATE NOT NULL,
  end_date        DATE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_employees_warehouse ON public.employees(warehouse_id);
CREATE INDEX idx_employees_department ON public.employees(department_id);
CREATE INDEX idx_employees_active ON public.employees(is_active);
CREATE INDEX idx_employees_number ON public.employees(employee_number);

-- ============================================================
-- EMPLOYEE SKILLS
-- ============================================================

CREATE TABLE public.employee_skills (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id   UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  skill_id      UUID NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  proficiency   INTEGER NOT NULL DEFAULT 0 CHECK (proficiency BETWEEN 0 AND 100),
  certified_at  DATE,
  expires_at    DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id, skill_id)
);

CREATE INDEX idx_employee_skills_employee ON public.employee_skills(employee_id);
CREATE INDEX idx_employee_skills_skill ON public.employee_skills(skill_id);
CREATE INDEX idx_employee_skills_proficiency ON public.employee_skills(proficiency DESC);

-- ============================================================
-- SHIFTS
-- ============================================================

CREATE TABLE public.shifts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  warehouse_id    UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  code            TEXT NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  break_minutes   INTEGER NOT NULL DEFAULT 30,
  cost_multiplier NUMERIC(5,3) NOT NULL DEFAULT 1.000,
  color           TEXT NOT NULL DEFAULT '#6366F1',
  is_night_shift  BOOLEAN NOT NULL DEFAULT FALSE,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(warehouse_id, code)
);

CREATE INDEX idx_shifts_warehouse ON public.shifts(warehouse_id);

-- ============================================================
-- TIME BLOCK TYPES (custom / dynamic)
-- ============================================================

CREATE TABLE public.time_block_type_definitions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  warehouse_id  UUID REFERENCES public.warehouses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  code          TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#EF4444',
  impact        time_block_impact NOT NULL DEFAULT 'unavailable',
  is_paid       BOOLEAN NOT NULL DEFAULT FALSE,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(warehouse_id, code)
);

-- ============================================================
-- TIME BLOCKS
-- ============================================================

CREATE TABLE public.time_blocks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id     UUID REFERENCES public.employees(id) ON DELETE CASCADE,
  warehouse_id    UUID REFERENCES public.warehouses(id) ON DELETE CASCADE,
  type_id         UUID REFERENCES public.time_block_type_definitions(id),
  block_type      TEXT NOT NULL DEFAULT 'sick',
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  impact          time_block_impact NOT NULL DEFAULT 'unavailable',
  priority        INTEGER NOT NULL DEFAULT 1,
  applied_to_all  BOOLEAN NOT NULL DEFAULT FALSE,
  notes           TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_by      UUID REFERENCES public.profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE INDEX idx_time_blocks_employee ON public.time_blocks(employee_id);
CREATE INDEX idx_time_blocks_dates ON public.time_blocks(start_date, end_date);
CREATE INDEX idx_time_blocks_warehouse ON public.time_blocks(warehouse_id);

-- ============================================================
-- DEMAND (required staff per category/date)
-- ============================================================

CREATE TABLE public.demand (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id     UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  department_id   UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  skill_id        UUID REFERENCES public.skills(id) ON DELETE SET NULL,
  date            DATE NOT NULL,
  required_staff  INTEGER NOT NULL DEFAULT 0 CHECK (required_staff >= 0),
  required_hours  NUMERIC(6,2),
  notes           TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(category_id, skill_id, date)
);

CREATE INDEX idx_demand_category ON public.demand(category_id);
CREATE INDEX idx_demand_date ON public.demand(date);
CREATE INDEX idx_demand_department ON public.demand(department_id);

-- ============================================================
-- SCENARIOS
-- ============================================================

CREATE TABLE public.scenarios (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  warehouse_id  UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  status        scenario_status NOT NULL DEFAULT 'active',
  is_baseline   BOOLEAN NOT NULL DEFAULT FALSE,
  parameters    JSONB NOT NULL DEFAULT '{}',
  created_by    UUID REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scenarios_warehouse ON public.scenarios(warehouse_id);
CREATE INDEX idx_scenarios_status ON public.scenarios(status);

-- ============================================================
-- SCHEDULE ASSIGNMENTS
-- ============================================================

CREATE TABLE public.schedule_assignments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scenario_id   UUID REFERENCES public.scenarios(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  skill_id      UUID REFERENCES public.skills(id) ON DELETE SET NULL,
  shift_id      UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  department_id UUID REFERENCES public.departments(id),
  category_id   UUID REFERENCES public.categories(id),
  date          DATE NOT NULL,
  hours_worked  NUMERIC(5,2) NOT NULL,
  cost          NUMERIC(10,2) NOT NULL DEFAULT 0,
  status        assignment_status NOT NULL DEFAULT 'draft',
  score         NUMERIC(6,3),
  explanation   JSONB NOT NULL DEFAULT '{}',
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_assignments_employee ON public.schedule_assignments(employee_id);
CREATE INDEX idx_assignments_date ON public.schedule_assignments(date);
CREATE INDEX idx_assignments_scenario ON public.schedule_assignments(scenario_id);
CREATE INDEX idx_assignments_department ON public.schedule_assignments(department_id);
CREATE INDEX idx_assignments_shift ON public.schedule_assignments(shift_id);

-- ============================================================
-- COST HISTORY (historical cost data)
-- ============================================================

CREATE TABLE public.cost_history (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  warehouse_id  UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  department_id UUID REFERENCES public.departments(id) ON DELETE CASCADE,
  category_id   UUID REFERENCES public.categories(id) ON DELETE CASCADE,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  actual_cost   NUMERIC(12,2) NOT NULL,
  budgeted_cost NUMERIC(12,2),
  staff_count   INTEGER,
  total_hours   NUMERIC(10,2),
  source        TEXT NOT NULL DEFAULT 'manual',
  notes         TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_by    UUID REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end >= period_start)
);

CREATE INDEX idx_cost_history_warehouse ON public.cost_history(warehouse_id);
CREATE INDEX idx_cost_history_period ON public.cost_history(period_start, period_end);
CREATE INDEX idx_cost_history_department ON public.cost_history(department_id);

-- ============================================================
-- CUSTOM FIELD DEFINITIONS (dynamic schema extension)
-- ============================================================

CREATE TABLE public.custom_field_definitions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  warehouse_id  UUID REFERENCES public.warehouses(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL, -- 'employee', 'shift', 'department', etc.
  field_key     TEXT NOT NULL,
  field_label   TEXT NOT NULL,
  field_type    TEXT NOT NULL DEFAULT 'text', -- text, number, boolean, select, date
  options       JSONB, -- for select type
  is_required   BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(warehouse_id, entity_type, field_key)
);

CREATE INDEX idx_custom_fields_entity ON public.custom_field_definitions(entity_type);

-- ============================================================
-- AUDIT LOG
-- ============================================================

CREATE TABLE public.audit_log (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES public.profiles(id),
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     UUID,
  old_data      JSONB,
  new_data      JSONB,
  ip_address    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_user ON public.audit_log(user_id);
CREATE INDEX idx_audit_log_entity ON public.audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_created ON public.audit_log(created_at DESC);

-- ============================================================
-- COMPUTED VIEWS
-- ============================================================

-- Staff coverage view per day/department
CREATE OR REPLACE VIEW public.v_daily_coverage AS
SELECT
  sa.date,
  sa.department_id,
  d.name AS department_name,
  d.warehouse_id,
  sa.category_id,
  c.name AS category_name,
  sa.skill_id,
  sk.name AS skill_name,
  COUNT(sa.id) AS assigned_staff,
  SUM(sa.hours_worked) AS total_hours,
  SUM(sa.cost) AS total_cost,
  COALESCE(dm.required_staff, 0) AS required_staff,
  COUNT(sa.id) - COALESCE(dm.required_staff, 0) AS staff_delta
FROM public.schedule_assignments sa
LEFT JOIN public.departments d ON sa.department_id = d.id
LEFT JOIN public.categories c ON sa.category_id = c.id
LEFT JOIN public.skills sk ON sa.skill_id = sk.id
LEFT JOIN public.demand dm ON dm.category_id = sa.category_id
  AND dm.date = sa.date
  AND (dm.skill_id = sa.skill_id OR (dm.skill_id IS NULL AND sa.skill_id IS NULL))
GROUP BY sa.date, sa.department_id, d.name, d.warehouse_id,
         sa.category_id, c.name, sa.skill_id, sk.name,
         dm.required_staff;

-- Cost summary view
CREATE OR REPLACE VIEW public.v_cost_summary AS
SELECT
  sa.department_id,
  d.name AS department_name,
  d.warehouse_id,
  w.name AS warehouse_name,
  sa.category_id,
  c.name AS category_name,
  DATE_TRUNC('week', sa.date) AS week_start,
  DATE_TRUNC('month', sa.date) AS month_start,
  DATE_TRUNC('year', sa.date) AS year_start,
  COUNT(DISTINCT sa.employee_id) AS unique_employees,
  SUM(sa.hours_worked) AS total_hours,
  SUM(sa.cost) AS total_cost,
  AVG(sa.cost / NULLIF(sa.hours_worked, 0)) AS avg_hourly_cost
FROM public.schedule_assignments sa
LEFT JOIN public.departments d ON sa.department_id = d.id
LEFT JOIN public.warehouses w ON d.warehouse_id = w.id
LEFT JOIN public.categories c ON sa.category_id = c.id
GROUP BY sa.department_id, d.name, d.warehouse_id, w.name,
         sa.category_id, c.name,
         DATE_TRUNC('week', sa.date),
         DATE_TRUNC('month', sa.date),
         DATE_TRUNC('year', sa.date);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Calculate shift hours (handles overnight shifts)
CREATE OR REPLACE FUNCTION calculate_shift_hours(
  p_start_time TIME,
  p_end_time   TIME,
  p_break_min  INTEGER
) RETURNS NUMERIC AS $$
DECLARE
  raw_minutes INTEGER;
BEGIN
  IF p_end_time > p_start_time THEN
    raw_minutes := EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 60;
  ELSE
    -- overnight shift
    raw_minutes := EXTRACT(EPOCH FROM ('24:00:00'::INTERVAL - p_start_time + p_end_time)) / 60;
  END IF;
  RETURN ROUND((raw_minutes - p_break_min)::NUMERIC / 60, 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Calculate assignment cost
CREATE OR REPLACE FUNCTION calculate_assignment_cost(
  p_hours          NUMERIC,
  p_hourly_rate    NUMERIC,
  p_cost_multiplier NUMERIC
) RETURNS NUMERIC AS $$
BEGIN
  RETURN ROUND(p_hours * p_hourly_rate * p_cost_multiplier, 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','warehouses','departments','categories','skills',
    'employees','employee_skills','shifts','time_blocks','demand',
    'scenarios','schedule_assignments','cost_history'
  ] LOOP
    EXECUTE format('
      CREATE TRIGGER set_timestamp_%I
      BEFORE UPDATE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
    ', t, t);
  END LOOP;
END $$;

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demand ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_history ENABLE ROW LEVEL SECURITY;

-- Helper: get current user role
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS user_role AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Profiles: users see own, admins see all
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (id = auth.uid() OR public.get_user_role() IN ('admin', 'planner'));

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY "profiles_admin" ON public.profiles
  FOR ALL USING (public.get_user_role() = 'admin');

-- Warehouses: admins & planners full access, employees read
CREATE POLICY "warehouses_read" ON public.warehouses
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "warehouses_write" ON public.warehouses
  FOR ALL USING (public.get_user_role() IN ('admin', 'planner'));

-- Departments
CREATE POLICY "departments_read" ON public.departments
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "departments_write" ON public.departments
  FOR ALL USING (public.get_user_role() IN ('admin', 'planner'));

-- Categories
CREATE POLICY "categories_read" ON public.categories
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "categories_write" ON public.categories
  FOR ALL USING (public.get_user_role() IN ('admin', 'planner'));

-- Skills
CREATE POLICY "skills_read" ON public.skills
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "skills_write" ON public.skills
  FOR ALL USING (public.get_user_role() IN ('admin', 'planner'));

-- Employees: employees see own record, planners/admins see all
CREATE POLICY "employees_self" ON public.employees
  FOR SELECT USING (profile_id = auth.uid() OR public.get_user_role() IN ('admin', 'planner'));

CREATE POLICY "employees_write" ON public.employees
  FOR ALL USING (public.get_user_role() IN ('admin', 'planner'));

-- Employee skills
CREATE POLICY "employee_skills_read" ON public.employee_skills
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "employee_skills_write" ON public.employee_skills
  FOR ALL USING (public.get_user_role() IN ('admin', 'planner'));

-- Shifts
CREATE POLICY "shifts_read" ON public.shifts
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "shifts_write" ON public.shifts
  FOR ALL USING (public.get_user_role() IN ('admin', 'planner'));

-- Time blocks
CREATE POLICY "time_blocks_read" ON public.time_blocks
  FOR SELECT USING (
    applied_to_all = TRUE
    OR employee_id IN (SELECT id FROM public.employees WHERE profile_id = auth.uid())
    OR public.get_user_role() IN ('admin', 'planner')
  );

CREATE POLICY "time_blocks_write" ON public.time_blocks
  FOR ALL USING (public.get_user_role() IN ('admin', 'planner'));

-- Demand
CREATE POLICY "demand_read" ON public.demand
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "demand_write" ON public.demand
  FOR ALL USING (public.get_user_role() IN ('admin', 'planner'));

-- Scenarios
CREATE POLICY "scenarios_read" ON public.scenarios
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "scenarios_write" ON public.scenarios
  FOR ALL USING (public.get_user_role() IN ('admin', 'planner'));

-- Schedule assignments
CREATE POLICY "assignments_read" ON public.schedule_assignments
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "assignments_write" ON public.schedule_assignments
  FOR ALL USING (public.get_user_role() IN ('admin', 'planner'));

-- Cost history
CREATE POLICY "cost_history_read" ON public.cost_history
  FOR SELECT USING (public.get_user_role() IN ('admin', 'planner'));

CREATE POLICY "cost_history_write" ON public.cost_history
  FOR ALL USING (public.get_user_role() = 'admin');

-- ============================================================
-- HANDLE NEW USER (trigger on auth.users)
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'employee')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- SEED: DEFAULT TIME BLOCK TYPES
-- ============================================================

-- These are inserted without a warehouse_id = global defaults
INSERT INTO public.time_block_type_definitions (name, code, color, impact, is_paid) VALUES
  ('Sick Leave',    'sick',      '#EF4444', 'unavailable', TRUE),
  ('Vacation',      'vacation',  '#F59E0B', 'unavailable', TRUE),
  ('Training',      'training',  '#3B82F6', 'available',   TRUE),
  ('Unpaid Leave',  'unpaid',    '#6B7280', 'unavailable', FALSE),
  ('Work From Home','wfh',       '#10B981', 'available',   TRUE);
