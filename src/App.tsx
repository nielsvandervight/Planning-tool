import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient, Session } from "@supabase/supabase-js";
import {
  Users, Calendar, Settings, Euro, LogOut, ChevronLeft, ChevronRight,
  Plus, Trash2, Printer, Zap, ToggleLeft, ToggleRight, AlertTriangle,
  Eye, EyeOff, TrendingUp, Building2, PieChart, Clock, Shield, Coffee,
  X, Check, Edit2, Save
} from "lucide-react";

// ─── Supabase client ─────────────────────────────────────────────────────────
const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("FOUT: Supabase URL of Key ontbreekt in .env bestand!");
}
export const sb       = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const supabase = sb;

// ─── Types ────────────────────────────────────────────────────────────────────
interface Department  { id: string; name: string; }
interface Skill       { id: string; name: string; criteria: string; }
interface ShiftDef    { id: string; label: string; hours: number[]; }
interface Subcategory { id: string; clientId: string; name: string; targetSkills: string[]; requireBreakCover: boolean; }
interface Client      { id: string; name: string; departmentId: string; fteNeeded: number; useFTE: boolean; }
interface BreakSlot   { id: string; startHour: number; startMin: number; endHour: number; endMin: number; label: string; }
interface Employee {
  id: string; name: string; departmentId: string;
  hoursPerWeek: number; mainClientId: string;
  subCatIds: string[];
  subCatSkills: Record<string, Record<string, number>>;
  standardOffDays: string[];
  vacationDates: string[];
  defaultShiftId: string;
  hourlyWage: number;
  isAdmin: boolean;
  color: string;
  breaks: BreakSlot[];
}
interface SlotRow   { employeeId: string; shiftId: string; selectedHours: number[]; }
interface SlotEntry { rows: SlotRow[]; }

// ─── Constanten ───────────────────────────────────────────────────────────────
const WORK_HOURS   = [5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22];
const DAY_LABELS   = ["Maandag","Dinsdag","Woensdag","Donderdag","Vrijdag","Zaterdag","Zondag"];
const MONTH_LABELS = ["Januari","Februari","Maart","April","Mei","Juni","Juli","Augustus","September","Oktober","November","December"];
const EMPLOYEE_COLORS = [
  "#3B82F6","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899","#06B6D4","#84CC16",
  "#F97316","#6366F1","#14B8A6","#F43F5E","#A78BFA","#34D399","#FBBF24","#60A5FA",
  "#E879F9","#FB7185","#4ADE80","#38BDF8","#FCD34D","#A3E635",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function weekNum(d: Date): number {
  const u  = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dn = u.getUTCDay() || 7;
  u.setUTCDate(u.getUTCDate() + 4 - dn);
  const y0 = new Date(Date.UTC(u.getUTCFullYear(), 0, 1));
  return Math.ceil((((u.getTime()-y0.getTime())/86400000)+1)/7);
}
function startOfWeek(d: Date): Date {
  const r = new Date(d); const day = r.getDay();
  r.setDate(r.getDate() - day + (day === 0 ? -6 : 1));
  r.setHours(0,0,0,0); return r;
}
function datesInMonth(month: number, year: number): Date[] {
  const out: Date[] = []; const d = new Date(year, month, 1);
  while (d.getMonth() === month) { out.push(new Date(d)); d.setDate(d.getDate()+1); }
  return out;
}
function groupByWeek(dates: Date[]): Date[][] {
  const weeks: Date[][] = []; let cur: Date[] = [];
  for (const d of dates) {
    const idx = d.getDay() === 0 ? 6 : d.getDay()-1;
    if (idx === 0 && cur.length > 0) { weeks.push(cur); cur = []; }
    cur.push(d);
  }
  if (cur.length) weeks.push(cur);
  return weeks;
}
function dayLabel(d: Date): string { return DAY_LABELS[d.getDay()===0?6:d.getDay()-1]; }
function fmtEuro(n: number): string {
  return new Intl.NumberFormat("nl-NL", { style:"currency", currency:"EUR" }).format(n);
}
function contrastColor(hex: string): string {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return (r*299+g*587+b*114)/1000 > 128 ? "#000000" : "#ffffff";
}
function getWeekKey(date: Date): string { return fmtDate(startOfWeek(date)); }
function isWeekend(date: Date): boolean { return date.getDay() === 0 || date.getDay() === 6; }

// Berekening pauzetijd in minuten op basis van BreakSlot array
function calcBreakMinutesForHours(breaks: BreakSlot[], selectedHours: number[]): number {
  if (!breaks || breaks.length === 0) {
    return (selectedHours?.length || 0) >= 9 ? 60 : 0;
  }
  let total = 0;
  breaks.forEach(b => {
    const breakStartDec = b.startHour + b.startMin / 60;
    const breakEndDec   = b.endHour   + b.endMin   / 60;
    if (!selectedHours || selectedHours.length === 0) return;
    const shiftStart = Math.min(...selectedHours);
    const shiftEnd   = Math.max(...selectedHours) + 1;
    const overlap    = Math.max(0, Math.min(shiftEnd, breakEndDec) - Math.max(shiftStart, breakStartDec));
    total += overlap * 60;
  });
  return total;
}
function nettoUrenEmp(emp: Employee, selectedHours: number[]): number {
  const bruto  = selectedHours?.length || 0;
  const breakH = calcBreakMinutesForHours(emp.breaks, selectedHours) / 60;
  return Math.max(0, bruto - breakH);
}
function nettoUren(selectedHours: number[]): number {
  const bruto = selectedHours?.length || 0;
  return bruto >= 9 ? bruto - 1 : bruto;
}

function useDebounce<T extends (...args: any[]) => any>(fn: T, delay: number): T {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const fnRef  = useRef(fn);
  fnRef.current = fn;
  return useCallback((...args: Parameters<T>) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fnRef.current(...args), delay);
  }, [delay]) as T;
}

