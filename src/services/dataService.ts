// src/services/dataService.ts
import { supabase } from './supabase';

export const dataService = {
  // --- WAREHOUSES & DEPARTMENTS ---
  async getWarehouses() {
    const { data, error } = await supabase.from('warehouses').select('*');
    if (error) throw error;
    return data;
  },

  async getDepartments(warehouseId?: string) {
    let query = supabase.from('departments').select('*, warehouses(name)');
    if (warehouseId) query = query.eq('warehouse_id', warehouseId);
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  // --- EMPLOYEES & SKILLS ---
  async getEmployees() {
    const { data, error } = await supabase
      .from('employees')
      .select(`
        *,
        employee_skills(
          proficiency,
          skills(name, priority_weight)
        )
      `);
    if (error) throw error;
    return data;
  },

  // --- SCHEDULING ---
  async getShifts(startDate: string, endDate: string) {
    const { data, error } = await supabase
      .from('schedule_assignments')
      .select(`
        *,
        employees(name, hourly_rate),
        shifts(name, start_time, end_time, cost_multiplier)
      `)
      .gte('date', startDate)
      .lte('date', endDate);
    if (error) throw error;
    return data;
  },

  // --- TIME BLOCKS (Vacation, Sick) ---
  async getTimeBlocks(employeeId?: string) {
    let query = supabase.from('time_blocks').select('*');
    if (employeeId) query = query.eq('employee_id', employeeId);

    const { data, error } = await query;
    if (error) throw error;
    return data;
  }
};