// ─── Print CSS ────────────────────────────────────────────────────────────────
function buildPrintCSS(size: "A4"|"A3"): string {
  const fs     = size==="A4" ? "5.8pt" : "7.5pt";
  const hfs    = size==="A4" ? "5pt"   : "6.5pt";
  return `@media print{*{box-sizing:border-box}body{margin:0;background:#fff!important;color:#111!important;font-family:'Helvetica Neue',Arial,sans-serif}.screen-only{display:none!important}.print-wrap{display:block!important}.pw-page{page-break-after:always;padding:8mm}.pw-page:last-child{page-break-after:auto}.pw-header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid #0f172a;padding-bottom:5px;margin-bottom:8px}.pw-title{font-size:${size==="A4"?"13pt":"16pt"};font-weight:900;color:#0f172a}.pw-sub{font-size:${hfs};color:#64748b;margin-top:2px}.pw-meta{font-size:${hfs};color:#94a3b8;text-align:right}.pw-tbl{border-collapse:collapse;width:100%}.pw-tbl th{background:#1e293b!important;-webkit-print-color-adjust:exact;print-color-adjust:exact;color:#f8fafc!important;font-size:${hfs};font-weight:700;padding:3px;text-align:center}.pw-tbl td{border:1px solid #e2e8f0;font-size:${fs};padding:0;vertical-align:top}.pw-emp-block{-webkit-print-color-adjust:exact;print-color-adjust:exact;border-radius:2px;padding:1px 2px;margin:1px;font-size:${fs};font-weight:700}.pw-break-block{background:repeating-linear-gradient(45deg,#e2e8f0,#e2e8f0 2px,#f8fafc 2px,#f8fafc 6px)!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}@page{size:${size} landscape;margin:8mm}}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// LOGIN SCHERM
// ══════════════════════════════════════════════════════════════════════════════
function LoginScreen() {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  async function handleLogin() {
    setLoading(true); setError("");
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  }

  return (
    <div style={{ minHeight:"100vh", background:"#020617", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Segoe UI',system-ui,sans-serif" }}>
      <div style={{ background:"#0f172a", borderRadius:"20px", padding:"48px 40px", width:"380px", border:"1px solid #1e293b", boxShadow:"0 40px 80px rgba(0,0,0,0.8)" }}>
        <div style={{ marginBottom:"32px", textAlign:"center" }}>
          <div style={{ width:"52px", height:"52px", background:"#3B82F6", borderRadius:"14px", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px" }}>
            <Calendar size={26} color="white"/>
          </div>
          <div style={{ fontSize:"24px", fontWeight:"700", color:"white", letterSpacing:"-0.5px" }}>Personeelsplanning</div>
          <div style={{ fontSize:"13px", color:"#475569", marginTop:"6px" }}>Inloggen om verder te gaan</div>
        </div>
        <div style={{ marginBottom:"16px" }}>
          <label style={{ fontSize:"11px", fontWeight:"600", color:"#64748B", display:"block", marginBottom:"6px", letterSpacing:"0.06em" }}>E-MAILADRES</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="naam@bedrijf.nl"
            style={{ width:"100%", padding:"11px 14px", background:"#1e293b", color:"white", border:"1px solid #334155", borderRadius:"10px", fontSize:"14px", boxSizing:"border-box", outline:"none" }}/>
        </div>
        <div style={{ marginBottom:"24px" }}>
          <label style={{ fontSize:"11px", fontWeight:"600", color:"#64748B", display:"block", marginBottom:"6px", letterSpacing:"0.06em" }}>WACHTWOORD</label>
          <input type="password" autoComplete="current-password" value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key==="Enter" && handleLogin()} placeholder="••••••••"
            style={{ width:"100%", padding:"11px 14px", background:"#1e293b", color:"white", border:"1px solid #334155", borderRadius:"10px", fontSize:"14px", boxSizing:"border-box", outline:"none" }}/>
        </div>
        {error && <div style={{ background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)", color:"#FCA5A5", borderRadius:"8px", padding:"10px 14px", marginBottom:"16px", fontSize:"13px" }}>{error}</div>}
        <button onClick={handleLogin} disabled={loading}
          style={{ width:"100%", padding:"12px", background:loading?"#1e293b":"#3B82F6", border:"none", color:"white", borderRadius:"10px", fontWeight:"700", fontSize:"15px", cursor:loading?"wait":"pointer" }}>
          {loading ? "Inloggen..." : "Inloggen"}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL COMPONENT (buiten App gedefinieerd om focus-verlies te voorkomen)
// ══════════════════════════════════════════════════════════════════════════════
interface ModalProps { title: string; onClose: () => void; children: React.ReactNode; width?: string; }
const Modal = React.memo(function Modal({ title, onClose, children, width="520px" }: ModalProps) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", padding:"16px" }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:"#0f172a", borderRadius:"16px", padding:"28px", width, maxWidth:"95vw", maxHeight:"90vh", overflowY:"auto", border:"1px solid #1e293b", boxShadow:"0 25px 80px rgba(0,0,0,0.7)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"20px" }}>
          <div style={{ fontSize:"18px", fontWeight:"bold", color:"white" }}>{title}</div>
          <button onClick={onClose} style={{ background:"#1e293b", border:"none", color:"white", borderRadius:"8px", padding:"6px 14px", cursor:"pointer" }}>
            <X size={14}/>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
});

// ── Kleur Picker component ────────────────────────────────────────────────────
const ColorPicker = React.memo(function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position:"relative", display:"inline-block" }}>
      <div onClick={() => setOpen(v => !v)} style={{ width:"28px", height:"28px", borderRadius:"50%", background:value, cursor:"pointer", border:"2px solid #475569", boxSizing:"border-box" }} title="Kies kleur"/>
      {open && (
        <div style={{ position:"absolute", top:"34px", left:0, background:"#1e293b", borderRadius:"10px", padding:"10px", border:"1px solid #334155", zIndex:100, display:"grid", gridTemplateColumns:"repeat(6,22px)", gap:"4px", boxShadow:"0 10px 30px rgba(0,0,0,0.5)" }}>
          {EMPLOYEE_COLORS.map(c => (
            <div key={c} onClick={() => { onChange(c); setOpen(false); }}
              style={{ width:"22px", height:"22px", borderRadius:"50%", background:c, cursor:"pointer", border:c===value?"3px solid white":"2px solid transparent", boxSizing:"border-box" }}/>
          ))}
          <div style={{ gridColumn:"1/-1", marginTop:"4px", borderTop:"1px solid #334155", paddingTop:"6px" }}>
            <label style={{ fontSize:"9px", color:"#64748B", display:"block", marginBottom:"3px" }}>EIGEN KLEUR</label>
            <input type="color" value={value} onChange={e => { onChange(e.target.value); setOpen(false); }}
              style={{ width:"100%", height:"24px", cursor:"pointer", background:"none", border:"none", borderRadius:"4px" }}/>
          </div>
        </div>
      )}
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// HOOFD APP
// ══════════════════════════════════════════════════════════════════════════════
function App({ session }: { session: Session }) {
  const [activeTab, setActiveTab] = useState<"planning"|"medewerkers"|"beheer"|"financieel"|"admin">("planning");

  const [depts,     setDeptsState]     = useState<Department[]>([]);
  const [skills,    setSkillsState]    = useState<Skill[]>([]);
  const [shiftDefs, setShiftDefsState] = useState<ShiftDef[]>([]);
  const [clients,   setClientsState]   = useState<Client[]>([]);
  const [subcats,   setSubcatsState]   = useState<Subcategory[]>([]);
  const [employees, setEmployees]      = useState<Employee[]>([]);
  const [schedule,  setSchedule]       = useState<Record<string,SlotEntry>>({});

  const [activeDeptId,   setActiveDeptId]   = useState("");
  const [viewType,       setViewType]       = useState<"week"|"maand">("week");
  const [useFTE,         setUseFTE]         = useState(true);
  const [printSize,      setPrintSize]      = useState<"A4"|"A3">("A4");
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [loading,        setLoading]        = useState(true);

  const today = new Date();
  const [weekStart,  setWeekStart]  = useState<Date>(() => startOfWeek(today));
  const [viewMonth,  setViewMonth]  = useState(today.getMonth());
  const [viewYear,   setViewYear]   = useState(today.getFullYear());

  // Modal states
  const [vacModal,        setVacModal]        = useState<string|null>(null);
  const [vacModalMonth,   setVacModalMonth]   = useState(today.getMonth());
  const [vacModalYear,    setVacModalYear]    = useState(today.getFullYear());
  const [customShiftSlot, setCustomShiftSlot] = useState<{slotId:string;rowIdx:number}|null>(null);
  const [customStart,     setCustomStart]     = useState(8);
  const [customEnd,       setCustomEnd]       = useState(17);
  const [showCalcFor,     setShowCalcFor]     = useState<string|null>(null);

  // Medewerker / skill / subcat modals (BUITEN render om focus-verlies te voorkomen)
  const [empModalId,   setEmpModalId]   = useState<string|null>(null);
  const [skillModalId, setSkillModalId] = useState<string|null>(null);
  const [subcatModalId,setSubcatModalId] = useState<string|null>(null);
  const [deptModalId,  setDeptModalId]  = useState<string|null>(null);

  const currentUserId = session.user.id;
  const currentEmp    = employees.find(e => e.id === currentUserId) ?? employees.find(e => e.isAdmin);
  const isAdmin       = currentEmp?.isAdmin ?? false;

  // ── Data laden ────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [dr,skr,shr,cr,scr,er,schr] = await Promise.all([
          sb.from("departments").select("*"),
          sb.from("skills").select("*"),
          sb.from("shift_defs").select("*"),
          sb.from("clients").select("*"),
          sb.from("subcategories").select("*"),
          sb.from("employees").select("*"),
          sb.from("schedule").select("*"),
        ]);
        if (dr.data?.length)  setDeptsState(dr.data.map((x:any) => ({ id:x.id, name:x.name })));
        if (skr.data?.length) setSkillsState(skr.data.map((x:any) => ({ id:x.id, name:x.name, criteria:x.criteria||"" })));
        if (shr.data?.length) setShiftDefsState(shr.data.map((x:any) => ({ id:x.id, label:x.label, hours:x.hours||[] })));
        if (cr.data?.length)  setClientsState(cr.data.map((x:any) => ({ id:x.id, name:x.name, departmentId:x.department_id, fteNeeded:x.fte_needed||1, useFTE:x.use_fte!==false })));
        if (scr.data?.length) setSubcatsState(scr.data.map((x:any) => ({ id:x.id, clientId:x.client_id, name:x.name, targetSkills:x.target_skills||[], requireBreakCover:x.require_break_cover||false })));
        if (er.data?.length)  setEmployees(er.data.map((x:any) => ({
          id:x.id, name:x.name, departmentId:x.department_id,
          hoursPerWeek:x.hours_per_week||40, mainClientId:x.main_client_id||"",
          subCatIds:x.sub_cat_ids||[], subCatSkills:x.sub_cat_skills||{},
          standardOffDays:x.standard_off_days||[], vacationDates:x.vacation_dates||[],
          defaultShiftId:x.default_shift_id||"", hourlyWage:x.hourly_wage||0,
          isAdmin:x.is_admin||false, color:x.color||EMPLOYEE_COLORS[0],
          breaks: (x.pause_config||x.breaks||[]).map((b:any) => ({
            id: b.id || "br"+Math.random(),
            startHour: b.startHour ?? (b.start ? parseInt(b.start.split(":")[0]) : 12),
            startMin:  b.startMin  ?? (b.start ? parseInt(b.start.split(":")[1]||"0") : 0),
            endHour:   b.endHour   ?? (b.end   ? parseInt(b.end.split(":")[0]) : 12),
            endMin:    b.endMin    ?? (b.end   ? parseInt(b.end.split(":")[1]||"0") : 30),
            label:     b.label     || "Pauze",
          })),
        })));
        if (schr.data?.length) {
          const built: Record<string,SlotEntry> = {};
          schr.data.forEach((x:any) => { built[x.slot_id] = { rows:x.rows||[] }; });
          setSchedule(built);
        }
        if (dr.data?.length) setActiveDeptId(dr.data[0].id);
      } catch(e) { console.error("Supabase laad-fout:", e); }
      setLoading(false);
    })();
  }, []);

  // ── Sync helpers ──────────────────────────────────────────────────────────
  const _syncCell = useCallback(async (slotId: string, entry: SlotEntry) => {
    await sb.from("schedule").upsert({ slot_id:slotId, rows:entry.rows, updated_at:new Date().toISOString() }, { onConflict:"slot_id" });
  }, []);
  const syncCell = useDebounce(_syncCell, 600);

  const _syncEmp = useCallback(async (emp: Employee) => {
    await sb.from("employees").upsert({
      id:emp.id, name:emp.name, department_id:emp.departmentId,
      hours_per_week:emp.hoursPerWeek, main_client_id:emp.mainClientId||null,
      sub_cat_ids:emp.subCatIds, sub_cat_skills:emp.subCatSkills,
      standard_off_days:emp.standardOffDays, vacation_dates:emp.vacationDates,
      default_shift_id:emp.defaultShiftId||null, hourly_wage:emp.hourlyWage||0,
      is_admin:emp.isAdmin||false, color:emp.color||EMPLOYEE_COLORS[0],
      pause_config:emp.breaks||[], breaks:emp.breaks||[],
      updated_at:new Date().toISOString(),
    }, { onConflict:"id" });
  }, []);
  const syncEmployee = useDebounce(_syncEmp, 800);

  const _syncDept   = useCallback(async (d: Department)   => { await sb.from("departments").upsert({ id:d.id, name:d.name }, { onConflict:"id" }); }, []);
  const syncDept    = useDebounce(_syncDept, 800);
  const _syncSkill  = useCallback(async (s: Skill)         => { await sb.from("skills").upsert({ id:s.id, name:s.name, criteria:s.criteria }, { onConflict:"id" }); }, []);
  const syncSkill   = useDebounce(_syncSkill, 800);
  const _syncClient = useCallback(async (c: Client)        => { await sb.from("clients").upsert({ id:c.id, name:c.name, department_id:c.departmentId, fte_needed:c.fteNeeded, use_fte:c.useFTE }, { onConflict:"id" }); }, []);
  const syncClient  = useDebounce(_syncClient, 800);
  const _syncSubcat = useCallback(async (s: Subcategory)   => { await sb.from("subcategories").upsert({ id:s.id, client_id:s.clientId, name:s.name, target_skills:s.targetSkills, require_break_cover:s.requireBreakCover }, { onConflict:"id" }); }, []);
  const syncSubcat  = useDebounce(_syncSubcat, 800);
  const _syncShift  = useCallback(async (s: ShiftDef)      => { await sb.from("shift_defs").upsert({ id:s.id, label:s.label, hours:s.hours }, { onConflict:"id" }); }, []);
  const syncShift   = useDebounce(_syncShift, 800);

  // ── Update functies ───────────────────────────────────────────────────────
  function updSchedule(slotId: string, entry: SlotEntry) {
    setSchedule(prev => ({ ...prev, [slotId]:entry }));
    syncCell(slotId, entry);
  }
  function updEmployee(emp: Employee) {
    setEmployees(prev => prev.map(e => e.id===emp.id ? emp : e));
    syncEmployee(emp);
  }
  function setDepts(fn: (prev: Department[]) => Department[])     { setDeptsState(fn); }
  function setSkills(fn: (prev: Skill[]) => Skill[])               { setSkillsState(fn); }
  function setClients(fn: (prev: Client[]) => Client[])             { setClientsState(fn); }
  function setSubcats(fn: (prev: Subcategory[]) => Subcategory[])   { setSubcatsState(fn); }
  function setShiftDefs(fn: (prev: ShiftDef[]) => ShiftDef[])       { setShiftDefsState(fn); }

  async function deleteDept(id: string) {
    setDeptsState(prev => prev.filter(d => d.id !== id));
    await sb.from("departments").delete().eq("id", id);
  }
  async function deleteSkill(id: string) {
    setSkillsState(prev => prev.filter(s => s.id !== id));
    await sb.from("skills").delete().eq("id", id);
  }
  async function deleteClient(id: string) {
    setClientsState(prev => prev.filter(c => c.id !== id));
    setSubcatsState(prev => prev.filter(s => s.clientId !== id));
    await sb.from("clients").delete().eq("id", id);
  }
  async function deleteSubcat(id: string) {
    setSubcatsState(prev => prev.filter(s => s.id !== id));
    await sb.from("subcategories").delete().eq("id", id);
  }
  async function deleteShift(id: string) {
    setShiftDefsState(prev => prev.filter(s => s.id !== id));
    await sb.from("shift_defs").delete().eq("id", id);
  }
  async function deleteEmployee(id: string) {
    setEmployees(prev => prev.filter(e => e.id !== id));
    await sb.from("employees").delete().eq("id", id);
  }

  // ── Navigatie ─────────────────────────────────────────────────────────────
  const displayDates = useCallback((): Date[] => {
    if (viewType==="maand") return datesInMonth(viewMonth, viewYear);
    return Array.from({length:7}, (_,i) => { const d=new Date(weekStart); d.setDate(weekStart.getDate()+i); return d; });
  }, [viewType, viewMonth, viewYear, weekStart]);

  function prevPeriod() {
    if (viewType==="week") { const d=new Date(weekStart); d.setDate(d.getDate()-7); setWeekStart(d); }
    else if (viewMonth===0) { setViewMonth(11); setViewYear(y=>y-1); }
    else setViewMonth(m=>m-1);
  }
  function nextPeriod() {
    if (viewType==="week") { const d=new Date(weekStart); d.setDate(d.getDate()+7); setWeekStart(d); }
    else if (viewMonth===11) { setViewMonth(0); setViewYear(y=>y+1); }
    else setViewMonth(m=>m+1);
  }
  function goToWeek(wn: number) {
    const jan4 = new Date(viewYear, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const weekOneStart = new Date(jan4);
    weekOneStart.setDate(jan4.getDate() - dayOfWeek + 1);
    const target = new Date(weekOneStart);
    target.setDate(weekOneStart.getDate() + (wn-1)*7);
    setWeekStart(startOfWeek(target));
  }

  // ── Planning helpers ──────────────────────────────────────────────────────
  function isAvail(emp: Employee, date: Date): boolean {
    if (emp.standardOffDays.includes(dayLabel(date))) return false;
    if (emp.vacationDates.includes(fmtDate(date))) return false;
    return true;
  }
  function dailyHours(emp: Employee): number {
    const wd = 7 - emp.standardOffDays.length;
    return wd > 0 ? Math.round(emp.hoursPerWeek/wd) : 8;
  }
  function defaultHours(emp: Employee): number[] {
    const h = dailyHours(emp);
    return Array.from({length:Math.min(h,9)}, (_,i) => 8+i);
  }
  function calcScore(emp: Employee, sub: Subcategory): number {
    if (!sub.targetSkills.length) return 0;
    const mx   = emp.subCatSkills[sub.id]||{};
    const vals = sub.targetSkills.map(sid => { const v=mx[sid]; return (typeof v==="number"&&!isNaN(v))?v:0; });
    return Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
  }
  function getShift(shiftId: string): ShiftDef|undefined { return shiftDefs.find(s => s.id===shiftId); }

  // Strikt per kalenderweek, pauze telt niet mee als werkuren
  function geplandUrenDezeWeek(empId: string, referenceDate: Date): number {
    const sw = startOfWeek(referenceDate);
    let total = 0;
    for (let i = 0; i < 7; i++) {
      const d   = new Date(sw); d.setDate(sw.getDate() + i);
      const ds  = fmtDate(d);
      const emp = employees.find(e => e.id === empId);
      Object.entries(schedule)
        .filter(([slotId]) => slotId.startsWith(ds))
        .forEach(([,entry]) => {
          entry.rows?.forEach(r => {
            if (r.employeeId === empId) {
              total += emp ? nettoUrenEmp(emp, r.selectedHours) : nettoUren(r.selectedHours);
            }
          });
        });
    }
    return total;
  }

  function fteForClient(clientId: string): number {
    const dates  = displayDates();
    const csubs  = subcats.filter(s => s.clientId===clientId);
    let uniquePersonDays = 0;
    dates.forEach(date => {
      const ds   = fmtDate(date);
      const seen = new Set<string>();
      if (!csubs.length) {
        schedule[`${ds}-client-${clientId}`]?.rows?.forEach(r => { if (r.employeeId) seen.add(r.employeeId); });
      } else {
        csubs.forEach(sub => {
          schedule[`${ds}-${sub.id}`]?.rows?.forEach(r => { if (r.employeeId) seen.add(r.employeeId); });
        });
      }
      uniquePersonDays += seen.size;
    });
    const workingDays = dates.filter(d => !isWeekend(d)).length || 5;
    return uniquePersonDays / workingDays;
  }

  // ── FTE logica ────────────────────────────────────────────────────────────
  function calcFTESlotsForDay(client: Client, date: Date): {full: number; half: number} {
    const fte = client.fteNeeded;
    const full = Math.floor(fte);
    const rem  = fte - full;
    return { full, half: rem >= 0.25 ? 1 : 0 };
  }

  // ── Auto planner ──────────────────────────────────────────────────────────
  function runAutoPlanner(overwrite: boolean = true) {
    const dates    = displayDates();
    const dClients = clients.filter(c => c.departmentId===activeDeptId);
    const dEmps    = employees.filter(e => e.departmentId===activeDeptId);
    const newSched = { ...schedule };
    const weekHoursTracker: Record<string, Record<string, number>> = {};

    dates.forEach(date => {
      if (isWeekend(date)) return;
      const ds      = fmtDate(date);
      const weekKey = getWeekKey(date);
      if (!weekHoursTracker[weekKey]) weekHoursTracker[weekKey] = {};
      const usedToday: string[] = [];

      dClients.forEach(client => {
        const csubs = subcats.filter(s => s.clientId===client.id);
        const slots = csubs.length
          ? csubs.map(s => [`${ds}-${s.id}`, s] as [string, Subcategory])
          : [[`${ds}-client-${client.id}`, null] as [string, null]];

        slots.forEach(([slotId, sub]) => {
          if (!overwrite && newSched[slotId]?.rows?.length) return;
          const candidates = dEmps.filter(e => {
            if (!isAvail(e, date)) return false;
            if (usedToday.includes(e.id)) return false;
            if (sub && !e.subCatIds.includes(sub.id)) return false;
            const alreadyPlanned = (weekHoursTracker[weekKey][e.id] || 0) + geplandUrenDezeWeek(e.id, date);
            if (alreadyPlanned >= e.hoursPerWeek) return false;
            return true;
          }).sort((a,b) => {
            const as_ = sub ? calcScore(a,sub) : 0;
            const bs_ = sub ? calcScore(b,sub) : 0;
            return (bs_+(b.mainClientId===client.id?1000:0)) - (as_+(a.mainClientId===client.id?1000:0));
          });

          if (candidates[0]) {
            const emp = candidates[0];
            usedToday.push(emp.id);
            const chosenShift = (emp.defaultShiftId ? getShift(emp.defaultShiftId) : undefined) || shiftDefs[1] || shiftDefs[0];
            weekHoursTracker[weekKey][emp.id] = (weekHoursTracker[weekKey][emp.id]||0) + nettoUrenEmp(emp, chosenShift?.hours||[]);
            newSched[slotId] = { rows:[{ employeeId:emp.id, shiftId:chosenShift?.id||"", selectedHours:chosenShift?.hours||defaultHours(emp) }] };
          }
        });
      });
    });
    setSchedule(newSched);
    Object.entries(newSched).forEach(([sid,e]) => syncCell(sid,e));
  }

  // ── Print ─────────────────────────────────────────────────────────────────
  function handlePrint() {
    const style = document.createElement("style");
    style.innerHTML = buildPrintCSS(printSize);
    document.head.appendChild(style);
    window.print();
    setTimeout(() => document.head.removeChild(style), 1500);
  }

  const deptClients   = clients.filter(c => c.departmentId===activeDeptId);
  const deptEmployees = employees.filter(e => e.departmentId===activeDeptId);
  const activeDept    = depts.find(d => d.id===activeDeptId);

  // ── Vakantie modal vacCells ───────────────────────────────────────────────
  function vacCells(): (Date|null)[] {
    const dates  = datesInMonth(vacModalMonth, vacModalYear);
    const offset = (() => { const fd=new Date(vacModalYear,vacModalMonth,1).getDay(); return fd===0?6:fd-1; })();
    const cells: (Date|null)[] = Array(offset).fill(null).concat(dates);
    while (cells.length%7!==0) cells.push(null);
    return cells;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PLANNING CEL — buiten render van TabPlanning om focus-verlies te voorkomen
  // ═══════════════════════════════════════════════════════════════════════════
  const PlanningCell = useMemo(() => {
    return React.memo(function PlanningCell({ slotId, date, avail }: { slotId:string; date:Date; avail:Employee[] }) {
      const entry = schedule[slotId] || { rows:[] };
      const dEmpsRef = employees;

      function availForRow(rowIdx: number): Employee[] {
        const usedIds = entry.rows.filter((_,i) => i!==rowIdx).map(r => r.employeeId).filter(Boolean);
        return avail.filter(e => !usedIds.includes(e.id));
      }
      function isOverLimit(emp: Employee, d: Date): boolean {
        return geplandUrenDezeWeek(emp.id, d) >= emp.hoursPerWeek;
      }
      function addRow() {
        if (entry.rows.length >= 3) return;
        const used  = entry.rows.map(r => r.employeeId);
        const next  = avail.find(e => !used.includes(e.id));
        const sh    = (next?.defaultShiftId ? getShift(next.defaultShiftId) : undefined) || shiftDefs[1] || shiftDefs[0];
        const newRow: SlotRow = { employeeId:next?.id||"", shiftId:sh?.id||"", selectedHours:next?(sh?.hours||defaultHours(next)):[] };
        updSchedule(slotId, {rows:[...entry.rows, newRow]});
      }
      function removeRow(i: number) { updSchedule(slotId, {rows:entry.rows.filter((_,ri) => ri!==i)}); }
      function setEmp(i: number, empId: string) {
        const emp = dEmpsRef.find(e => e.id===empId);
        const sh  = (emp?.defaultShiftId ? getShift(emp.defaultShiftId) : undefined) || shiftDefs[1] || shiftDefs[0];
        const rows = [...entry.rows];
        rows[i] = { employeeId:empId, shiftId:sh?.id||"", selectedHours:emp?(sh?.hours||defaultHours(emp)):[] };
        updSchedule(slotId, {rows});
      }
      function applyShift(i: number, shiftId: string) {
        if (shiftId==="custom") { setCustomShiftSlot({slotId, rowIdx:i}); return; }
        const sh   = getShift(shiftId);
        const rows = [...entry.rows];
        rows[i]    = {...rows[i], shiftId, selectedHours:sh?sh.hours:rows[i].selectedHours};
        updSchedule(slotId, {rows});
      }
      function toggleHour(i: number, h: number) {
        const rows = [...entry.rows]; const hrs = rows[i].selectedHours;
        rows[i] = {...rows[i], shiftId:"custom", selectedHours:hrs.includes(h)?hrs.filter(x=>x!==h):[...hrs,h].sort((a,b)=>a-b)};
        updSchedule(slotId, {rows});
      }

      return (
        <td style={{ padding:"3px", verticalAlign:"top", minWidth:"175px", borderBottom:"1px solid #1e293b" }}>
          {entry.rows.map((row,ri) => {
            const emp       = dEmpsRef.find(e => e.id===row.employeeId);
            const empColor  = emp?.color || (ri===0 ? "#3B82F6" : "#7C3AED");
            const textCol   = emp ? contrastColor(empColor) : "white";
            const overLimit = emp ? isOverLimit(emp, date) : false;
            const netto     = emp ? nettoUrenEmp(emp, row.selectedHours) : nettoUren(row.selectedHours);
            const bruto     = row.selectedHours?.length || 0;
            const breakMins = emp ? calcBreakMinutesForHours(emp.breaks, row.selectedHours) : (bruto>=9?60:0);
            return (
              <div key={ri} style={{ marginBottom:ri<entry.rows.length-1?"4px":0, borderBottom:ri<entry.rows.length-1?"1px dashed #1e293b":"none", paddingBottom:ri<entry.rows.length-1?"4px":0 }}>
                <div style={{ display:"flex", gap:"2px", marginBottom:"2px" }}>
                  <select value={row.employeeId} onChange={e => setEmp(ri, e.target.value)}
                    style={{ flex:1, padding:"4px 3px", borderRadius:"4px", background:row.employeeId?empColor:"#0f172a", color:row.employeeId?textCol:"white", border:overLimit?"2px solid #EF4444":"1px solid #1e293b", fontSize:"11px", cursor:"pointer", fontWeight:row.employeeId?"700":"400" }}>
                    <option value="">—</option>
                    {availForRow(ri).map(e => {
                      const ol = isOverLimit(e, date);
                      return <option key={e.id} value={e.id} style={{ color:ol?"#EF4444":"white", background:"#1e293b" }}>{e.name}{ol?" ⚠":""}</option>;
                    })}
                  </select>
                  <button onClick={() => removeRow(ri)} style={{ background:"#1e293b", border:"none", color:"#475569", borderRadius:"3px", width:"18px", cursor:"pointer", fontSize:"10px" }}>✕</button>
                </div>
                {overLimit && row.employeeId && (
                  <div style={{ fontSize:"9px", color:"#EF4444", marginBottom:"2px", display:"flex", alignItems:"center", gap:"3px" }}>
                    <AlertTriangle size={9}/> Weekuren overschreden
                  </div>
                )}
                {row.employeeId && (
                  <div style={{ display:"flex", gap:"2px", marginBottom:"2px" }}>
                    {shiftDefs.map(sh => (
                      <button key={sh.id} onClick={() => applyShift(ri, sh.id)}
                        style={{ flex:1, padding:"2px 0", fontSize:"8px", border:"none", borderRadius:"3px", cursor:"pointer", background:row.shiftId===sh.id?"#F59E0B":"#1e293b", color:row.shiftId===sh.id?"#000":"#64748B", fontWeight:row.shiftId===sh.id?"bold":"normal" }}>
                        {sh.label}
                      </button>
                    ))}
                    <button onClick={() => applyShift(ri,"custom")}
                      style={{ flex:1, padding:"2px 0", fontSize:"8px", border:"none", borderRadius:"3px", cursor:"pointer", background:row.shiftId==="custom"?"#F59E0B":"#1e293b", color:row.shiftId==="custom"?"#000":"#64748B" }}>✏️</button>
                  </div>
                )}
                {/* Uurblokjes - handmatig aan/uitklikbaar */}
                <div style={{ display:"flex", gap:"1px", opacity:row.employeeId?1:0.25 }}>
                  {WORK_HOURS.map(h => {
                    const on        = row.selectedHours?.includes(h);
                    const isBreakH  = emp ? emp.breaks.some(b => {
                      const bStart = b.startHour + b.startMin/60;
                      const bEnd   = b.endHour   + b.endMin/60;
                      return h >= bStart && h < bEnd;
                    }) : false;
                    return (
                      <div key={h} onClick={() => row.employeeId && toggleHour(ri, h)}
                        title={`${String(h).padStart(2,"0")}:00${isBreakH?" (pauze)":""}`}
                        style={{ flex:1, height:"11px", borderRadius:"1px", cursor:row.employeeId?"pointer":"default",
                          background: on
                            ? (isBreakH ? "repeating-linear-gradient(45deg,"+empColor+" 0,"+empColor+" 2px,#0f172a 2px,#0f172a 4px)" : empColor)
                            : "#1e293b"
                        }}/>
                    );
                  })}
                </div>
                {row.employeeId && (
                  <div style={{ fontSize:"9px", textAlign:"right", color:"#475569", marginTop:"1px" }}>
                    {netto.toFixed(1)}u netto
                    {breakMins > 0 && <span style={{ color:"#F59E0B" }}> (−{breakMins}min pauze)</span>}
                  </div>
                )}
              </div>
            );
          })}
          {entry.rows.length < 3 && (
            <button onClick={addRow} style={{ width:"100%", marginTop:"3px", padding:"2px", background:"none", border:"1px dashed #1e293b", color:"#475569", borderRadius:"3px", fontSize:"9px", cursor:"pointer" }}>
              + persoon
            </button>
          )}
        </td>
      );
    });
  }, [schedule, employees, shiftDefs, deptEmployees]);

  // ── Vakantie Modal ────────────────────────────────────────────────────────
  const VacationModal = () => {
    const emp = employees.find(e => e.id===vacModal);
    if (!emp) return null;
    const cells = vacCells();
    function toggleOff(day: string) {
      const has = emp.standardOffDays.includes(day);
      updEmployee({...emp, standardOffDays:has?emp.standardOffDays.filter(d=>d!==day):[...emp.standardOffDays,day]});
    }
    function toggleVac(ds: string) {
      const has = emp.vacationDates.includes(ds);
      updEmployee({...emp, vacationDates:has?emp.vacationDates.filter(d=>d!==ds):[...emp.vacationDates,ds]});
    }
    return (
      <Modal title={`🌴 Vakantie & Vrije Dagen — ${emp.name}`} onClose={() => setVacModal(null)} width="560px">
        <div style={{ marginBottom:"16px", background:"#1e293b", borderRadius:"10px", padding:"14px" }}>
          <div style={{ fontSize:"11px", color:"#F59E0B", fontWeight:"bold", marginBottom:"8px" }}>VASTE VRIJE DAGEN (WEKELIJKS)</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
            {DAY_LABELS.map(day => {
              const isOff = emp.standardOffDays.includes(day);
              return <button key={day} onClick={() => toggleOff(day)}
                style={{ padding:"5px 12px", borderRadius:"20px", border:"none", fontSize:"12px", cursor:"pointer", background:isOff?"#EF4444":"#334155", color:isOff?"white":"#94A3B8", fontWeight:isOff?"bold":"normal" }}>
                {day.slice(0,2)}</button>;
            })}
          </div>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"10px" }}>
          <button onClick={() => { if(vacModalMonth===0){setVacModalMonth(11);setVacModalYear(y=>y-1);}else setVacModalMonth(m=>m-1); }}
            style={{ background:"#1e293b", border:"none", color:"white", borderRadius:"6px", padding:"5px 14px", cursor:"pointer" }}>‹</button>
          <span style={{ fontWeight:"bold", color:"white" }}>{MONTH_LABELS[vacModalMonth]} {vacModalYear}</span>
          <button onClick={() => { if(vacModalMonth===11){setVacModalMonth(0);setVacModalYear(y=>y+1);}else setVacModalMonth(m=>m+1); }}
            style={{ background:"#1e293b", border:"none", color:"white", borderRadius:"6px", padding:"5px 14px", cursor:"pointer" }}>›</button>
        </div>
        <div style={{ background:"#1e293b", borderRadius:"10px", padding:"12px" }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:"4px", marginBottom:"6px" }}>
            {["Ma","Di","Wo","Do","Vr","Za","Zo"].map(d => <div key={d} style={{ textAlign:"center", fontSize:"10px", color:"#64748B", fontWeight:"bold", padding:"4px 0" }}>{d}</div>)}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:"4px" }}>
            {cells.map((date,i) => {
              if (!date) return <div key={i}/>;
              const ds = fmtDate(date); const dl = dayLabel(date);
              const isStd = emp.standardOffDays.includes(dl);
              const isVac = emp.vacationDates.includes(ds);
              let bg="#1e293b", col="#94A3B8", lbl="";
              if (isStd) { bg="#7C3AED22"; col="#7C3AED"; lbl="V"; }
              if (isVac) { bg="#F59E0B";   col="white";   lbl="🌴"; }
              return <div key={ds} onClick={() => !isStd && toggleVac(ds)}
                style={{ textAlign:"center", padding:"6px 2px", borderRadius:"6px", fontSize:"12px", cursor:isStd?"not-allowed":"pointer", background:bg, color:col, fontWeight:isVac?"bold":"normal", userSelect:"none" }}>
                <div>{date.getDate()}</div>
                {lbl && <div style={{ fontSize:"9px" }}>{lbl}</div>}
              </div>;
            })}
          </div>
        </div>
        <div style={{ display:"flex", gap:"16px", marginTop:"12px", fontSize:"10px", color:"#64748B" }}>
          <span><span style={{ color:"#7C3AED" }}>■</span> Vaste vrije dag</span>
          <span><span style={{ color:"#F59E0B" }}>■</span> Vakantie</span>
          <span style={{ marginLeft:"auto" }}>Totaal: <strong style={{ color:"white" }}>{emp.vacationDates.length} dagen</strong></span>
        </div>
      </Modal>
    );
  };

  // ── Custom Shift Modal ────────────────────────────────────────────────────
  const CustomShiftModal = () => {
    if (!customShiftSlot) return null;
    const {slotId, rowIdx} = customShiftSlot;
    function apply() {
      const hours: number[] = [];
      for (let h=customStart; h<customEnd; h++) if (WORK_HOURS.includes(h)) hours.push(h);
      const entry = schedule[slotId]||{rows:[]};
      const rows  = [...entry.rows];
      if (rows[rowIdx]) rows[rowIdx] = {...rows[rowIdx], shiftId:"custom", selectedHours:hours};
      updSchedule(slotId, {rows}); setCustomShiftSlot(null);
    }
    const bruto = customEnd - customStart;
    const netto = bruto >= 9 ? bruto - 1 : bruto;
    return (
      <Modal title="✏️ Custom Shift" onClose={() => setCustomShiftSlot(null)} width="300px">
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px", marginBottom:"16px" }}>
          <div>
            <label style={{ fontSize:"11px", color:"#64748B", display:"block", marginBottom:"4px" }}>BEGINTIJD</label>
            <select value={customStart} onChange={e => setCustomStart(Number(e.target.value))}
              style={{ width:"100%", background:"#1e293b", color:"white", border:"1px solid #334155", borderRadius:"6px", padding:"8px" }}>
              {WORK_HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize:"11px", color:"#64748B", display:"block", marginBottom:"4px" }}>EINDTIJD</label>
            <select value={customEnd} onChange={e => setCustomEnd(Number(e.target.value))}
              style={{ width:"100%", background:"#1e293b", color:"white", border:"1px solid #334155", borderRadius:"6px", padding:"8px" }}>
              {WORK_HOURS.filter(h => h>customStart).map(h => <option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}
            </select>
          </div>
        </div>
        <div style={{ background:"#1e293b", borderRadius:"6px", padding:"10px", marginBottom:"16px", fontSize:"11px", color:"#64748B", fontFamily:"monospace" }}>
          {bruto >= 9
            ? <>{bruto} uur − 1u pauze = <span style={{ color:"#10B981" }}>{netto}u netto</span></>
            : <span style={{ color:"#10B981" }}>{netto}u (geen pauze)</span>
          }
        </div>
        <div style={{ display:"flex", gap:"8px" }}>
          <button onClick={() => setCustomShiftSlot(null)} style={{ flex:1, padding:"9px", background:"#1e293b", border:"none", color:"white", borderRadius:"8px", cursor:"pointer" }}>Annuleer</button>
          <button onClick={apply} style={{ flex:1, padding:"9px", background:"#F59E0B", border:"none", color:"black", borderRadius:"8px", cursor:"pointer", fontWeight:"bold" }}>✓ Toepassen</button>
        </div>
      </Modal>
    );
  };

  // ── Print Modal ───────────────────────────────────────────────────────────
  const PrintModal = () => (
    <Modal title="🖨️ Planning Printen" onClose={() => setShowPrintModal(false)} width="360px">
      <div style={{ display:"flex", gap:"10px", marginBottom:"20px" }}>
        {(["A4","A3"] as const).map(sz => (
          <button key={sz} onClick={() => setPrintSize(sz)}
            style={{ flex:1, padding:"12px", border:"2px solid", borderColor:printSize===sz?"#3B82F6":"#334155", background:printSize===sz?"#1d4ed8":"#0f172a", color:"white", borderRadius:"8px", cursor:"pointer", fontWeight:"bold" }}>
            {sz}
          </button>
        ))}
      </div>
      <div style={{ display:"flex", gap:"10px" }}>
        <button onClick={() => setShowPrintModal(false)} style={{ flex:1, padding:"10px", background:"#1e293b", border:"none", color:"white", borderRadius:"8px", cursor:"pointer" }}>Annuleer</button>
        <button onClick={() => { setShowPrintModal(false); setTimeout(handlePrint,150); }}
          style={{ flex:1, padding:"10px", background:"#3B82F6", border:"none", color:"white", borderRadius:"8px", cursor:"pointer", fontWeight:"bold" }}>
          🖨️ Print {printSize}
        </button>
      </div>
    </Modal>
  );

  // ── Print View ────────────────────────────────────────────────────────────
  function PrintView() {
    const allDates = displayDates();
    const weeks    = viewType==="maand" ? groupByWeek(allDates) : [allDates];
    const allUsedHours = WORK_HOURS.filter(h =>
      allDates.some(date => {
        const ds = fmtDate(date);
        return Object.entries(schedule).some(([slotId, entry]) =>
          slotId.startsWith(ds) && entry.rows?.some(r => r.selectedHours?.includes(h))
        );
      })
    );
    const timelineHours = allUsedHours.length > 0 ? allUsedHours : [7,8,9,10,11,12,13,14,15,16,17];

    return (
      <div className="print-wrap" style={{ display:"none" }}>
        {weeks.map((weekDates,wi) => (
          <div key={wi} className="pw-page">
            <div className="pw-header">
              <div>
                <div className="pw-title">{activeDept?.name} — Planning {MONTH_LABELS[viewMonth]} {viewYear}</div>
                <div className="pw-sub">
                  Week {weekNum(weekDates[0])} · {weekDates[0].toLocaleDateString("nl-NL",{day:"numeric",month:"short"})} – {weekDates[weekDates.length-1].toLocaleDateString("nl-NL",{day:"numeric",month:"short",year:"numeric"})}
                </div>
              </div>
              <div className="pw-meta">
                <div>Gedrukt: {new Date().toLocaleDateString("nl-NL")}</div>
                <div>{activeDept?.name} · {deptEmployees.length} mw</div>
              </div>
            </div>
            {weekDates.map(date => {
              const ds   = fmtDate(date);
              const isWE = isWeekend(date);
              const dayEntries: any[] = [];
              deptClients.forEach(client => {
                const csubs = subcats.filter(s => s.clientId===client.id);
                (csubs.length ? csubs : [{id:`client-${client.id}`,clientId:client.id,name:"Algemeen",targetSkills:[],requireBreakCover:false}]).forEach(sub => {
                  const entry = schedule[`${ds}-${sub.id}`];
                  if (entry?.rows?.length) dayEntries.push({sub, client, rows:entry.rows});
                });
              });
              if (!dayEntries.length) return null;
              return (
                <div key={ds} style={{ marginBottom:"8px" }}>
                  <div style={{ background:"#1e293b", color:isWE?"#fca5a5":"#f8fafc", padding:"3px 6px", fontSize:"7pt", fontWeight:"700", marginBottom:"2px" }}>
                    {dayLabel(date)} {date.getDate()}/{date.getMonth()+1}/{date.getFullYear()}
                  </div>
                  <table className="pw-tbl" style={{ tableLayout:"fixed" }}>
                    <thead>
                      <tr>
                        <th style={{ width:"100px", textAlign:"left", padding:"2px 4px" }}>Klant / Taak</th>
                        {timelineHours.map(h => (
                          <th key={h} style={{ width:"24px", fontSize:"5pt", padding:"2px 0" }}>{String(h).padStart(2,"0")}</th>
                        ))}
                        <th style={{ width:"40px", fontSize:"5pt" }}>Uren</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayEntries.map(({sub, client, rows}: any) => rows.map((row: SlotRow, ri: number) => {
                        const emp      = employees.find(e => e.id===row.employeeId);
                        if (!emp) return null;
                        const netto    = nettoUrenEmp(emp, row.selectedHours);
                        const empColor = emp.color || EMPLOYEE_COLORS[0];
                        const textCol  = contrastColor(empColor);
                        return (
                          <tr key={`${sub.id}-${ri}`} className="sub-row">
                            <td style={{ padding:"2px 4px", fontSize:"5pt" }}>
                              <div style={{ fontWeight:"700", fontSize:"5pt" }}>{client.name}</div>
                              <div style={{ color:"#64748b", fontSize:"4.5pt" }}>↳ {sub.name}</div>
                              <div style={{ color:empColor, fontSize:"5pt", fontWeight:"700" }}>{emp.name}</div>
                            </td>
                            {timelineHours.map(h => {
                              const isActive  = row.selectedHours?.includes(h);
                              const isBreakH  = emp.breaks.some(b => h >= b.startHour + b.startMin/60 && h < b.endHour + b.endMin/60);
                              return (
                                <td key={h} style={{ padding:"1px", height:"18px" }}>
                                  {isActive && (
                                    <div className={isBreakH ? "pw-break-block" : "pw-emp-block"}
                                      style={{ background:isBreakH?"":empColor, height:"100%", minHeight:"16px", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"4pt", color:isBreakH?"#475569":textCol, WebkitPrintColorAdjust:"exact", printColorAdjust:"exact" }}>
                                      {!isBreakH && ri===0 && row.selectedHours?.indexOf(h)===Math.floor(row.selectedHours.length/2) ? emp.name.split(" ")[0] : ""}
                                      {isBreakH ? "☕" : ""}
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                            <td style={{ padding:"2px", textAlign:"center" }}>
                              <div style={{ fontSize:"5pt", fontWeight:"700", background:empColor, color:textCol, borderRadius:"2px", padding:"1px 3px", WebkitPrintColorAdjust:"exact", printColorAdjust:"exact" }}>
                                {netto.toFixed(1)}u
                              </div>
                            </td>
                          </tr>
                        );
                      }))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // TAB: PLANNING
  // ═════════════════════════════════════════════════════════════════════════
  function TabPlanning() {
    const dates   = displayDates();
    const wkNums  = [...new Set(dates.map(d => weekNum(d)))];
    const allWeekNums = Array.from({length:53}, (_,i) => i+1);

    return (
      <div style={{ background:"rgba(255,255,255,0.01)", borderRadius:"12px", overflowX:"auto", padding:"16px" }}>
        {/* Navigatiebalk */}
        <div style={{ display:"flex", gap:"10px", alignItems:"center", flexWrap:"wrap", marginBottom:"14px" }}>
          <button onClick={prevPeriod} style={{ background:"#1e293b",border:"none",color:"white",borderRadius:"8px",padding:"7px 12px",cursor:"pointer",display:"flex",alignItems:"center" }}><ChevronLeft size={16}/></button>
          <div style={{ fontWeight:"700",color:"white",minWidth:"200px",textAlign:"center",fontSize:"14px" }}>
            {viewType==="week"
              ? `Week ${weekNum(weekStart)} · ${weekStart.toLocaleDateString("nl-NL",{day:"numeric",month:"short"})} – ${new Date(weekStart.getTime()+6*86400000).toLocaleDateString("nl-NL",{day:"numeric",month:"short",year:"numeric"})}`
              : `${MONTH_LABELS[viewMonth]} ${viewYear}`
            }
          </div>
          <button onClick={nextPeriod} style={{ background:"#1e293b",border:"none",color:"white",borderRadius:"8px",padding:"7px 12px",cursor:"pointer",display:"flex",alignItems:"center" }}><ChevronRight size={16}/></button>

          {/* Week selector */}
          {viewType==="week" && (
            <select value={weekNum(weekStart)} onChange={e => goToWeek(Number(e.target.value))}
              style={{ background:"#1e293b",color:"white",padding:"7px 10px",borderRadius:"8px",border:"none",fontSize:"12px" }}>
              {allWeekNums.map(wn => <option key={wn} value={wn}>Week {wn}</option>)}
            </select>
          )}

          {viewType==="maand" && (
            <>
              <select value={viewYear} onChange={e => setViewYear(Number(e.target.value))} style={{ background:"#1e293b",color:"white",padding:"7px 10px",borderRadius:"8px",border:"none" }}>
                {[2024,2025,2026,2027,2028,2029].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <select value={viewMonth} onChange={e => setViewMonth(Number(e.target.value))} style={{ background:"#1e293b",color:"white",padding:"7px 10px",borderRadius:"8px",border:"none" }}>
                {MONTH_LABELS.map((m,i) => <option key={m} value={i}>{m}</option>)}
              </select>
            </>
          )}

          <div style={{ background:"#1e293b",padding:"3px",borderRadius:"8px",display:"flex" }}>
            <button onClick={() => { setViewType("week"); setWeekStart(startOfWeek(today)); }}
              style={{ background:viewType==="week"?"#3B82F6":"transparent",border:"none",color:"white",padding:"5px 14px",borderRadius:"6px",cursor:"pointer",fontWeight:viewType==="week"?"700":"400" }}>Week</button>
            <button onClick={() => setViewType("maand")}
              style={{ background:viewType==="maand"?"#3B82F6":"transparent",border:"none",color:"white",padding:"5px 14px",borderRadius:"6px",cursor:"pointer",fontWeight:viewType==="maand"?"700":"400" }}>Maand</button>
          </div>

          {/* Medewerker legenda */}
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:"6px", fontSize:"10px", color:"#475569", flexWrap:"wrap" }}>
            {deptEmployees.slice(0,10).map(e => (
              <span key={e.id} style={{ display:"flex", alignItems:"center", gap:"3px" }}>
                <span style={{ width:"8px",height:"8px",borderRadius:"50%",background:e.color,display:"inline-block" }}/>
                <span style={{ fontSize:"9px" }}>{e.name.split(" ")[0]}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Gaten / onderbezetting waarschuwingen */}
        {useFTE && deptClients.some(c => c.useFTE && fteForClient(c.id) < c.fteNeeded) && (
          <div style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.25)", borderRadius:"8px", padding:"8px 14px", marginBottom:"12px", fontSize:"11px", color:"#FCA5A5", display:"flex", alignItems:"center", gap:"8px", flexWrap:"wrap" }}>
            <AlertTriangle size={13} color="#EF4444"/>
            <strong>Onderbezetting gedetecteerd:</strong>
            {deptClients.filter(c => c.useFTE && fteForClient(c.id) < c.fteNeeded).map(c => (
              <span key={c.id} style={{ background:"rgba(239,68,68,0.15)", padding:"2px 8px", borderRadius:"10px" }}>
                {c.name}: {fteForClient(c.id).toFixed(2)} / {c.fteNeeded} FTE
              </span>
            ))}
          </div>
        )}

        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign:"left",padding:"8px 10px",color:"#475569",minWidth:"180px",position:"sticky",left:0,background:"#020617",zIndex:2,fontSize:"11px",fontWeight:"700",letterSpacing:"0.06em" }}>KLANT / TAAK</th>
              {dates.map(date => {
                const dl   = dayLabel(date);
                const isWE = isWeekend(date);
                return (
                  <th key={fmtDate(date)} style={{ padding:"6px 3px",fontSize:"10px",minWidth:"175px",color:isWE?"#EF4444":"#64748B" }}>
                    <div style={{ fontSize:"8px",color:"#334155" }}>Wk {weekNum(date)}</div>
                    <div style={{ fontWeight:"700" }}>{dl.slice(0,2)} {date.getDate()}</div>
                    <div style={{ fontSize:"8px" }}>{MONTH_LABELS[date.getMonth()].slice(0,3)}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {deptClients.length===0 && (
              <tr><td colSpan={dates.length+1} style={{ padding:"40px",textAlign:"center",color:"#334155" }}>
                Geen klanten in {activeDept?.name}. Voeg klanten toe via Klanten & Shifts.
              </td></tr>
            )}
            {deptClients.map(client => {
              const csubs   = subcats.filter(s => s.clientId===client.id);
              const fte     = fteForClient(client.id);
              const fteDiff = fte - client.fteNeeded;
              return (
                <React.Fragment key={client.id}>
                  <tr style={{ background:"#0f172a" }}>
                    <td colSpan={dates.length+1} style={{ padding:"8px 14px",color:"#38BDF8",fontWeight:"700",borderTop:"1px solid #1e293b" }}>
                      <div style={{ display:"flex",alignItems:"center",gap:"12px",flexWrap:"wrap" }}>
                        <span style={{ fontSize:"14px" }}>{client.name}</span>
                        {/* FTE toggle per klant */}
                        <div style={{ display:"flex",alignItems:"center",gap:"5px",fontSize:"10px",color:"#475569" }}>
                          <span>FTE</span>
                          <button onClick={() => {
                            const upd = {...client, useFTE:!client.useFTE};
                            setClients(prev => prev.map(c => c.id===client.id ? upd : c));
                            syncClient(upd);
                          }} style={{ background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center" }}>
                            {client.useFTE ? <ToggleRight size={18} color="#10B981"/> : <ToggleLeft size={18} color="#334155"/>}
                          </button>
                        </div>
                        {client.useFTE && (
                          <div style={{ display:"flex",alignItems:"center",gap:"8px",fontSize:"11px" }}>
                            <span style={{ color:"#475569" }}>Doel:
                              <input type="number" step="0.5" min="0.5" value={client.fteNeeded}
                                onChange={e => {
                                  const upd = {...client, fteNeeded:parseFloat(e.target.value)||0};
                                  setClients(prev => prev.map(c => c.id===client.id ? upd : c));
                                  syncClient(upd);
                                }}
                                style={{ width:"45px",background:"#1e293b",color:"white",border:"1px solid #334155",borderRadius:"4px",padding:"1px 4px",marginLeft:"4px" }}/>
                              <span style={{ marginLeft:"3px" }}>FTE</span>
                            </span>
                            <span style={{ color:"#64748B" }}>Ingepland: <strong style={{ color:"white" }}>{fte.toFixed(2)} FTE</strong></span>
                            <span style={{ padding:"2px 8px",borderRadius:"10px",fontSize:"10px",fontWeight:"700",background:fteDiff>=0?"rgba(16,185,129,0.15)":"rgba(239,68,68,0.15)",color:fteDiff>=0?"#10B981":"#EF4444" }}>
                              {fteDiff>=0?"+":""}{fteDiff.toFixed(2)} FTE
                            </span>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                  {(csubs.length?csubs:[{id:`client-${client.id}`,clientId:client.id,name:"Algemeen",targetSkills:[],requireBreakCover:false}]).map(sub => (
                    <tr key={sub.id}>
                      <td style={{ padding:"8px 12px 8px 26px",fontSize:"12px",color:"#64748B",position:"sticky",left:0,background:"#020617",verticalAlign:"top",borderBottom:"1px solid #0a0f1a" }}>
                        <div style={{ display:"flex",alignItems:"center",gap:"6px",flexWrap:"wrap" }}>
                          <span>↳ {sub.name}</span>
                          {(sub as Subcategory).requireBreakCover && (
                            <span title="Pauzes moeten overgenomen worden" style={{ fontSize:"9px",background:"rgba(245,158,11,0.15)",color:"#F59E0B",padding:"1px 5px",borderRadius:"8px",border:"1px solid rgba(245,158,11,0.3)" }}>
                              ☕ cover
                            </span>
                          )}
                        </div>
                        {(sub as any).targetSkills?.length>0 && (
                          <div style={{ fontSize:"9px",color:"#334155",marginTop:"2px" }}>
                            {(sub as any).targetSkills.map((sid: string) => skills.find(s => s.id===sid)?.name).filter(Boolean).join(", ")}
                          </div>
                        )}
                      </td>
                      {dates.map(date => {
                        const slotId = `${fmtDate(date)}-${sub.id}`;
                        const avail  = deptEmployees.filter(e => isAvail(e,date)&&((sub as any).targetSkills?.length===0||e.subCatIds.includes(sub.id)));
                        return <PlanningCell key={fmtDate(date)} slotId={slotId} date={date} avail={avail}/>;
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // TAB: MEDEWERKERS
  // ═════════════════════════════════════════════════════════════════════════
  // Pauze Modal (apart component buiten render)
  const BreakModal = React.memo(function BreakModal({ empId, onClose }: { empId: string; onClose: () => void }) {
    const emp = employees.find(e => e.id===empId);
    if (!emp) return null;
    const [breaks, setBreaks] = useState<BreakSlot[]>(emp.breaks||[]);

    function addBreak() {
      setBreaks(prev => [...prev, { id:"br"+Date.now(), startHour:12, startMin:0, endHour:12, endMin:30, label:"Pauze" }]);
    }
    function updateBreak(id: string, field: keyof BreakSlot, val: any) {
      setBreaks(prev => prev.map(b => b.id===id ? {...b,[field]:val} : b));
    }
    function removeBreak(id: string) { setBreaks(prev => prev.filter(b => b.id!==id)); }
    function save() {
      updEmployee({...emp, breaks});
      onClose();
    }

    const MINS = [0,5,10,15,20,25,30,45];

    return (
      <Modal title={`☕ Pauze Configuratie — ${emp.name}`} onClose={onClose} width="480px">
        <div style={{ marginBottom:"12px", fontSize:"11px", color:"#64748B", background:"#1e293b", borderRadius:"8px", padding:"10px" }}>
          Voer exacte pauzetijden in. Pauze-uren worden gearceerd weergegeven in de planning en afgetrokken van werkuren.
        </div>
        {breaks.map(b => (
          <div key={b.id} style={{ background:"#1e293b", borderRadius:"8px", padding:"12px", marginBottom:"8px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"8px" }}>
              <Coffee size={13} color="#F59E0B"/>
              <input value={b.label} onChange={e => updateBreak(b.id,"label",e.target.value)}
                style={{ flex:1, background:"#0f172a", color:"#F59E0B", border:"1px solid #334155", borderRadius:"4px", padding:"4px 8px", fontSize:"12px", fontWeight:"700" }}/>
              <button onClick={() => removeBreak(b.id)} style={{ background:"none",border:"none",color:"#EF4444",cursor:"pointer" }}><X size={14}/></button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr auto 1fr", gap:"8px", alignItems:"center" }}>
              <div>
                <label style={{ fontSize:"9px",color:"#64748B",display:"block",marginBottom:"3px",fontWeight:"700" }}>BEGINTIJD</label>
                <div style={{ display:"flex",gap:"4px" }}>
                  <select value={b.startHour} onChange={e => updateBreak(b.id,"startHour",Number(e.target.value))}
                    style={{ flex:1,background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:"4px",padding:"5px" }}>
                    {WORK_HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2,"0")}</option>)}
                  </select>
                  <select value={b.startMin} onChange={e => updateBreak(b.id,"startMin",Number(e.target.value))}
                    style={{ flex:1,background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:"4px",padding:"5px" }}>
                    {MINS.map(m => <option key={m} value={m}>{String(m).padStart(2,"0")}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ color:"#475569",paddingTop:"14px" }}>→</div>
              <div>
                <label style={{ fontSize:"9px",color:"#64748B",display:"block",marginBottom:"3px",fontWeight:"700" }}>EINDTIJD</label>
                <div style={{ display:"flex",gap:"4px" }}>
                  <select value={b.endHour} onChange={e => updateBreak(b.id,"endHour",Number(e.target.value))}
                    style={{ flex:1,background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:"4px",padding:"5px" }}>
                    {WORK_HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2,"0")}</option>)}
                  </select>
                  <select value={b.endMin} onChange={e => updateBreak(b.id,"endMin",Number(e.target.value))}
                    style={{ flex:1,background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:"4px",padding:"5px" }}>
                    {MINS.map(m => <option key={m} value={m}>{String(m).padStart(2,"0")}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div style={{ fontSize:"10px",color:"#64748B",marginTop:"6px",fontFamily:"monospace" }}>
              Duur: <span style={{ color:"#F59E0B" }}>
                {((b.endHour*60+b.endMin) - (b.startHour*60+b.startMin))} min
              </span>
              {" · "}
              {String(b.startHour).padStart(2,"0")}:{String(b.startMin).padStart(2,"0")} – {String(b.endHour).padStart(2,"0")}:{String(b.endMin).padStart(2,"0")}
            </div>
          </div>
        ))}
        <button onClick={addBreak}
          style={{ width:"100%", padding:"8px", background:"#1e293b", border:"1px dashed #475569", color:"#F59E0B", borderRadius:"8px", cursor:"pointer", marginBottom:"16px", display:"flex", alignItems:"center", justifyContent:"center", gap:"6px" }}>
          <Plus size={13}/> Pauze toevoegen
        </button>
        <div style={{ display:"flex",gap:"8px" }}>
          <button onClick={onClose} style={{ flex:1,padding:"10px",background:"#1e293b",border:"none",color:"white",borderRadius:"8px",cursor:"pointer" }}>Annuleer</button>
          <button onClick={save} style={{ flex:1,padding:"10px",background:"#10B981",border:"none",color:"white",borderRadius:"8px",cursor:"pointer",fontWeight:"700",display:"flex",alignItems:"center",justifyContent:"center",gap:"6px" }}>
            <Check size={14}/> Opslaan
          </button>
        </div>
      </Modal>
    );
  });

  const [breakModalEmpId, setBreakModalEmpId] = useState<string|null>(null);

  function TabMedewerkers() {
    async function addEmployee() {
      const colorIdx = employees.length % EMPLOYEE_COLORS.length;
      const newEmp: Employee = {
        id: "e" + Date.now(),
        name: "Nieuwe medewerker",
        departmentId: activeDeptId,
        hoursPerWeek: 40,
        mainClientId: "",
        subCatIds: [],
        subCatSkills: {},
        standardOffDays: ["Zaterdag","Zondag"],
        vacationDates: [],
        defaultShiftId: "",
        hourlyWage: 0,
        isAdmin: false,
        color: EMPLOYEE_COLORS[colorIdx],
        breaks: [],
      };
      const { data, error } = await sb.from("employees").insert({
        id: newEmp.id, name: newEmp.name, department_id: newEmp.departmentId,
        hours_per_week: newEmp.hoursPerWeek, main_client_id: null,
        sub_cat_ids: [], sub_cat_skills: {},
        standard_off_days: newEmp.standardOffDays, vacation_dates: [],
        default_shift_id: null, hourly_wage: 0, is_admin: false,
        color: newEmp.color, breaks: [], pause_config: [],
      }).select();
      if (error) { console.error("Medewerker aanmaken mislukt:", error.message); return; }
      setEmployees(prev => [...prev, newEmp]);
    }

    return (
      <div style={{ background:"#0f172a", borderRadius:"12px", padding:"20px", border:"1px solid #1e293b" }}>
        {breakModalEmpId && <BreakModal empId={breakModalEmpId} onClose={() => setBreakModalEmpId(null)}/>}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"20px" }}>
          <h3 style={{ margin:0, color:"white", fontWeight:"700" }}>Medewerkers — {activeDept?.name}</h3>
          <button onClick={addEmployee}
            style={{ background:"#3B82F6", border:"none", color:"white", padding:"8px 16px", borderRadius:"8px", cursor:"pointer", fontWeight:"700", display:"flex", alignItems:"center", gap:"6px" }}>
            <Plus size={14}/> Toevoegen
          </button>
        </div>
        {deptEmployees.length===0 && <div style={{ color:"#334155", textAlign:"center", padding:"40px" }}>Geen medewerkers. Klik op + Toevoegen.</div>}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(380px,1fr))", gap:"20px" }}>
          {deptEmployees.map(emp => {
            const gepland    = geplandUrenDezeWeek(emp.id, weekStart);
            const pct        = Math.min(100, Math.round(gepland/emp.hoursPerWeek*100));
            const over       = gepland > emp.hoursPerWeek;
            const totalBreak = emp.breaks.reduce((s,b) => s + ((b.endHour*60+b.endMin)-(b.startHour*60+b.startMin)), 0);
            return (
              <div key={emp.id} style={{ background:"#1e293b", borderRadius:"12px", padding:"18px", border:"1px solid #334155", borderTop:`3px solid ${emp.color}` }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"12px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:"10px", flex:1 }}>
                    <ColorPicker value={emp.color} onChange={c => updEmployee({...emp, color:c})}/>
                    <input value={emp.name} onChange={e => updEmployee({...emp, name:e.target.value})}
                      style={{ background:"none", border:"none", color:"white", fontSize:"16px", fontWeight:"700", flex:1, outline:"none" }}/>
                  </div>
                  <div style={{ display:"flex", gap:"6px" }}>
                    <button onClick={() => { setVacModalMonth(viewMonth); setVacModalYear(viewYear); setVacModal(emp.id); }}
                      style={{ background:"#F59E0B", color:"white", border:"none", padding:"5px 10px", borderRadius:"6px", fontSize:"11px", cursor:"pointer" }}>🌴</button>
                    <button onClick={async () => { if(window.confirm("Medewerker verwijderen?")) await deleteEmployee(emp.id); }}
                      style={{ background:"none", border:"none", color:"#EF4444", cursor:"pointer" }}><Trash2 size={16}/></button>
                  </div>
                </div>

                {/* Urenbalk */}
                <div style={{ background:"#0f172a", borderRadius:"6px", padding:"8px", marginBottom:"12px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:"10px", marginBottom:"4px" }}>
                    <span style={{ color:"#64748B" }}>Ingepland deze week</span>
                    <span style={{ color:over?"#EF4444":"#10B981", fontWeight:"700" }}>{gepland.toFixed(1)}u / {emp.hoursPerWeek}u</span>
                  </div>
                  <div style={{ height:"4px", background:"#334155", borderRadius:"2px", overflow:"hidden" }}>
                    <div style={{ width:`${pct}%`, height:"100%", background:over?"#EF4444":emp.color, transition:"width 0.3s" }}/>
                  </div>
                </div>

                {/* Velden */}
                <div style={{ display:"flex", gap:"10px", flexWrap:"wrap", marginBottom:"12px" }}>
                  {[
                    { label:"UREN/WEEK", content: <input type="number" min="1" max="80" value={emp.hoursPerWeek} onChange={e => updEmployee({...emp, hoursPerWeek:Number(e.target.value)})} style={{ width:"60px",background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:"4px",padding:"4px 5px" }}/> },
                    { label:"UURLOON (€)", content: <input type="number" step="0.01" min="0" value={emp.hourlyWage||0} onChange={e => updEmployee({...emp, hourlyWage:parseFloat(e.target.value)||0})} style={{ width:"70px",background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:"4px",padding:"4px 5px" }}/> },
                    { label:"HOOFD KLANT", content: <select value={emp.mainClientId} onChange={e => updEmployee({...emp, mainClientId:e.target.value})} style={{ background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:"4px",padding:"4px 6px" }}>
                      <option value="">Geen</option>{deptClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select> },
                    { label:"STANDAARD SHIFT", content: <select value={emp.defaultShiftId||""} onChange={e => updEmployee({...emp, defaultShiftId:e.target.value})} style={{ background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:"4px",padding:"4px 6px" }}>
                      <option value="">Geen</option>{shiftDefs.map(sh => <option key={sh.id} value={sh.id}>{sh.label}</option>)}
                    </select> },
                    { label:"AFDELING", content: <select value={emp.departmentId} onChange={e => updEmployee({...emp, departmentId:e.target.value})} style={{ background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:"4px",padding:"4px 6px" }}>
                      {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select> },
                    { label:"BEHEERDER", content: <button onClick={() => updEmployee({...emp, isAdmin:!emp.isAdmin})} style={{ background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center" }}>
                      {emp.isAdmin ? <ToggleRight size={24} color="#8B5CF6"/> : <ToggleLeft size={24} color="#475569"/>}
                    </button> },
                  ].map(({label,content}) => (
                    <div key={label}>
                      <label style={{ fontSize:"9px",color:"#64748B",display:"block",marginBottom:"3px",fontWeight:"700",letterSpacing:"0.06em" }}>{label}</label>
                      {content}
                    </div>
                  ))}
                </div>

                {/* Pauze sectie */}
                <div style={{ background:"#0f172a", borderRadius:"8px", padding:"10px", marginBottom:"12px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                      <Coffee size={12} color="#F59E0B"/>
                      <span style={{ fontSize:"9px", color:"#F59E0B", fontWeight:"700", letterSpacing:"0.06em" }}>PAUZE CONFIGURATIE</span>
                    </div>
                    <button onClick={() => setBreakModalEmpId(emp.id)}
                      style={{ background:"#F59E0B", border:"none", color:"black", padding:"3px 10px", borderRadius:"4px", fontSize:"9px", cursor:"pointer", fontWeight:"700", display:"flex", alignItems:"center", gap:"3px" }}>
                      <Edit2 size={9}/> Bewerken
                    </button>
                  </div>
                  {emp.breaks.length === 0 ? (
                    <div style={{ fontSize:"10px", color:"#334155", marginTop:"6px" }}>Geen pauzes. Standaard: 60 min bij ≥9u.</div>
                  ) : (
                    <div style={{ marginTop:"6px", display:"flex", flexWrap:"wrap", gap:"4px" }}>
                      {emp.breaks.map(b => (
                        <span key={b.id} style={{ background:"rgba(245,158,11,0.12)", color:"#F59E0B", border:"1px solid rgba(245,158,11,0.2)", borderRadius:"10px", padding:"2px 8px", fontSize:"10px" }}>
                          {String(b.startHour).padStart(2,"0")}:{String(b.startMin).padStart(2,"0")}–{String(b.endHour).padStart(2,"0")}:{String(b.endMin).padStart(2,"0")}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Vrije dagen */}
                <div style={{ background:"#0f172a", borderRadius:"6px", padding:"8px", marginBottom:"12px" }}>
                  <div style={{ fontSize:"9px", color:"#F59E0B", fontWeight:"700", marginBottom:"6px", letterSpacing:"0.06em" }}>VASTE VRIJE DAGEN</div>
                  <div style={{ display:"flex", gap:"4px", flexWrap:"wrap" }}>
                    {DAY_LABELS.map(day => {
                      const isOff = emp.standardOffDays.includes(day);
                      return <button key={day} onClick={() => updEmployee({...emp, standardOffDays:isOff?emp.standardOffDays.filter(d=>d!==day):[...emp.standardOffDays,day]})}
                        style={{ padding:"3px 8px", borderRadius:"12px", border:"none", fontSize:"10px", cursor:"pointer", background:isOff?"#EF4444":"#334155", color:isOff?"white":"#64748B" }}>
                        {day.slice(0,2)}</button>;
                    })}
                  </div>
                </div>

                {/* Subcategorieën */}
                <div style={{ borderTop:"1px solid #334155", paddingTop:"10px", marginBottom:"10px" }}>
                  <div style={{ fontSize:"9px", color:"#64748B", marginBottom:"6px", fontWeight:"700", letterSpacing:"0.06em" }}>TAKEN / SUBCATEGORIEËN</div>
                  {deptClients.map(client => {
                    const csubs = subcats.filter(s => s.clientId===client.id);
                    if (!csubs.length) return null;
                    return (
                      <div key={client.id} style={{ background:"#0f172a", borderRadius:"4px", padding:"6px", marginBottom:"4px" }}>
                        <div style={{ fontSize:"10px", fontWeight:"700", color:"#38BDF8", marginBottom:"4px" }}>{client.name}</div>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:"4px" }}>
                          {csubs.map(sub => {
                            const has = emp.subCatIds.includes(sub.id);
                            return <button key={sub.id} onClick={() => {
                              const newIds = has?emp.subCatIds.filter(id=>id!==sub.id):[...emp.subCatIds,sub.id];
                              const newMx  = {...emp.subCatSkills};
                              if (!has) { const ex=newMx[sub.id]||{}; const init:Record<string,number>={}; skills.forEach(s=>{init[s.id]=ex[s.id]??0;}); newMx[sub.id]=init; }
                              updEmployee({...emp, subCatIds:newIds, subCatSkills:newMx});
                            }} style={{ fontSize:"9px", padding:"3px 7px", borderRadius:"10px", border:"none", background:has?"#10B981":"#334155", color:"white", cursor:"pointer" }}>
                              {sub.name}
                            </button>;
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Skill matrix */}
                {emp.subCatIds.length>0 && (
                  <div style={{ borderTop:"1px solid #334155", paddingTop:"10px" }}>
                    <div style={{ fontSize:"9px", color:"#F59E0B", fontWeight:"700", marginBottom:"8px", letterSpacing:"0.06em" }}>SKILL MATRIX</div>
                    {emp.subCatIds.map(subId => {
                      const sub    = subcats.find(s => s.id===subId);
                      const client = sub ? clients.find(c => c.id===sub.clientId) : null;
                      if (!sub||!sub.targetSkills.length) return null;
                      return (
                        <div key={subId} style={{ background:"#0f172a", borderRadius:"6px", padding:"8px", marginBottom:"6px" }}>
                          <div style={{ fontSize:"11px", fontWeight:"700", color:"#38BDF8", marginBottom:"6px" }}>{client?.name} – {sub.name}</div>
                          {sub.targetSkills.map(skillId => {
                            const sk  = skills.find(s => s.id===skillId); if (!sk) return null;
                            const raw = emp.subCatSkills[subId]?.[skillId];
                            const val = typeof raw==="number"&&!isNaN(raw)?raw:0;
                            return (
                              <div key={skillId} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:"11px", marginBottom:"4px", background:"#1e293b", padding:"4px 7px", borderRadius:"4px" }}>
                                <span title={sk.criteria} style={{ cursor:"help", borderBottom:"1px dotted #475569" }}>{sk.name}</span>
                                <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                                  <div style={{ width:"55px", height:"4px", background:"#334155", borderRadius:"2px", overflow:"hidden" }}>
                                    <div style={{ width:`${val}%`, height:"100%", background:val>=80?"#10B981":val>=50?"#F59E0B":"#EF4444", transition:"width 0.3s" }}/>
                                  </div>
                                  <input type="number" value={val} min={0} max={100}
                                    onChange={e => {
                                      const v  = Math.min(100,Math.max(0,Number(e.target.value)));
                                      const nm = {...(emp.subCatSkills[subId]||{}),[skillId]:v};
                                      updEmployee({...emp, subCatSkills:{...emp.subCatSkills,[subId]:nm}});
                                    }}
                                    style={{ width:"40px", background:"transparent", color:"white", border:"1px solid #334155", borderRadius:"3px", padding:"2px", textAlign:"center", fontSize:"10px" }}/>
                                  <span style={{ color:"#64748B", fontSize:"10px" }}>%</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // TAB: BEHEER
  // ═════════════════════════════════════════════════════════════════════════
  function TabBeheer() {
    return (
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))", gap:"20px" }}>
        {/* Afdelingen */}
        <section style={{ background:"#0f172a", borderRadius:"12px", padding:"20px", border:"1px solid #1e293b" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"14px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"8px" }}><Building2 size={15} color="#3B82F6"/><h3 style={{ margin:0, color:"white", fontSize:"14px", fontWeight:"700" }}>Afdelingen</h3></div>
            <button onClick={async () => {
              const n=prompt("Naam nieuwe afdeling?"); if(!n) return;
              const nd = {id:"d"+Date.now(), name:n};
              const {error} = await sb.from("departments").insert({id:nd.id, name:nd.name});
              if (!error) { setDepts(prev=>[...prev, nd]); if (!activeDeptId) setActiveDeptId(nd.id); }
            }} style={{ background:"#3B82F6", border:"none", color:"white", padding:"5px 10px", borderRadius:"6px", cursor:"pointer", fontSize:"12px", display:"flex", alignItems:"center", gap:"4px" }}><Plus size={11}/>Nieuw</button>
          </div>
          {depts.length === 0 && <div style={{ color:"#334155", fontSize:"12px", textAlign:"center", padding:"20px" }}>Geen afdelingen.</div>}
          {depts.map(d => (
            <div key={d.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:"#1e293b", borderRadius:"6px", padding:"8px 12px", marginBottom:"5px" }}>
              <input value={d.name} onChange={e => {
                const upd = {...d, name:e.target.value};
                setDepts(prev => prev.map(x => x.id===d.id ? upd : x));
                syncDept(upd);
              }} style={{ background:"none", border:"none", color:"white", flex:1, outline:"none" }}/>
              {depts.length>1 && <button onClick={async () => { if(window.confirm("Afdeling verwijderen?")) await deleteDept(d.id); }} style={{ background:"none", border:"none", color:"#EF4444", cursor:"pointer" }}><Trash2 size={14}/></button>}
            </div>
          ))}
        </section>

        {/* Skills */}
        <section style={{ background:"#0f172a", borderRadius:"12px", padding:"20px", border:"1px solid #1e293b" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"14px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"8px" }}><Zap size={15} color="#8B5CF6"/><h3 style={{ margin:0, color:"white", fontSize:"14px", fontWeight:"700" }}>Skills & Criteria</h3></div>
            <button onClick={async () => {
              const n=prompt("Naam nieuwe skill?"); if (!n) return;
              const ns: Skill = {id:"s"+Date.now(), name:n, criteria:""};
              const {error} = await sb.from("skills").insert({id:ns.id, name:ns.name, criteria:""});
              if (!error) setSkills(prev => [...prev, ns]);
            }} style={{ background:"#8B5CF6", border:"none", color:"white", padding:"5px 10px", borderRadius:"6px", cursor:"pointer", fontSize:"12px", display:"flex", alignItems:"center", gap:"4px" }}><Plus size={11}/>Skill</button>
          </div>
          {skills.map(s => (
            <div key={s.id} style={{ background:"#1e293b", borderRadius:"8px", padding:"10px", marginBottom:"8px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"6px" }}>
                <input value={s.name} onChange={e => {
                  const upd = {...s, name:e.target.value};
                  setSkills(prev => prev.map(x => x.id===s.id ? upd : x));
                  syncSkill(upd);
                }} style={{ background:"none", border:"none", color:"white", fontWeight:"700", fontSize:"13px", flex:1, outline:"none" }}/>
                <button onClick={async () => { if(window.confirm("Skill verwijderen?")) await deleteSkill(s.id); }} style={{ background:"none", border:"none", color:"#EF4444", cursor:"pointer" }}><Trash2 size={14}/></button>
              </div>
              <textarea value={s.criteria} onChange={e => {
                const upd = {...s, criteria:e.target.value};
                setSkills(prev => prev.map(x => x.id===s.id ? upd : x));
                syncSkill(upd);
              }} placeholder="Vereisten voor 100%..." rows={2}
                style={{ width:"100%", background:"#0f172a", color:"#64748B", border:"1px solid #334155", borderRadius:"4px", fontSize:"11px", padding:"6px", resize:"vertical", boxSizing:"border-box" }}/>
            </div>
          ))}
        </section>

        {/* Klanten & Subcategorieën */}
        <section style={{ background:"#0f172a", borderRadius:"12px", padding:"20px", border:"1px solid #1e293b", gridColumn:"1/-1" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"14px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"8px" }}><Users size={15} color="#10B981"/><h3 style={{ margin:0, color:"white", fontSize:"14px", fontWeight:"700" }}>Klanten & Subcategorieën ({activeDept?.name})</h3></div>
            <button onClick={async () => {
              const n=prompt("Naam nieuwe klant?"); if(!n) return;
              const nc: Client = {id:"c"+Date.now(), name:n, departmentId:activeDeptId, fteNeeded:1, useFTE:true};
              const {error} = await sb.from("clients").insert({id:nc.id, name:nc.name, department_id:nc.departmentId, fte_needed:nc.fteNeeded, use_fte:true});
              if (!error) setClients(prev=>[...prev, nc]);
            }} style={{ background:"#10B981", border:"none", color:"white", padding:"7px 14px", borderRadius:"8px", cursor:"pointer", fontWeight:"700", display:"flex", alignItems:"center", gap:"6px" }}><Plus size={14}/>Klant</button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:"14px" }}>
            {deptClients.map(client => {
              const csubs = subcats.filter(s => s.clientId===client.id);
              return (
                <div key={client.id} style={{ background:"#1e293b", borderRadius:"10px", padding:"14px", borderLeft:"3px solid #38BDF8" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"10px" }}>
                    <input value={client.name} onChange={e => {
                      const upd = {...client, name:e.target.value};
                      setClients(prev => prev.map(c => c.id===client.id ? upd : c));
                      syncClient(upd);
                    }} style={{ background:"none", border:"none", color:"white", fontWeight:"700", fontSize:"14px", flex:1, outline:"none" }}/>
                    <button onClick={async () => { if(window.confirm("Klant + subcategorieën verwijderen?")) await deleteClient(client.id); }} style={{ background:"none", border:"none", color:"#EF4444", cursor:"pointer" }}><Trash2 size={14}/></button>
                  </div>
                  <div style={{ display:"flex", gap:"10px", alignItems:"center", marginBottom:"10px" }}>
                    <div>
                      <label style={{ fontSize:"9px", color:"#64748B", display:"block", marginBottom:"3px", fontWeight:"700", letterSpacing:"0.06em" }}>FTE DOEL</label>
                      <input type="number" step="0.5" min="0.5" value={client.fteNeeded} onChange={e => {
                        const upd = {...client, fteNeeded:parseFloat(e.target.value)||0};
                        setClients(prev => prev.map(c => c.id===client.id ? upd : c));
                        syncClient(upd);
                      }} style={{ width:"70px", background:"#0f172a", color:"white", border:"1px solid #334155", borderRadius:"4px", padding:"4px 6px" }}/>
                    </div>
                    <div>
                      <label style={{ fontSize:"9px", color:"#64748B", display:"block", marginBottom:"3px", fontWeight:"700", letterSpacing:"0.06em" }}>FTE ACTIEF</label>
                      <button onClick={() => {
                        const upd = {...client, useFTE:!client.useFTE};
                        setClients(prev => prev.map(c => c.id===client.id ? upd : c));
                        syncClient(upd);
                      }} style={{ background:"none", border:"none", cursor:"pointer", padding:0, display:"flex", alignItems:"center" }}>
                        {client.useFTE ? <ToggleRight size={22} color="#10B981"/> : <ToggleLeft size={22} color="#475569"/>}
                      </button>
                    </div>
                  </div>
                  {csubs.map(sub => (
                    <div key={sub.id} style={{ background:"#0f172a", borderRadius:"6px", padding:"8px", marginBottom:"6px" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"6px" }}>
                        <input value={sub.name} onChange={e => {
                          const upd = {...sub, name:e.target.value};
                          setSubcats(prev => prev.map(s => s.id===sub.id ? upd : s));
                          syncSubcat(upd);
                        }} style={{ background:"none", border:"none", color:"#94A3B8", fontWeight:"700", fontSize:"12px", flex:1, outline:"none" }}/>
                        <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                          {/* Pauze-overname toggle */}
                          <button onClick={() => {
                            const upd = {...sub, requireBreakCover:!sub.requireBreakCover};
                            setSubcats(prev => prev.map(s => s.id===sub.id ? upd : s));
                            syncSubcat(upd);
                          }} title={sub.requireBreakCover?"Pauze cover AAN":"Pauze cover UIT"}
                            style={{ background:sub.requireBreakCover?"rgba(245,158,11,0.15)":"transparent", border:`1px solid ${sub.requireBreakCover?"#F59E0B":"#334155"}`, color:sub.requireBreakCover?"#F59E0B":"#475569", borderRadius:"4px", padding:"2px 6px", fontSize:"9px", cursor:"pointer", display:"flex", alignItems:"center", gap:"3px" }}>
                            ☕{sub.requireBreakCover?" Cover":""}
                          </button>
                          <button onClick={async () => await deleteSubcat(sub.id)} style={{ background:"none", border:"none", color:"#EF4444", cursor:"pointer", fontSize:"11px" }}>✕</button>
                        </div>
                      </div>
                      <div style={{ fontSize:"9px", color:"#475569", marginBottom:"5px", letterSpacing:"0.06em", fontWeight:"700" }}>VEREISTE SKILLS:</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:"4px" }}>
                        {skills.map(s => {
                          const has = sub.targetSkills.includes(s.id);
                          return <button key={s.id} onClick={() => {
                            const nt  = has?sub.targetSkills.filter(x=>x!==s.id):[...sub.targetSkills,s.id];
                            const upd = {...sub, targetSkills:nt};
                            setSubcats(prev => prev.map(sc => sc.id===sub.id ? upd : sc));
                            syncSubcat(upd);
                          }} title={s.criteria}
                            style={{ fontSize:"9px", padding:"3px 8px", borderRadius:"10px", cursor:"pointer", border:has?"1px solid #8B5CF6":"1px solid #334155", background:has?"#8B5CF6":"transparent", color:has?"white":"#475569" }}>
                            {has?"✓ ":""}{s.name}
                          </button>;
                        })}
                        {skills.length===0 && <span style={{ fontSize:"9px", color:"#334155" }}>Maak eerst skills aan ↑</span>}
                      </div>
                    </div>
                  ))}
                  <button onClick={async () => {
                    const n=prompt("Naam subcategorie?"); if(!n) return;
                    const ns: Subcategory = {id:"sub"+Date.now(), clientId:client.id, name:n, targetSkills:[], requireBreakCover:false};
                    const {error} = await sb.from("subcategories").insert({id:ns.id, client_id:ns.clientId, name:ns.name, target_skills:[], require_break_cover:false});
                    if (!error) setSubcats(prev=>[...prev, ns]);
                  }} style={{ width:"100%", padding:"5px", background:"none", border:"1px dashed #334155", color:"#64748B", borderRadius:"4px", fontSize:"11px", cursor:"pointer", marginTop:"4px" }}>
                    + Subcategorie
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Shift Definities */}
        <section style={{ background:"#0f172a", borderRadius:"12px", padding:"20px", border:"1px solid #1e293b" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"14px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"8px" }}><Clock size={15} color="#F59E0B"/><h3 style={{ margin:0, color:"white", fontSize:"14px", fontWeight:"700" }}>Shift Definities</h3></div>
            <button onClick={async () => {
              const label=prompt("Naam shift (bv. 06–15)?"); if(!label) return;
              const ns: ShiftDef = {id:"sh"+Date.now(), label, hours:[]};
              const {error} = await sb.from("shift_defs").insert({id:ns.id, label:ns.label, hours:[]});
              if (!error) setShiftDefs(prev=>[...prev, ns]);
            }} style={{ background:"#F59E0B", border:"none", color:"black", padding:"5px 10px", borderRadius:"6px", cursor:"pointer", fontSize:"12px", fontWeight:"700", display:"flex", alignItems:"center", gap:"4px" }}><Plus size={11}/>Shift</button>
          </div>
          {shiftDefs.map(sh => (
            <div key={sh.id} style={{ background:"#1e293b", borderRadius:"8px", padding:"12px", marginBottom:"8px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"10px" }}>
                <input value={sh.label} onChange={e => {
                  const upd = {...sh, label:e.target.value};
                  setShiftDefs(prev => prev.map(x => x.id===sh.id ? upd : x));
                  syncShift(upd);
                }} style={{ background:"none", border:"none", color:"#F59E0B", fontWeight:"700", fontSize:"13px", flex:1, outline:"none" }}/>
                <button onClick={async () => { if(window.confirm("Shift verwijderen?")) await deleteShift(sh.id); }} style={{ background:"none", border:"none", color:"#EF4444", cursor:"pointer" }}><Trash2 size={14}/></button>
              </div>
              <div style={{ fontSize:"9px", color:"#475569", marginBottom:"6px", fontWeight:"700", letterSpacing:"0.06em" }}>UREN (klik om aan/uit te zetten):</div>
              <div style={{ display:"flex", gap:"3px", flexWrap:"wrap" }}>
                {WORK_HOURS.map(h => {
                  const on = sh.hours.includes(h);
                  return <button key={h} onClick={() => {
                    const upd = {...sh, hours:on?sh.hours.filter(hr=>hr!==h):[...sh.hours,h].sort((a,b)=>a-b)};
                    setShiftDefs(prev => prev.map(x => x.id===sh.id ? upd : x));
                    syncShift(upd);
                  }} style={{ padding:"3px 6px", borderRadius:"4px", border:"none", fontSize:"10px", cursor:"pointer", background:on?"#F59E0B":"#334155", color:on?"black":"#475569", fontWeight:on?"700":"400" }}>
                    {h}
                  </button>;
                })}
              </div>
              <div style={{ fontSize:"10px", color:"#64748B", marginTop:"6px", fontFamily:"monospace" }}>
                {sh.hours.length>0
                  ? `${String(Math.min(...sh.hours)).padStart(2,"0")}:00 – ${String(Math.max(...sh.hours)+1).padStart(2,"0")}:00 · ${sh.hours.length} uur → ${nettoUren(sh.hours)}u netto`
                  : <span style={{ color:"#EF4444" }}>Geen uren geselecteerd</span>
                }
              </div>
            </div>
          ))}
        </section>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // TAB: FINANCIEEL
  // ═════════════════════════════════════════════════════════════════════════
  function TabFinancieel() {
    const [filterDeptId,   setFilterDeptId]   = useState<string>("all");
    const [filterClientId, setFilterClientId] = useState<string>("all");
    const allDates = displayDates();

    type SubcatData = { naam:string; kosten:number; uren:number; details:{empNaam:string;empColor:string;bruto:number;netto:number;loon:number;kosten:number}[] };
    type ClientData = { naam:string; kosten:number; uren:number; deptId:string; subcats:Record<string,SubcatData> };
    type DeptData   = { naam:string; kosten:number; uren:number; };

    const kostenPerKlant: Record<string,ClientData> = {};
    const kostenPerDept:  Record<string,DeptData>   = {};
    depts.forEach(d => { kostenPerDept[d.id] = {naam:d.name, kosten:0, uren:0}; });

    clients.forEach(client => {
      const csubs = subcats.filter(s => s.clientId===client.id);
      kostenPerKlant[client.id] = { naam:client.name, kosten:0, uren:0, deptId:client.departmentId, subcats:{} };
      (csubs.length ? csubs : [{id:`client-${client.id}`,clientId:client.id,name:"Algemeen",targetSkills:[],requireBreakCover:false}]).forEach(sub => {
        kostenPerKlant[client.id].subcats[sub.id] = { naam:sub.name, kosten:0, uren:0, details:[] };
        allDates.forEach(date => {
          const entry = schedule[`${fmtDate(date)}-${sub.id}`];
          if (!entry?.rows) return;
          entry.rows.forEach(row => {
            const emp = employees.find(e => e.id===row.employeeId);
            if (!emp || !emp.hourlyWage) return;
            const bruto  = row.selectedHours?.length || 0;
            const netto  = nettoUrenEmp(emp, row.selectedHours);
            const kosten = netto * emp.hourlyWage;
            kostenPerKlant[client.id].kosten += kosten;
            kostenPerKlant[client.id].uren   += netto;
            kostenPerKlant[client.id].subcats[sub.id].kosten += kosten;
            kostenPerKlant[client.id].subcats[sub.id].uren   += netto;
            kostenPerKlant[client.id].subcats[sub.id].details.push({ empNaam:emp.name, empColor:emp.color, bruto, netto, loon:emp.hourlyWage, kosten });
            if (kostenPerDept[client.departmentId]) {
              kostenPerDept[client.departmentId].kosten += kosten;
              kostenPerDept[client.departmentId].uren   += netto;
            }
          });
        });
      });
    });

    const filteredClients = Object.entries(kostenPerKlant).filter(([cid,c]) => {
      if (filterDeptId !== "all" && c.deptId !== filterDeptId) return false;
      if (filterClientId !== "all" && cid !== filterClientId) return false;
      return true;
    });

    const totalKosten = filteredClients.reduce((a,[,c]) => a+c.kosten, 0);
    const totalUren   = filteredClients.reduce((a,[,c]) => a+c.uren, 0);
    const weekFactor  = viewType==="week" ? 1 : allDates.length/7;
    const maandSchat  = (totalKosten / weekFactor) * (52/12);
    const jaarSchat   = (totalKosten / weekFactor) * 52;

    return (
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))", gap:"20px" }}>
        {/* Filters */}
        <div style={{ gridColumn:"1/-1", background:"#0f172a", borderRadius:"12px", padding:"16px", border:"1px solid #1e293b", display:"flex", gap:"16px", flexWrap:"wrap", alignItems:"center" }}>
          <div style={{ display:"flex",alignItems:"center",gap:"8px" }}>
            <Building2 size={14} color="#64748B"/>
            <span style={{ fontSize:"11px",color:"#64748B",fontWeight:"700" }}>AFDELING:</span>
            <select value={filterDeptId} onChange={e => { setFilterDeptId(e.target.value); setFilterClientId("all"); }}
              style={{ background:"#1e293b",color:"white",border:"1px solid #334155",borderRadius:"6px",padding:"5px 10px",fontSize:"12px" }}>
              <option value="all">Alle afdelingen</option>
              {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:"8px" }}>
            <Users size={14} color="#64748B"/>
            <span style={{ fontSize:"11px",color:"#64748B",fontWeight:"700" }}>KLANT:</span>
            <select value={filterClientId} onChange={e => setFilterClientId(e.target.value)}
              style={{ background:"#1e293b",color:"white",border:"1px solid #334155",borderRadius:"6px",padding:"5px 10px",fontSize:"12px" }}>
              <option value="all">Alle klanten</option>
              {clients.filter(c => filterDeptId==="all" || c.departmentId===filterDeptId).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* KPI kaarten */}
        <div style={{ gridColumn:"1/-1", display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:"14px" }}>
          {[
            { label:"Loonkosten periode",  value:fmtEuro(totalKosten), sub:`${totalUren.toFixed(1)} uur gewerkt`,    icon:<Euro size={18}/>,      color:"#3B82F6" },
            { label:"Schatting per maand", value:fmtEuro(maandSchat),  sub:"Op basis van deze periode",              icon:<TrendingUp size={18}/>, color:"#10B981" },
            { label:"Schatting per jaar",  value:fmtEuro(jaarSchat),   sub:"Geëxtrapoleerd op jaarbasis",            icon:<PieChart size={18}/>,   color:"#8B5CF6" },
          ].map(kpi => (
            <div key={kpi.label} style={{ background:"#0f172a", border:"1px solid #1e293b", borderRadius:"14px", padding:"20px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"12px" }}>
                <div style={{ color:kpi.color }}>{kpi.icon}</div>
                <span style={{ fontSize:"11px", color:"#64748B", fontWeight:"600", letterSpacing:"0.04em" }}>{kpi.label.toUpperCase()}</span>
              </div>
              <div style={{ fontSize:"26px", fontWeight:"800", color:"white", letterSpacing:"-0.5px" }}>{kpi.value}</div>
              <div style={{ fontSize:"10px", color:"#475569", marginTop:"4px" }}>{kpi.sub}</div>
            </div>
          ))}
        </div>

        {/* Kosten per afdeling */}
        <section style={{ background:"#0f172a", borderRadius:"14px", padding:"22px", border:"1px solid #1e293b" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"18px" }}>
            <Building2 size={17} color="#3B82F6"/>
            <h3 style={{ margin:0, color:"white", fontSize:"14px", fontWeight:"700" }}>Kosten per afdeling</h3>
          </div>
          {Object.entries(kostenPerDept).map(([deptId, deptData]) => {
            const totAll  = Object.values(kostenPerDept).reduce((a,d) => a+d.kosten, 0);
            const deptPct = totAll > 0 ? Math.round(deptData.kosten/totAll*100) : 0;
            return (
              <div key={deptId} style={{ background:"#1e293b", borderRadius:"8px", padding:"12px", marginBottom:"8px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"6px" }}>
                  <span style={{ fontWeight:"700", color:"white", fontSize:"13px" }}>{deptData.naam}</span>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontWeight:"700", color:"white" }}>{fmtEuro(deptData.kosten)}</div>
                    <div style={{ fontSize:"10px", color:"#64748B" }}>{deptData.uren.toFixed(1)} uur</div>
                  </div>
                </div>
                <div style={{ height:"4px", background:"#334155", borderRadius:"2px", overflow:"hidden" }}>
                  <div style={{ width:`${deptPct}%`, height:"100%", background:"#3B82F6" }}/>
                </div>
              </div>
            );
          })}
        </section>

        {/* Uurlonen beheren */}
        <section style={{ background:"#0f172a", borderRadius:"14px", padding:"22px", border:"1px solid #1e293b" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"18px" }}>
            <Users size={17} color="#F59E0B"/>
            <h3 style={{ margin:0, color:"white", fontSize:"14px", fontWeight:"700" }}>Uurlonen beheren</h3>
          </div>
          {employees.map(emp => (
            <div key={emp.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:"#1e293b", borderRadius:"8px", padding:"10px 14px", marginBottom:"8px", borderLeft:`3px solid ${emp.color}` }}>
              <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                <div style={{ width:"10px", height:"10px", borderRadius:"50%", background:emp.color }}/>
                <div>
                  <div style={{ fontSize:"13px", fontWeight:"600", color:"white" }}>{emp.name}</div>
                  <div style={{ fontSize:"10px", color:"#64748B" }}>{depts.find(d=>d.id===emp.departmentId)?.name}</div>
                </div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                <span style={{ color:"#64748B", fontSize:"13px" }}>€</span>
                <input type="number" step="0.01" min="0" value={emp.hourlyWage||0}
                  onChange={e => updEmployee({...emp, hourlyWage:parseFloat(e.target.value)||0})}
                  style={{ width:"70px", background:"#0f172a", color:"white", border:"1px solid #334155", borderRadius:"6px", padding:"5px 8px", textAlign:"right", fontSize:"13px", fontWeight:"600" }}/>
                <span style={{ color:"#64748B", fontSize:"11px" }}>/uur</span>
              </div>
            </div>
          ))}
        </section>

        {/* Kosten per klant */}
        <section style={{ background:"#0f172a", borderRadius:"14px", padding:"22px", border:"1px solid #1e293b", gridColumn:"span 2" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"18px" }}>
            <Building2 size={17} color="#38BDF8"/>
            <h3 style={{ margin:0, color:"white", fontSize:"14px", fontWeight:"700" }}>Kosten per klant & subcategorie</h3>
          </div>
          {filteredClients.map(([clientId, clientData]) => (
            <div key={clientId} style={{ marginBottom:"20px", background:"#1e293b", borderRadius:"10px", overflow:"hidden" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 16px", background:"#172033" }}>
                <span style={{ fontWeight:"700", color:"#38BDF8", fontSize:"14px" }}>{clientData.naam}</span>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontWeight:"700", color:"white" }}>{fmtEuro(clientData.kosten)}</div>
                  <div style={{ fontSize:"10px", color:"#64748B" }}>{clientData.uren.toFixed(1)} uur</div>
                </div>
              </div>
              {Object.entries(clientData.subcats).map(([subId, subData]) => (
                <div key={subId}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 16px 10px 28px", borderBottom:"1px solid #0f172a" }}>
                    <span style={{ color:"#94A3B8", fontSize:"13px" }}>↳ {subData.naam}</span>
                    <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ color:"#94A3B8", fontSize:"13px", fontWeight:"600" }}>{fmtEuro(subData.kosten)}</div>
                        <div style={{ fontSize:"9px", color:"#475569" }}>{subData.uren.toFixed(1)} uur</div>
                      </div>
                      <button onClick={() => setShowCalcFor(prev => prev===subId?null:subId)}
                        style={{ background:"#0f172a", border:"1px solid #334155", color:"#64748B", borderRadius:"5px", padding:"3px 8px", fontSize:"10px", cursor:"pointer", display:"flex", alignItems:"center", gap:"4px" }}>
                        {showCalcFor===subId ? <EyeOff size={11}/> : <Eye size={11}/>} Detail
                      </button>
                    </div>
                  </div>
                  {showCalcFor===subId && subData.details.length>0 && (
                    <div style={{ padding:"12px 28px", background:"rgba(0,0,0,0.2)" }}>
                      {subData.details.map((d,i) => (
                        <div key={i} style={{ fontSize:"11px", color:"#64748B", marginBottom:"5px", fontFamily:"monospace", display:"flex", alignItems:"center", gap:"8px" }}>
                          <span style={{ width:"8px",height:"8px",borderRadius:"50%",background:d.empColor,display:"inline-block",flexShrink:0 }}/>
                          <span style={{ color:"#94A3B8" }}>{d.empNaam}</span>:
                          <span style={{ color:"#10B981" }}>{d.netto.toFixed(2)}u</span>
                          × {fmtEuro(d.loon)} = <span style={{ color:"white",fontWeight:"bold" }}>{fmtEuro(d.kosten)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
          {filteredClients.length === 0 && <div style={{ color:"#334155",textAlign:"center",padding:"40px" }}>Geen data voor deze filter.</div>}
        </section>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // TAB: ADMIN
  // ═════════════════════════════════════════════════════════════════════════
  // AdminUserPanel als los component buiten render om focus-verlies te voorkomen
  const AdminUserPanel = React.memo(function AdminUserPanel() {
    const [naam,       setNaam]       = useState("");
    const [email,      setEmail]      = useState("");
    const [password,   setPassword]   = useState("");
    const [isAdminNew, setIsAdminNew] = useState(false);
    const [loadingNew, setLoadingNew] = useState(false);
    const [status,     setStatus]     = useState<{type:"ok"|"err";msg:string}|null>(null);
    const [allUsers,   setAllUsers]   = useState<any[]>([]);

    useEffect(() => {
      sb.from("employees").select("id,name,email,is_admin,department_id,color").then(({ data }) => {
        if (data) setAllUsers(data);
      });
    }, []);

    async function addUser() {
      if (!naam.trim() || !email.trim() || !password.trim()) {
        setStatus({type:"err", msg:"Vul naam, e-mail en wachtwoord in."}); return;
      }
      setLoadingNew(true); setStatus(null);
      try {
        const { data: signUpData, error: signUpErr } = await sb.auth.signUp({ email, password });
        if (signUpErr) throw signUpErr;
        const userId = signUpData.user?.id;
        if (!userId) throw new Error("Geen gebruikers-ID ontvangen van Supabase Auth.");
        const colorIdx = employees.length % EMPLOYEE_COLORS.length;
        const { data, error } = await sb.from("employees").insert({
          id: userId, name: naam, email: email,
          is_admin: isAdminNew, department_id: activeDeptId,
          hours_per_week: 40, main_client_id: null,
          sub_cat_ids: [], sub_cat_skills: {},
          standard_off_days: ["Zaterdag","Zondag"], vacation_dates: [],
          default_shift_id: null, hourly_wage: 0,
          color: EMPLOYEE_COLORS[colorIdx], breaks: [], pause_config: [],
        }).select();
        if (error) throw error;
        if (data) {
          setAllUsers(prev => [...prev, data[0]]);
          setEmployees(prev => [...prev, {
            id:userId, name:naam, departmentId:activeDeptId,
            hoursPerWeek:40, mainClientId:"", subCatIds:[], subCatSkills:{},
            standardOffDays:["Zaterdag","Zondag"], vacationDates:[],
            defaultShiftId:"", hourlyWage:0, isAdmin:isAdminNew,
            color:EMPLOYEE_COLORS[colorIdx], breaks:[],
          }]);
        }
        setStatus({type:"ok", msg:`✅ ${naam} aangemaakt. Verificatiemail verstuurd naar ${email}.`});
        setNaam(""); setEmail(""); setPassword("");
      } catch(err: any) {
        setStatus({type:"err", msg:"Fout: " + (err.message || "Onbekende fout")});
      }
      setLoadingNew(false);
    }

    async function toggleAdmin(userId: string, current: boolean) {
      const {error} = await sb.from("employees").update({is_admin:!current}).eq("id", userId);
      if (!error) {
        setAllUsers(prev => prev.map(u => u.id===userId ? {...u,is_admin:!current} : u));
        setEmployees(prev => prev.map(e => e.id===userId ? {...e,isAdmin:!current} : e));
      }
    }
    async function removeUser(userId: string) {
      if (!window.confirm("Gebruiker permanent verwijderen?")) return;
      const {error} = await sb.from("employees").delete().eq("id", userId);
      if (!error) {
        setAllUsers(prev => prev.filter(u => u.id !== userId));
        setEmployees(prev => prev.filter(e => e.id !== userId));
      }
    }

    return (
      <div style={{ display:"grid", gap:"20px", maxWidth:"700px" }}>
        <div style={{ background:"#0f172a", borderRadius:"16px", padding:"28px", border:"1px solid #1e293b" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"24px" }}>
            <Shield size={20} color="#8B5CF6"/>
            <h3 style={{ margin:0, color:"white", fontSize:"16px", fontWeight:"700" }}>Nieuwe gebruiker aanmaken</h3>
          </div>
          <div style={{ display:"grid", gap:"14px" }}>
            {[
              { label:"NAAM", type:"text", val:naam, set:setNaam, ph:"Jan de Vries" },
              { label:"E-MAILADRES", type:"email", val:email, set:setEmail, ph:"jan@bedrijf.nl" },
              { label:"TIJDELIJK WACHTWOORD", type:"password", val:password, set:setPassword, ph:"••••••••" },
            ].map(f => (
              <div key={f.label}>
                <label style={{ fontSize:"11px", fontWeight:"600", color:"#64748B", display:"block", marginBottom:"6px", letterSpacing:"0.06em" }}>{f.label}</label>
                <input type={f.type} value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.ph}
                  style={{ width:"100%", padding:"10px 14px", background:"#1e293b", color:"white", border:"1px solid #334155", borderRadius:"8px", fontSize:"13px", boxSizing:"border-box", outline:"none" }}/>
              </div>
            ))}
            <div style={{ display:"flex", alignItems:"center", gap:"10px", background:"#1e293b", borderRadius:"8px", padding:"12px 14px" }}>
              <button onClick={() => setIsAdminNew(v => !v)} style={{ background:"none", border:"none", cursor:"pointer", padding:0, display:"flex" }}>
                {isAdminNew ? <ToggleRight size={28} color="#8B5CF6"/> : <ToggleLeft size={28} color="#475569"/>}
              </button>
              <div>
                <div style={{ fontSize:"13px", color:isAdminNew?"#C4B5FD":"#94A3B8", fontWeight:"600" }}>{isAdminNew?"Beheerder":"Medewerker"}</div>
                <div style={{ fontSize:"11px", color:"#475569" }}>{isAdminNew?"Toegang tot financieel & gebruikersbeheer":"Alleen planning en medewerkers"}</div>
              </div>
            </div>
          </div>
          {status && (
            <div style={{ background:status.type==="ok"?"rgba(16,185,129,0.1)":"rgba(239,68,68,0.1)", border:`1px solid ${status.type==="ok"?"rgba(16,185,129,0.3)":"rgba(239,68,68,0.3)"}`, color:status.type==="ok"?"#6EE7B7":"#FCA5A5", borderRadius:"8px", padding:"10px 14px", marginTop:"16px", fontSize:"13px" }}>
              {status.msg}
            </div>
          )}
          <button onClick={addUser} disabled={loadingNew}
            style={{ width:"100%", padding:"11px", background:"#8B5CF6", border:"none", color:"white", borderRadius:"8px", fontWeight:"700", cursor:loadingNew?"wait":"pointer", opacity:loadingNew?0.7:1, marginTop:"16px" }}>
            {loadingNew ? "Aanmaken..." : "➕ Gebruiker aanmaken"}
          </button>
        </div>

        <div style={{ background:"#0f172a", borderRadius:"16px", padding:"28px", border:"1px solid #1e293b" }}>
          <h3 style={{ margin:"0 0 18px 0", color:"white", fontSize:"15px", fontWeight:"700" }}>Alle gebruikers ({allUsers.length})</h3>
          {allUsers.map(u => (
            <div key={u.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:"#1e293b", borderRadius:"8px", padding:"12px 14px", marginBottom:"8px", borderLeft:`3px solid ${u.color||"#3B82F6"}` }}>
              <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                <div style={{ width:"10px",height:"10px",borderRadius:"50%",background:u.color||"#3B82F6" }}/>
                <div>
                  <div style={{ fontSize:"13px", fontWeight:"600", color:"white" }}>{u.name}</div>
                  <div style={{ fontSize:"10px", color:"#64748B", marginTop:"2px" }}>{u.email || "Geen e-mail"}</div>
                </div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                <button onClick={() => toggleAdmin(u.id, u.is_admin)}
                  style={{ background:u.is_admin?"rgba(139,92,246,0.15)":"#0f172a", border:`1px solid ${u.is_admin?"#8B5CF6":"#334155"}`, color:u.is_admin?"#8B5CF6":"#475569", borderRadius:"6px", padding:"4px 10px", fontSize:"11px", cursor:"pointer", fontWeight:"600" }}>
                  {u.is_admin ? "⭐ Admin" : "👤 Medewerker"}
                </button>
                {u.id !== currentUserId && (
                  <button onClick={() => removeUser(u.id)} style={{ background:"none", border:"none", color:"#EF4444", cursor:"pointer" }}><Trash2 size={14}/></button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  });

  // ═════════════════════════════════════════════════════════════════════════
  // TABS CONFIG
  // ═════════════════════════════════════════════════════════════════════════
  const tabs = [
    { id:"planning",    label:"Planning",        icon:<Calendar size={14}/> },
    { id:"medewerkers", label:"Medewerkers",      icon:<Users size={14}/> },
    { id:"beheer",      label:"Klanten & Shifts", icon:<Settings size={14}/> },
    ...(isAdmin ? [
      { id:"financieel", label:"Financieel",     icon:<Euro size={14}/> },
      { id:"admin",      label:"Gebruikers",     icon:<Shield size={14}/> },
    ] : []),
  ];

  if (loading) return (
    <div style={{ minHeight:"100vh",background:"#020617",display:"flex",alignItems:"center",justifyContent:"center",color:"#475569",fontFamily:"'Segoe UI',system-ui,sans-serif",fontSize:"14px",flexDirection:"column",gap:"12px" }}>
      <div style={{ width:"40px",height:"40px",border:"3px solid #1e293b",borderTop:"3px solid #3B82F6",borderRadius:"50%",animation:"spin 1s linear infinite" }}/>
      <span>Data laden uit database...</span>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100vh",background:"#020617",color:"#F8FAFC",fontFamily:"'Segoe UI',system-ui,sans-serif",padding:"16px" }}>
      {/* Modals */}
      {vacModal        && <VacationModal/>}
      {customShiftSlot && <CustomShiftModal/>}
      {showPrintModal  && <PrintModal/>}
      <PrintView/>

      {/* Navigatie */}
      <nav className="screen-only" style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"18px",borderBottom:"1px solid #0f172a",paddingBottom:"14px",flexWrap:"wrap",gap:"10px" }}>
        <div style={{ display:"flex",alignItems:"center",gap:"6px",flexWrap:"wrap" }}>
          {depts.length === 0 ? (
            <div style={{ color:"#475569",fontSize:"12px",padding:"8px" }}>Geen afdelingen — voeg toe via Klanten & Shifts</div>
          ) : (
            <select value={activeDeptId} onChange={e => setActiveDeptId(e.target.value)}
              style={{ background:"#3B82F6",color:"white",padding:"8px 12px",borderRadius:"8px",border:"none",fontWeight:"700",cursor:"pointer" }}>
              {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
              style={{ background:activeTab===tab.id?"#0f172a":"transparent",color:activeTab===tab.id?"white":"#64748B",border:activeTab===tab.id?"1px solid #1e293b":"1px solid transparent",padding:"7px 14px",borderRadius:"8px",cursor:"pointer",fontWeight:activeTab===tab.id?"700":"400",fontSize:"13px",display:"flex",alignItems:"center",gap:"6px" }}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        <div style={{ display:"flex",gap:"8px",alignItems:"center",flexWrap:"wrap" }}>
          <div style={{ display:"flex",alignItems:"center",gap:"6px",background:"#0f172a",padding:"6px 12px",borderRadius:"8px",border:"1px solid #1e293b" }}>
            <span style={{ fontSize:"11px",color:"#64748B" }}>FTE</span>
            <button onClick={() => setUseFTE(v => !v)} style={{ background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center" }}>
              {useFTE ? <ToggleRight size={22} color="#10B981"/> : <ToggleLeft size={22} color="#334155"/>}
            </button>
          </div>

          {/* Auto-plan knoppen */}
          <div style={{ display:"flex",gap:"4px" }}>
            <button onClick={() => runAutoPlanner(true)} style={{ background:"#10B981",color:"white",border:"none",padding:"8px 12px",borderRadius:"8px 0 0 8px",cursor:"pointer",fontWeight:"700",display:"flex",alignItems:"center",gap:"4px",fontSize:"12px" }}>
              <Zap size={13}/>Overschrijf
            </button>
            <button onClick={() => runAutoPlanner(false)} style={{ background:"#059669",color:"white",border:"none",padding:"8px 12px",borderRadius:"0 8px 8px 0",cursor:"pointer",fontWeight:"700",fontSize:"12px" }}
              title="Behoud handmatig ingeplande shifts">
              Behoud
            </button>
          </div>

          <button onClick={() => {
            if(window.confirm("Volledige planning leegmaken?")) {
              setSchedule({});
              sb.from("schedule").delete().neq("slot_id","__never__");
            }
          }} style={{ background:"rgba(239,68,68,0.1)",color:"#EF4444",border:"1px solid rgba(239,68,68,0.2)",padding:"8px 12px",borderRadius:"8px",cursor:"pointer",display:"flex",alignItems:"center",gap:"6px",fontSize:"12px" }}>
            <Trash2 size={13}/>Leeg
          </button>

          <button onClick={() => setShowPrintModal(true)} style={{ background:"#8B5CF6",color:"white",border:"none",padding:"8px 12px",borderRadius:"8px",cursor:"pointer",fontWeight:"700",display:"flex",alignItems:"center",gap:"6px",fontSize:"12px" }}>
            <Printer size={13}/>Print
          </button>

          <button onClick={() => sb.auth.signOut()} style={{ background:"transparent",color:"#475569",border:"1px solid #1e293b",padding:"8px 12px",borderRadius:"8px",cursor:"pointer",display:"flex",alignItems:"center",gap:"6px",fontSize:"12px" }}>
            <LogOut size={13}/>Uitloggen
          </button>
        </div>
      </nav>

      <main className="screen-only">
        {activeTab==="planning"    && <TabPlanning/>}
        {activeTab==="medewerkers" && <TabMedewerkers/>}
        {activeTab==="beheer"      && <TabBeheer/>}
        {activeTab==="financieel"  && isAdmin && <TabFinancieel/>}
        {activeTab==="admin"       && isAdmin && <AdminUserPanel/>}
      </main>

      <style>{`
        @media print { .screen-only{display:none!important} .print-wrap{display:block!important} }
        @media screen { .print-wrap{display:none!important} }
        input:focus, select:focus, textarea:focus { outline:1px solid #3B82F6 !important; border-radius:4px; }
        button:active { transform:scale(0.97); }
        ::-webkit-scrollbar { width:6px; height:6px; }
        ::-webkit-scrollbar-track { background:#0f172a; }
        ::-webkit-scrollbar-thumb { background:#1e293b; border-radius:3px; }
        ::-webkit-scrollbar-thumb:hover { background:#334155; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────────
export default function AppRoot() {
  const [session,     setSession]     = useState<Session|null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    sb.auth.getSession().then(({data}) => { setSession(data.session); setAuthChecked(true); });
    const { data: listener } = sb.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => listener.subscription.unsubscribe();
  }, []);

  if (!authChecked) return (
    <div style={{ minHeight:"100vh",background:"#020617",display:"flex",alignItems:"center",justifyContent:"center",color:"#334155",fontFamily:"'Segoe UI',system-ui,sans-serif",fontSize:"14px" }}>
      ⏳ Laden...
    </div>
  );

  if (!session) return <LoginScreen/>;
  return <App session={session}/>;
}
