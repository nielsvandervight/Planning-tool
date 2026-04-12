import React, { useState, useEffect, useCallback, useRef } from "react";
import { createClient, Session } from "@supabase/supabase-js";
import {
  Users, Calendar, Settings, Euro, LogOut, ChevronLeft, ChevronRight,
  Plus, Trash2, Printer, Zap, ToggleLeft, ToggleRight, AlertTriangle,
  Eye, EyeOff, TrendingUp, Building2, PieChart, Clock, Shield
} from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const supabase = sb; 


export default function App() {

  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [naam, setNaam] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<any>(null);


  async function fetchUsers() {
    const { data, error } = await sb.from('employees').select('*').order('name');
    if (error) console.error("Ophaalfout:", error.message);
    if (data) setAllUsers(data);
  }

  
  useEffect(() => {
    fetchUsers();
  }, []);

  async function addUser() {
    // 1. Validatie: check of alle velden zijn ingevuld
    if (!naam.trim() || !email.trim() || !password.trim()) {
      alert("Vul alstublieft een naam, e-mail en wachtwoord in.");
      return;
    }

    setLoading(true);
    
    try {
      // 2. Data verzenden naar de 'employees' tabel
      const { error } = await sb
        .from('employees')
        .insert([
          {
           
            name: naam.trim(),
            email: email.trim().toLowerCase(),
            password: password, 
            is_admin: isAdmin,
            // Je kunt hier ook direct andere standaardwaarden meegeven indien nodig:
            hourly_wage: 0
          }
        ]);

     
      if (error) throw error;

      
      setNaam("");
      setEmail("");
      setPassword("");
      setIsAdmin(false);
      
      alert("Medewerker succesvol toegevoegd!");
      
      
      await fetchUsers();

    } catch (err: any) {
      console.error("Fout bij toevoegen:", err);
      alert("Er ging iets mis: " + (err.message || "Onbekende fout"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: '20px' }}>
      <h1>Medewerker Beheer</h1>
      
      {/* Invoervelden */}
      <input placeholder="Naam" value={naam} onChange={e => setNaam(e.target.value)} />
      <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
      <input placeholder="Wachtwoord" type="password" value={password} onChange={e => setPassword(e.target.value)} />
      <label>
        <input type="checkbox" checked={isAdmin} onChange={e => setIsAdmin(e.target.checked)} /> Admin?
      </label>
      <button onClick={addUser} disabled={loading}>Voeg toe</button>

      <hr />

      {/* De tabel waar je naar vroeg: Hier zie je iedereen met hun rechten */}
      <table border={1} style={{ width: '100%', marginTop: '20px' }}>
        <thead>
          <tr>
            <th>Naam</th>
            <th>Email</th>
            <th>Rechten</th>
          </tr>
        </thead>
        <tbody>
          {allUsers.map(u => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>{u.is_admin ? "⭐ Admin" : "👤 Medewerker"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}





ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS hourly_wage    DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_admin       BOOLEAN       DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_shift_id TEXT;

-- Schedule tabel met slot_id als Primary Key
CREATE TABLE IF NOT EXISTS schedule (
  slot_id    TEXT PRIMARY KEY,
  rows       JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE employees   ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule    ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients     ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcategories ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_defs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all" ON employees    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON schedule     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON clients      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON subcategories FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON shift_defs   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON departments  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON skills       FOR ALL TO authenticated USING (true) WITH CHECK (true);
*/


interface Department  { id: string; name: string; }
interface Skill       { id: string; name: string; criteria: string; }
interface ShiftDef    { id: string; label: string; hours: number[]; }
interface Subcategory { id: string; clientId: string; name: string; targetSkills: string[]; }
interface Client      { id: string; name: string; departmentId: string; fteNeeded: number; }
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
}
interface SlotRow   { employeeId: string; shiftId: string; selectedHours: number[]; }
interface SlotEntry { rows: SlotRow[]; }


const SEED_DEPTS: Department[] = [
  { id:"d1", name:"Warehouse" }, { id:"d2", name:"Customer Service" }
];
const SEED_SKILLS: Skill[] = [
  { id:"s1", name:"SAP Classic",  criteria:"Kan zelfstandig werken in SAP ECC." },
  { id:"s2", name:"SAP S/4 HANA", criteria:"Werkt goed met SAP S/4 HANA." }
];
const SEED_SHIFTS: ShiftDef[] = [
  { id:"sh1", label:"07–16", hours:[7,8,9,10,11,12,13,14,15] },
  { id:"sh2", label:"08–17", hours:[8,9,10,11,12,13,14,15,16] },
  { id:"sh3", label:"09–18", hours:[9,10,11,12,13,14,15,16,17] },
];
const SEED_CLIENTS: Client[] = [
  { id:"c1", name:"Lesaffre", departmentId:"d1", fteNeeded: 2.5 }
];
const SEED_SUBCATS: Subcategory[] = [
  { id:"sub1", clientId:"c1", name:"Inbound",  targetSkills:["s1"] },
  { id:"sub2", clientId:"c1", name:"Outbound", targetSkills:["s2"] }
];
const SEED_EMPS: Employee[] = [{
  id:"e1", name:"Niels", departmentId:"d1", hoursPerWeek:40,
  mainClientId:"c1", subCatIds:["sub1","sub2"],
  subCatSkills:{ sub1:{s1:90}, sub2:{s2:50} },
  standardOffDays:["Zaterdag","Zondag"], vacationDates:[],
  defaultShiftId:"sh2", hourlyWage:18.50, isAdmin:true
}];

const WORK_HOURS   = [5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22];
const DAY_LABELS   = ["Maandag","Dinsdag","Woensdag","Donderdag","Vrijdag","Zaterdag","Zondag"];
const MONTH_LABELS = ["Januari","Februari","Maart","April","Mei","Juni","Juli","Augustus","September","Oktober","November","December"];


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

/**
 * PAUZE REGEL:
 * - > 4 uur geselecteerd? → 1u pauze aftrek ALS totaal >= 9 blokjes
 * - <= 4 uur? → geen aftrek
 */
function nettoUren(selectedHours: number[]): number {
  const bruto = selectedHours?.length || 0;
  if (bruto >= 9) return bruto - 1;
  return bruto;
}

function fmtEuro(n: number): string {
  return new Intl.NumberFormat("nl-NL", { style:"currency", currency:"EUR" }).format(n);
}

function useDebounce<T extends (...args: any[]) => any>(fn: T, delay: number): T {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  return useCallback((...args: Parameters<T>) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fn(...args), delay);
  }, [fn, delay]) as T;
}


function buildPrintCSS(size: "A4"|"A3"): string {
  const fs=size==="A4"?"5.8pt":"7.5pt", hfs=size==="A4"?"5pt":"6.5pt";
  const colW=size==="A4"?"52px":"72px", labelW=size==="A4"?"80px":"110px";
  return `@media print{*{box-sizing:border-box}body{margin:0;background:#fff!important;color:#111!important;font-family:'Helvetica Neue',Arial,sans-serif}.screen-only{display:none!important}.print-wrap{display:block!important}.pw-page{page-break-after:always;padding:0}.pw-page:last-child{page-break-after:auto}.pw-header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid #0f172a;padding-bottom:5px;margin-bottom:8px}.pw-title{font-size:${size==="A4"?"13pt":"16pt"};font-weight:900;color:#0f172a}.pw-sub{font-size:${hfs};color:#64748b;margin-top:2px}.pw-meta{font-size:${hfs};color:#94a3b8;text-align:right}.pw-tbl{border-collapse:collapse;width:100%}.pw-tbl th{background:#1e293b!important;-webkit-print-color-adjust:exact;print-color-adjust:exact;color:#f8fafc!important;font-size:${hfs};font-weight:700;padding:3px;text-align:center}.pw-tbl td{border:1px solid #e2e8f0;font-size:${fs};padding:2px 3px;vertical-align:top}.pw-tbl tr.client-hdr td{background:#0f172a!important;-webkit-print-color-adjust:exact;print-color-adjust:exact;color:#38bdf8!important;font-weight:700;font-size:${hfs};padding:3px 5px}.pw-tbl tr.sub-row td:first-child{background:#f8fafc!important;-webkit-print-color-adjust:exact;print-color-adjust:exact;color:#475569;padding-left:8px;min-width:${labelW};max-width:${labelW};word-wrap:break-word}.pw-tbl .col-label{min-width:${labelW};max-width:${labelW}}.pw-tbl .col-day{min-width:${colW};max-width:${colW};width:${colW}}.pw-emp{font-weight:700;color:#1e293b;font-size:${fs}}.pw-hrs{color:#64748b;font-size:${size==="A4"?"4.5pt":"5.5pt"}}.pw-badge{display:inline-block;background:#3b82f6!important;-webkit-print-color-adjust:exact;print-color-adjust:exact;color:#fff!important;border-radius:2px;padding:0 2px;font-size:4pt;margin-left:2px}.pw-emp2{color:#7c3aed}.pw-fte-ok{color:#059669!important}.pw-fte-low{color:#dc2626!important}@page{size:${size} landscape;margin:8mm}}`;
}


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
          <input type="password" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="••••••••@bedrijf.nl"
            style={{ width:"100%", padding:"11px 14px", background:"#1e293b", color:"white", border:"1px solid #334155", borderRadius:"10px", fontSize:"14px", boxSizing:"border-box", outline:"none" }}/>
        </div>

        <div style={{ marginBottom:"24px" }}>
          <label style={{ fontSize:"11px", fontWeight:"600", color:"#64748B", display:"block", marginBottom:"6px", letterSpacing:"0.06em" }}>WACHTWOORD</label>
          <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key==="Enter" && handleLogin()} placeholder="••••••••"
            style={{ width:"100%", padding:"11px 14px", background:"#1e293b", color:"white", border:"1px solid #334155", borderRadius:"10px", fontSize:"14px", boxSizing:"border-box", outline:"none" }}/>
        </div>

        {error && <div style={{ background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)", color:"#FCA5A5", borderRadius:"8px", padding:"10px 14px", marginBottom:"16px", fontSize:"13px" }}>{error}</div>}

        <button onClick={handleLogin} disabled={loading}
          style={{ width:"100%", padding:"12px", background:loading?"#1e293b":"#3B82F6", border:"none", color:"white", borderRadius:"10px", fontWeight:"700", fontSize:"15px", cursor:loading?"wait":"pointer", transition:"all 0.2s" }}>
          {loading ? "Inloggen..." : "Inloggen"}
        </button>
      </div>
    </div>
  );
}


function AdminUserPanel() {
  const [naam,    setNaam]    = useState("");
  const [email,   setEmail]   = useState("");
  const [isAdmin, setIsAdmin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [status,  setStatus]  = useState<{type:"ok"|"err";msg:string}|null>(null);

  async function addUser() {
    if (!naam.trim() || !email.trim()) { setStatus({type:"err",msg:"Naam en e-mail zijn verplicht."}); return; }
    setLoading(true); setStatus(null);
    try {
      const { error } = await (sb.auth as any).admin.inviteUserByEmail(email, {
        data: { name:naam, role:isAdmin?"admin":"planner" }
      });
      if (error) throw error;
      const masked = email.replace(/(?<=.{2}).(?=[^@]*@)/g,"*");
      setStatus({type:"ok",msg:`Uitnodiging verstuurd → ${masked}`});
      setNaam(""); setEmail("");
    } catch(e:any) { setStatus({type:"err",msg:e.message||"Er ging iets mis."}); }
    setLoading(false);
  }

  return (
    <div style={{ background:"#0f172a", borderRadius:"16px", padding:"28px", maxWidth:"520px", border:"1px solid #1e293b" }}>
      <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"24px" }}>
        <Shield size={20} color="#8B5CF6"/>
        <h3 style={{ margin:0, color:"white", fontSize:"16px", fontWeight:"700" }}>Nieuwe gebruiker uitnodigen</h3>
      </div>

      <div style={{ marginBottom:"16px" }}>
        <label style={{ fontSize:"11px", fontWeight:"600", color:"#64748B", display:"block", marginBottom:"6px", letterSpacing:"0.06em" }}>NAAM (zichtbaar op scherm)</label>
        <input type="text" value={naam} onChange={e => setNaam(e.target.value)} placeholder="Jan de Vries"
          style={{ width:"100%", padding:"10px 14px", background:"#1e293b", color:"white", border:"1px solid #334155", borderRadius:"8px", fontSize:"13px", boxSizing:"border-box", outline:"none" }}/>
      </div>

      <div style={{ marginBottom:"16px" }}>
        <label style={{ fontSize:"11px", fontWeight:"600", color:"#64748B", display:"block", marginBottom:"6px", letterSpacing:"0.06em" }}>
          E-MAILADRES <span style={{ color:"#475569", fontWeight:"400" }}>(verborgen voor privacy)</span>
        </label>
        {/* type="password" zodat e-mail niet over de schouder meegelezen kan worden */}
        <input type="password" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} placeholder="••••••••@bedrijf.nl"
          style={{ width:"100%", padding:"10px 14px", background:"#1e293b", color:"white", border:"1px solid #334155", borderRadius:"8px", fontSize:"13px", boxSizing:"border-box", outline:"none", fontFamily:"monospace" }}/>
        <div style={{ fontSize:"10px", color:"#374151", marginTop:"5px" }}>Het e-mailadres is bewust verborgen. De uitnodigingsmail wordt op de achtergrond verstuurd.</div>
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"24px", background:"#1e293b", borderRadius:"8px", padding:"12px 14px" }}>
        <button onClick={() => setIsAdmin(v => !v)} style={{ background:"none", border:"none", cursor:"pointer", padding:0, display:"flex" }}>
          {isAdmin ? <ToggleRight size={28} color="#8B5CF6"/> : <ToggleLeft size={28} color="#475569"/>}
        </button>
        <div>
          <div style={{ fontSize:"13px", color:isAdmin?"#C4B5FD":"#94A3B8", fontWeight:"600" }}>{isAdmin?"Beheerder":"Planner"}</div>
          <div style={{ fontSize:"11px", color:"#475569" }}>{isAdmin?"Toegang tot financieel beheer en gebruikersbeheer":"Alleen planning en medewerkers beheren"}</div>
        </div>
      </div>

      {status && (
        <div style={{ background:status.type==="ok"?"rgba(16,185,129,0.1)":"rgba(239,68,68,0.1)", border:`1px solid ${status.type==="ok"?"rgba(16,185,129,0.3)":"rgba(239,68,68,0.3)"}`, color:status.type==="ok"?"#6EE7B7":"#FCA5A5", borderRadius:"8px", padding:"10px 14px", marginBottom:"16px", fontSize:"13px" }}>
          {status.msg}
        </div>
      )}

      <button onClick={addUser} disabled={loading}
        style={{ width:"100%", padding:"11px", background:"#8B5CF6", border:"none", color:"white", borderRadius:"8px", fontWeight:"700", cursor:loading?"wait":"pointer", opacity:loading?0.7:1 }}>
        {loading?"Versturen...":"✉️ Stuur uitnodiging"}
      </button>
    </div>
  );
}


function App({ session }: { session: Session }) {
  const [activeTab, setActiveTab] = useState<"planning"|"medewerkers"|"beheer"|"financieel"|"admin">("planning");

  const [depts,     setDepts]     = useState<Department[]>(SEED_DEPTS);
  const [skills,    setSkills]    = useState<Skill[]>(SEED_SKILLS);
  const [shiftDefs, setShiftDefs] = useState<ShiftDef[]>(SEED_SHIFTS);
  const [clients,   setClients]   = useState<Client[]>(SEED_CLIENTS);
  const [subcats,   setSubcats]   = useState<Subcategory[]>(SEED_SUBCATS);
  const [employees, setEmployees] = useState<Employee[]>(SEED_EMPS);
  const [schedule,  setSchedule]  = useState<Record<string,SlotEntry>>({});

  const [activeDeptId,   setActiveDeptId]   = useState("d1");
  const [viewType,       setViewType]       = useState<"week"|"maand">("week");
  const [useFTE,         setUseFTE]         = useState(true);
  const [printSize,      setPrintSize]      = useState<"A4"|"A3">("A4");
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [loading,        setLoading]        = useState(true);

  const today = new Date();
  const [weekStart,  setWeekStart]  = useState<Date>(() => startOfWeek(today));
  const [viewMonth,  setViewMonth]  = useState(today.getMonth());
  const [viewYear,   setViewYear]   = useState(today.getFullYear());

  const [vacModal,        setVacModal]        = useState<string|null>(null);
  const [vacModalMonth,   setVacModalMonth]   = useState(today.getMonth());
  const [vacModalYear,    setVacModalYear]    = useState(today.getFullYear());
  const [customShiftSlot, setCustomShiftSlot] = useState<{slotId:string;rowIdx:number}|null>(null);
  const [customStart,     setCustomStart]     = useState(8);
  const [customEnd,       setCustomEnd]       = useState(17);
  const [showCalcFor,     setShowCalcFor]     = useState<string|null>(null);

 
const currentUserId = "dc959614-bc92-482b-be5c-66b1d22ac424"; // De ID van de ingelogde gebruiker

const currentEmp = employees.find(e => e.id === currentUserId) || 
                   employees.find(e => e.isAdmin); // Fallback naar de eerste admin voor test-data/seed


const isAdmin = currentEmp?.isAdmin ?? false;


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
        if (dr.data?.length)  setDepts(dr.data.map((x:any) => ({id:x.id,name:x.name})));
        if (skr.data?.length) setSkills(skr.data.map((x:any) => ({id:x.id,name:x.name,criteria:x.criteria||""})));
        if (shr.data?.length) setShiftDefs(shr.data.map((x:any) => ({id:x.id,label:x.label,hours:x.hours||[]})));
        if (cr.data?.length)  setClients(cr.data.map((x:any) => ({id:x.id,name:x.name,departmentId:x.department_id,fteNeeded:x.fte_needed||1})));
        if (scr.data?.length) setSubcats(scr.data.map((x:any) => ({id:x.id,clientId:x.client_id,name:x.name,targetSkills:x.target_skills||[]})));
        if (er.data?.length)  setEmployees(er.data.map((x:any) => ({
          id:x.id, name:x.name, departmentId:x.department_id,
          hoursPerWeek:x.hours_per_week||40, mainClientId:x.main_client_id||"",
          subCatIds:x.sub_cat_ids||[], subCatSkills:x.sub_cat_skills||{},
          standardOffDays:x.standard_off_days||[], vacationDates:x.vacation_dates||[],
          defaultShiftId:x.default_shift_id||"", hourlyWage:x.hourly_wage||0,
          isAdmin:x.is_admin||false
        })));
        if (schr.data?.length) {
          const built: Record<string,SlotEntry> = {};
          schr.data.forEach((x:any) => { built[x.slot_id]={rows:x.rows||[]}; });
          setSchedule(built);
        }
        if (dr.data?.length) setActiveDeptId(dr.data[0].id);
      } catch(e) { console.warn("Supabase not configured, using seed data:", e); }
      setLoading(false);
    })();
  }, []);

  
  const _syncCell = useCallback(async (slotId: string, entry: SlotEntry) => {
    try { await sb.from("schedule").upsert({slot_id:slotId,rows:entry.rows,updated_at:new Date().toISOString()},{onConflict:"slot_id"}); }
    catch(e) { console.error("sync error",e); }
  }, []);
  const syncCell = useDebounce(_syncCell, 800);

  const _syncEmp = useCallback(async (emp: Employee) => {
    try {
      await sb.from("employees").upsert({
        id:emp.id, name:emp.name, department_id:emp.departmentId,
        hours_per_week:emp.hoursPerWeek, main_client_id:emp.mainClientId||null,
        sub_cat_ids:emp.subCatIds, sub_cat_skills:emp.subCatSkills,
        standard_off_days:emp.standardOffDays, vacation_dates:emp.vacationDates,
        default_shift_id:emp.defaultShiftId||null, hourly_wage:emp.hourlyWage||0,
        is_admin:emp.isAdmin||false
      },{onConflict:"id"});
    } catch(e) { console.error("emp sync error",e); }
  }, []);
  const syncEmployee = useDebounce(_syncEmp, 1000);

  function updSchedule(slotId: string, entry: SlotEntry) {
    setSchedule(prev => ({...prev,[slotId]:entry}));
    syncCell(slotId, entry);
  }
  function updEmployee(emp: Employee) {
    setEmployees(prev => prev.map(e => e.id===emp.id?emp:e));
    syncEmployee(emp);
  }

 
  function displayDates(): Date[] {
    if (viewType==="maand") return datesInMonth(viewMonth, viewYear);
    return Array.from({length:7}, (_,i) => { const d=new Date(weekStart); d.setDate(weekStart.getDate()+i); return d; });
  }
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
    const mx = emp.subCatSkills[sub.id]||{};
    const vals = sub.targetSkills.map(sid => { const v=mx[sid]; return (typeof v==="number"&&!isNaN(v))?v:0; });
    return Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
  }
  function getShift(shiftId: string): ShiftDef|undefined { return shiftDefs.find(s => s.id===shiftId); }

  /**
   * FTE BEREKENING:
   * 1 uniek persoon per dag = 1 FTE-dag.
   * We tellen hoeveel unieke persoon-dagen er zijn in de geselecteerde periode,
   * gedeeld door 5 werkdagen = FTE.
   */
  function fteForClient(clientId: string): number {
    const dates = displayDates();
    const csubs = subcats.filter(s => s.clientId===clientId);
    let uniquePersonDays = 0;
    dates.forEach(date => {
      const ds = fmtDate(date);
      const seen = new Set<string>();
      if (!csubs.length) {
        const e = schedule[`${ds}-client-${clientId}`];
        e?.rows?.forEach(r => { if (r.employeeId) seen.add(r.employeeId); });
      } else {
        csubs.forEach(sub => {
          const e = schedule[`${ds}-${sub.id}`];
          e?.rows?.forEach(r => { if (r.employeeId) seen.add(r.employeeId); });
        });
      }
      uniquePersonDays += seen.size;
    });
    // Normaliseer naar 5 werkdagen per week
    const workingDays = dates.filter(d => d.getDay()!==0 && d.getDay()!==6).length || 5;
    return uniquePersonDays / workingDays;
  }

  /**
   * KOSTENBEREKENING per slot:
   * Kosten worden verdeeld naar rato van gewerkte uren over klanten/subcats.
   */
  function kostenVoorSlot(slotId: string, rows?: SlotRow[]): number {
    const entry = rows ? {rows} : schedule[slotId];
    if (!entry?.rows) return 0;
    let total = 0;
    entry.rows.forEach(row => {
      const emp = employees.find(e => e.id===row.employeeId);
      if (!emp) return;
      total += nettoUren(row.selectedHours) * (emp.hourlyWage||0);
    });
    return total;
  }

  function geplandUrenDezePeriode(empId: string): number {
    const dates = displayDates(); let total = 0;
    dates.forEach(date => {
      const ds = fmtDate(date);
      Object.entries(schedule)
        .filter(([slotId]) => slotId.startsWith(ds))
        .forEach(([,entry]) => {
          entry.rows?.forEach(r => { if (r.employeeId===empId) total += nettoUren(r.selectedHours); });
        });
    });
    return total;
  }

  
  function runAutoPlanner() {
    const dates    = displayDates();
    const dClients = clients.filter(c => c.departmentId===activeDeptId);
    const dEmps    = employees.filter(e => e.departmentId===activeDeptId);
    const newSched = {...schedule};

    dates.forEach(date => {
      const ds = fmtDate(date);
      const usedToday: string[] = [];

      dClients.forEach(client => {
        const csubs = subcats.filter(s => s.clientId===client.id);
        const slots = csubs.length
          ? csubs.map(s => [`${ds}-${s.id}`, s] as [string, Subcategory])
          : [[`${ds}-client-${client.id}`, null] as [string, null]];

        slots.forEach(([slotId, sub]) => {
          if (newSched[slotId]?.rows?.length) return;

          const candidates = dEmps.filter(e => {
            if (!isAvail(e, date)) return false;
            if (usedToday.includes(e.id)) return false;
            if (sub && !e.subCatIds.includes(sub.id)) return false;
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
            newSched[slotId] = { rows:[{
              employeeId: emp.id,
              shiftId: chosenShift?.id || "sh2",
              selectedHours: chosenShift?.hours || defaultHours(emp)
            }]};
          }
        });
      });
    });

    setSchedule(newSched);
    Object.entries(newSched).forEach(([sid,e]) => syncCell(sid,e));
  }

  
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

  
  function vacCells(): (Date|null)[] {
    const dates = datesInMonth(vacModalMonth, vacModalYear);
    const offset = (() => { const fd=new Date(vacModalYear,vacModalMonth,1).getDay(); return fd===0?6:fd-1; })();
    const cells: (Date|null)[] = Array(offset).fill(null).concat(dates);
    while (cells.length%7!==0) cells.push(null);
    return cells;
  }

  
  function PlanningCell({ slotId, date, avail }: { slotId:string; date:Date; avail:Employee[] }) {
    const entry = schedule[slotId] || { rows:[] };

    // Filter al-gekozen medewerkers uit de dropdown van andere rijen
    function availForRow(rowIdx: number): Employee[] {
      const usedIds = entry.rows.filter((_,i) => i!==rowIdx).map(r => r.employeeId).filter(Boolean);
      return avail.filter(e => !usedIds.includes(e.id));
    }

    function isOverLimit(emp: Employee): boolean {
      return geplandUrenDezePeriode(emp.id) >= emp.hoursPerWeek;
    }

    function addRow() {
      if (entry.rows.length>=2) return;
      const used  = entry.rows.map(r => r.employeeId);
      const next  = avail.find(e => !used.includes(e.id));
      const sh    = (next?.defaultShiftId ? getShift(next.defaultShiftId) : undefined) || shiftDefs[1] || shiftDefs[0];
      const newRow: SlotRow = { employeeId:next?.id||"", shiftId:sh?.id||"sh2", selectedHours:next?(sh?.hours||defaultHours(next)):[] };
      updSchedule(slotId, {rows:[...entry.rows,newRow]});
    }
    function removeRow(i: number) { updSchedule(slotId, {rows:entry.rows.filter((_,ri) => ri!==i)}); }
    function setEmp(i: number, empId: string) {
      const emp = employees.find(e => e.id===empId);
      const sh  = (emp?.defaultShiftId ? getShift(emp.defaultShiftId) : undefined) || shiftDefs[1] || shiftDefs[0];
      const rows = [...entry.rows];
      rows[i] = {employeeId:empId, shiftId:sh?.id||"sh2", selectedHours:emp?(sh?.hours||defaultHours(emp)):[]};
      updSchedule(slotId, {rows});
    }
    function applyShift(i: number, shiftId: string) {
      if (shiftId==="custom") { setCustomShiftSlot({slotId,rowIdx:i}); return; }
      const sh = getShift(shiftId);
      const rows = [...entry.rows];
      rows[i] = {...rows[i], shiftId, selectedHours:sh?sh.hours:rows[i].selectedHours};
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
          const rowColor  = ri===0 ? "#3B82F6" : "#7C3AED";
          const emp       = employees.find(e => e.id===row.employeeId);
          const overLimit = emp ? isOverLimit(emp) : false;
          const netto     = nettoUren(row.selectedHours);
          const bruto     = row.selectedHours?.length || 0;
          return (
            <div key={ri} style={{ marginBottom:ri<entry.rows.length-1?"4px":0, borderBottom:ri<entry.rows.length-1?"1px dashed #1e293b":"none", paddingBottom:ri<entry.rows.length-1?"4px":0 }}>
              <div style={{ display:"flex", gap:"2px", marginBottom:"2px" }}>
                <select value={row.employeeId} onChange={e => setEmp(ri,e.target.value)}
                  style={{ flex:1, padding:"4px 3px", borderRadius:"4px", background:row.employeeId?rowColor:"#0f172a", color:"white", border:overLimit?"2px solid #EF4444":"1px solid #1e293b", fontSize:"11px", cursor:"pointer" }}>
                  <option value="">—</option>
                  {availForRow(ri).map(e => {
                    const ol = isOverLimit(e);
                    return <option key={e.id} value={e.id} style={{ color:ol?"#EF4444":"white" }}>{e.name}{ol?" ⚠":"" }</option>;
                  })}
                </select>
                <button onClick={() => removeRow(ri)} style={{ background:"#1e293b", border:"none", color:"#475569", borderRadius:"3px", width:"18px", cursor:"pointer", fontSize:"10px" }}>✕</button>
              </div>
              {overLimit && row.employeeId && (
                <div style={{ fontSize:"9px", color:"#EF4444", marginBottom:"2px", display:"flex", alignItems:"center", gap:"3px" }}>
                  <AlertTriangle size={9}/> Contracturen overschreden
                </div>
              )}
              {row.employeeId && (
                <div style={{ display:"flex", gap:"2px", marginBottom:"2px" }}>
                  {shiftDefs.map(sh => (
                    <button key={sh.id} onClick={() => applyShift(ri,sh.id)}
                      style={{ flex:1, padding:"2px 0", fontSize:"8px", border:"none", borderRadius:"3px", cursor:"pointer", background:row.shiftId===sh.id?"#F59E0B":"#1e293b", color:row.shiftId===sh.id?"#000":"#64748B", fontWeight:row.shiftId===sh.id?"bold":"normal" }}>
                      {sh.label}
                    </button>
                  ))}
                  <button onClick={() => applyShift(ri,"custom")}
                    style={{ flex:1, padding:"2px 0", fontSize:"8px", border:"none", borderRadius:"3px", cursor:"pointer", background:row.shiftId==="custom"?"#F59E0B":"#1e293b", color:row.shiftId==="custom"?"#000":"#64748B" }}>✏️</button>
                </div>
              )}
              <div style={{ display:"flex", gap:"1px", opacity:row.employeeId?1:0.25 }}>
                {WORK_HOURS.map(h => {
                  const on = row.selectedHours?.includes(h);
                  return <div key={h} onClick={() => row.employeeId && toggleHour(ri,h)} title={`${String(h).padStart(2,"0")}:00`}
                    style={{ flex:1, height:"11px", borderRadius:"1px", cursor:row.employeeId?"pointer":"default", background:on?(ri===0?"#10B981":"#A78BFA"):"#1e293b" }}/>;
                })}
              </div>
              {row.employeeId && (
                <div style={{ fontSize:"9px", textAlign:"right", color:"#475569", marginTop:"1px" }}>
                  {netto}u netto{bruto>=9 && <span style={{ color:"#F59E0B" }}> (−1u pauze)</span>}
                </div>
              )}
            </div>
          );
        })}
        {entry.rows.length<2 && (
          <button onClick={addRow} style={{ width:"100%", marginTop:"3px", padding:"2px", background:"none", border:"1px dashed #1e293b", color:"#475569", borderRadius:"3px", fontSize:"9px", cursor:"pointer" }}>
            + 2e persoon
          </button>
        )}
      </td>
    );
  }

  
  function TabFinancieel() {
    const dates    = displayDates();
    const allDates = viewType==="week" ? dates : dates;

    // Totale kosten per klant
    const kostenPerKlant: Record<string,{naam:string;kosten:number;subcats:Record<string,{naam:string;kosten:number;details:{empNaam:string;bruto:number;netto:number;loon:number;kosten:number}[]}>}> = {};

    clients.forEach(client => {
      const csubs = subcats.filter(s => s.clientId===client.id);
      kostenPerKlant[client.id] = { naam:client.name, kosten:0, subcats:{} };

      (csubs.length ? csubs : [{id:`client-${client.id}`,clientId:client.id,name:"Algemeen",targetSkills:[]}]).forEach(sub => {
        kostenPerKlant[client.id].subcats[sub.id] = { naam:sub.name, kosten:0, details:[] };

        allDates.forEach(date => {
          const slotId = `${fmtDate(date)}-${sub.id}`;
          const entry  = schedule[slotId];
          if (!entry?.rows) return;

          entry.rows.forEach(row => {
            const emp = employees.find(e => e.id===row.employeeId);
            if (!emp) return;
            const bruto = row.selectedHours?.length || 0;
            const netto = nettoUren(row.selectedHours);
            const kosten = netto * (emp.hourlyWage || 0);
            kostenPerKlant[client.id].kosten += kosten;
            kostenPerKlant[client.id].subcats[sub.id].kosten += kosten;
            kostenPerKlant[client.id].subcats[sub.id].details.push({
              empNaam:emp.name, bruto, netto, loon:emp.hourlyWage||0, kosten
            });
          });
        });
      });
    });

    const totalKosten = Object.values(kostenPerKlant).reduce((a,c) => a+c.kosten, 0);

    // Schatting maand/jaar (extrapoleer vanuit week)
    const weekFactor  = viewType==="week" ? 1 : allDates.length/7;
    const maandSchat  = (totalKosten / weekFactor) * (52/12);
    const jaarSchat   = (totalKosten / weekFactor) * 52;

    return (
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))", gap:"20px" }}>
        {/* KPI kaarten */}
        <div style={{ gridColumn:"1/-1", display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:"14px" }}>
          {[
            { label:"Deze periode", value:fmtEuro(totalKosten), icon:<Euro size={18}/>, color:"#3B82F6" },
            { label:"Schatting per maand", value:fmtEuro(maandSchat), icon:<TrendingUp size={18}/>, color:"#10B981" },
            { label:"Schatting per jaar",  value:fmtEuro(jaarSchat),  icon:<PieChart size={18}/>, color:"#8B5CF6" },
          ].map(kpi => (
            <div key={kpi.label} style={{ background:"#0f172a", border:"1px solid #1e293b", borderRadius:"14px", padding:"20px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"12px" }}>
                <div style={{ color:kpi.color }}>{kpi.icon}</div>
                <span style={{ fontSize:"12px", color:"#64748B", fontWeight:"600", letterSpacing:"0.04em" }}>{kpi.label.toUpperCase()}</span>
              </div>
              <div style={{ fontSize:"26px", fontWeight:"800", color:"white", letterSpacing:"-0.5px" }}>{kpi.value}</div>
            </div>
          ))}
        </div>

        {/* Looninvoer per medewerker */}
        <section style={{ background:"#0f172a", borderRadius:"14px", padding:"22px", border:"1px solid #1e293b" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"18px" }}>
            <Users size={17} color="#F59E0B"/>
            <h3 style={{ margin:0, color:"white", fontSize:"14px", fontWeight:"700" }}>Uurlonen beheren</h3>
          </div>
          {employees.map(emp => (
            <div key={emp.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:"#1e293b", borderRadius:"8px", padding:"10px 14px", marginBottom:"8px" }}>
              <div>
                <div style={{ fontSize:"13px", fontWeight:"600", color:"white" }}>{emp.name}</div>
                <div style={{ fontSize:"10px", color:"#64748B" }}>{depts.find(d=>d.id===emp.departmentId)?.name}</div>
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

          {Object.values(kostenPerKlant).map(clientData => (
            <div key={clientData.naam} style={{ marginBottom:"20px", background:"#1e293b", borderRadius:"10px", overflow:"hidden" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 16px", background:"#172033", borderBottom:"1px solid #0f172a" }}>
                <span style={{ fontWeight:"700", color:"#38BDF8", fontSize:"14px" }}>{clientData.naam}</span>
                <span style={{ fontWeight:"700", color:"white", fontSize:"15px" }}>{fmtEuro(clientData.kosten)}</span>
              </div>
              {Object.values(clientData.subcats).map(subData => (
                <div key={subData.naam}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 16px 10px 28px", borderBottom:"1px solid #0f172a" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                      <span style={{ color:"#64748B", fontSize:"11px" }}>↳</span>
                      <span style={{ color:"#94A3B8", fontSize:"13px" }}>{subData.naam}</span>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                      <span style={{ color:"#94A3B8", fontSize:"13px", fontWeight:"600" }}>{fmtEuro(subData.kosten)}</span>
                      <button onClick={() => setShowCalcFor(prev => prev===subData.naam?null:subData.naam)}
                        style={{ background:"#0f172a", border:"1px solid #334155", color:"#64748B", borderRadius:"5px", padding:"3px 8px", fontSize:"10px", cursor:"pointer", display:"flex", alignItems:"center", gap:"4px" }}>
                        {showCalcFor===subData.naam ? <EyeOff size={11}/> : <Eye size={11}/>}
                        Berekening
                      </button>
                    </div>
                  </div>
                  {showCalcFor===subData.naam && subData.details.length>0 && (
                    <div style={{ padding:"12px 28px", background:"rgba(0,0,0,0.2)", borderBottom:"1px solid #0f172a" }}>
                      {subData.details.map((d,i) => (
                        <div key={i} style={{ fontSize:"11px", color:"#64748B", marginBottom:"4px", fontFamily:"monospace" }}>
                          <span style={{ color:"#94A3B8" }}>{d.empNaam}</span>:&nbsp;
                          {d.bruto>0 && d.bruto!==d.netto ? (
                            <><span style={{ color:"#F59E0B" }}>{d.bruto} blokjes</span> − 1u pauze = <span style={{ color:"#10B981" }}>{d.netto}u</span></>
                          ) : (
                            <span style={{ color:"#10B981" }}>{d.netto}u</span>
                          )}
                          &nbsp;× {fmtEuro(d.loon)} = <span style={{ color:"white", fontWeight:"bold" }}>{fmtEuro(d.kosten)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </section>
      </div>
    );
  }

  
  function PrintView() {
    const allDates = displayDates();
    const weeks    = viewType==="maand" ? groupByWeek(allDates) : [allDates];
    return (
      <div className="print-wrap" style={{ display:"none" }}>
        {weeks.map((weekDates,wi) => (
          <div key={wi} className="pw-page">
            <div className="pw-header">
              <div>
                <div className="pw-title">{activeDept?.name} — Planning {MONTH_LABELS[viewMonth]} {viewYear}</div>
                <div className="pw-sub">
                  Week {weekNum(weekDates[0])}{weekDates.length>1&&` – ${weekNum(weekDates[weekDates.length-1])}`}
                  &nbsp;·&nbsp;{weekDates[0].toLocaleDateString("nl-NL",{day:"numeric",month:"short"})} –&nbsp;
                  {weekDates[weekDates.length-1].toLocaleDateString("nl-NL",{day:"numeric",month:"short",year:"numeric"})}
                </div>
              </div>
              <div className="pw-meta">
                <div>Gedrukt: {new Date().toLocaleDateString("nl-NL")}</div>
                <div>{activeDept?.name} · {deptEmployees.length} mw · {deptClients.length} klanten</div>
              </div>
            </div>
            <table className="pw-tbl">
              <thead>
                <tr>
                  <th className="col-label" style={{ textAlign:"left" }}>Klant / Taak</th>
                  {weekDates.map(date => {
                    const isWE = date.getDay()===0||date.getDay()===6;
                    return <th key={fmtDate(date)} className="col-day" style={{ color:isWE?"#fca5a5":"#f8fafc" }}>
                      {dayLabel(date).slice(0,2)} {date.getDate()}/{date.getMonth()+1}
                    </th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {deptClients.map(client => {
                  const csubs   = subcats.filter(s => s.clientId===client.id);
                  const fte     = fteForClient(client.id);
                  const fteDiff = fte - client.fteNeeded;
                  return (
                    <React.Fragment key={client.id}>
                      <tr className="client-hdr">
                        <td colSpan={weekDates.length+1}>
                          {client.name}
                          {useFTE && <span style={{ marginLeft:"10px", fontSize:"4.5pt", opacity:0.8 }}>
                            Doel: {client.fteNeeded} FTE · Ingepland: {fte.toFixed(2)} FTE
                            <span className={fteDiff>=0?"pw-fte-ok":"pw-fte-low"}> ({fteDiff>=0?"+":""}{fteDiff.toFixed(2)})</span>
                          </span>}
                        </td>
                      </tr>
                      {(csubs.length?csubs:[{id:`client-${client.id}`,clientId:client.id,name:"Algemeen",targetSkills:[]}]).map(sub => (
                        <tr key={sub.id} className="sub-row">
                          <td className="col-label">↳ {sub.name}</td>
                          {weekDates.map(date => {
                            const entry = schedule[`${fmtDate(date)}-${sub.id}`];
                            return (
                              <td key={fmtDate(date)} className="col-day">
                                {entry?.rows?.map((row,ri) => {
                                  const emp = employees.find(e => e.id===row.employeeId);
                                  if (!emp) return null;
                                  const minH = row.selectedHours?.length ? Math.min(...row.selectedHours) : "?";
                                  const maxH = row.selectedHours?.length ? Math.max(...row.selectedHours)+1 : "?";
                                  return (
                                    <div key={ri} style={{ borderBottom:ri<(entry.rows.length-1)?"1px dashed #ccc":"none", paddingBottom:"1px", marginBottom:"1px" }}>
                                      <div className={`pw-emp${ri>0?" pw-emp2":""}`}>{emp.name}</div>
                                      <div className="pw-hrs">
                                        {String(minH).padStart(2,"0")}–{String(maxH).padStart(2,"0")}
                                        <span className="pw-badge">{nettoUren(row.selectedHours)}u</span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    );
  }


  function VacationModal() {
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
      <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center" }} onClick={() => setVacModal(null)}>
        <div onClick={e=>e.stopPropagation()} style={{ background:"#0f172a",borderRadius:"16px",padding:"28px",width:"520px",maxWidth:"95vw",border:"1px solid #1e293b",boxShadow:"0 25px 80px rgba(0,0,0,0.7)" }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"20px" }}>
            <div>
              <div style={{ fontSize:"18px",fontWeight:"bold",color:"white" }}>🌴 Vakantie & Vrije Dagen</div>
              <div style={{ fontSize:"12px",color:"#64748B",marginTop:"2px" }}>{emp.name}</div>
            </div>
            <button onClick={() => setVacModal(null)} style={{ background:"#1e293b",border:"none",color:"white",borderRadius:"8px",padding:"6px 14px",cursor:"pointer" }}>✕</button>
          </div>
          <div style={{ marginBottom:"16px",background:"#1e293b",borderRadius:"10px",padding:"14px" }}>
            <div style={{ fontSize:"11px",color:"#F59E0B",fontWeight:"bold",marginBottom:"8px" }}>VASTE VRIJE DAGEN (WEKELIJKS)</div>
            <div style={{ display:"flex",flexWrap:"wrap",gap:"6px" }}>
              {DAY_LABELS.map(day => {
                const isOff = emp.standardOffDays.includes(day);
                return <button key={day} onClick={() => toggleOff(day)}
                  style={{ padding:"5px 12px",borderRadius:"20px",border:"none",fontSize:"12px",cursor:"pointer",background:isOff?"#EF4444":"#334155",color:isOff?"white":"#94A3B8",fontWeight:isOff?"bold":"normal" }}>
                  {day.slice(0,2)}</button>;
              })}
            </div>
          </div>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px" }}>
            <button onClick={() => { if(vacModalMonth===0){setVacModalMonth(11);setVacModalYear(y=>y-1);}else setVacModalMonth(m=>m-1); }}
              style={{ background:"#1e293b",border:"none",color:"white",borderRadius:"6px",padding:"5px 14px",cursor:"pointer" }}>‹</button>
            <span style={{ fontWeight:"bold",color:"white" }}>{MONTH_LABELS[vacModalMonth]} {vacModalYear}</span>
            <button onClick={() => { if(vacModalMonth===11){setVacModalMonth(0);setVacModalYear(y=>y+1);}else setVacModalMonth(m=>m+1); }}
              style={{ background:"#1e293b",border:"none",color:"white",borderRadius:"6px",padding:"5px 14px",cursor:"pointer" }}>›</button>
          </div>
          <div style={{ background:"#1e293b",borderRadius:"10px",padding:"12px" }}>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"4px",marginBottom:"6px" }}>
              {["Ma","Di","Wo","Do","Vr","Za","Zo"].map(d => <div key={d} style={{ textAlign:"center",fontSize:"10px",color:"#64748B",fontWeight:"bold",padding:"4px 0" }}>{d}</div>)}
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"4px" }}>
              {cells.map((date,i) => {
                if (!date) return <div key={i}/>;
                const ds = fmtDate(date); const dl = dayLabel(date);
                const isStd = emp.standardOffDays.includes(dl);
                const isVac = emp.vacationDates.includes(ds);
                let bg="#1e293b", col="#94A3B8", lbl="";
                if (isStd) { bg="#7C3AED22"; col="#7C3AED"; lbl="V"; }
                if (isVac) { bg="#F59E0B";   col="white";   lbl="🌴"; }
                return <div key={ds} onClick={() => !isStd && toggleVac(ds)}
                  style={{ textAlign:"center",padding:"6px 2px",borderRadius:"6px",fontSize:"12px",cursor:isStd?"not-allowed":"pointer",background:bg,color:col,fontWeight:isVac?"bold":"normal",userSelect:"none" }}>
                  <div>{date.getDate()}</div>
                  {lbl && <div style={{ fontSize:"9px" }}>{lbl}</div>}
                </div>;
              })}
            </div>
          </div>
          <div style={{ display:"flex",gap:"16px",marginTop:"12px",fontSize:"10px",color:"#64748B" }}>
            <span><span style={{ color:"#7C3AED" }}>■</span> Vaste vrije dag</span>
            <span><span style={{ color:"#F59E0B" }}>■</span> Vakantie</span>
            <span style={{ marginLeft:"auto" }}>Totaal: <strong style={{ color:"white" }}>{emp.vacationDates.length} dagen</strong></span>
          </div>
        </div>
      </div>
    );
  }

  
  function CustomShiftModal() {
    if (!customShiftSlot) return null;
    const {slotId,rowIdx} = customShiftSlot;
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
      <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center" }} onClick={() => setCustomShiftSlot(null)}>
        <div onClick={e=>e.stopPropagation()} style={{ background:"#0f172a",borderRadius:"12px",padding:"24px",width:"300px",border:"1px solid #1e293b" }}>
          <div style={{ fontSize:"16px",fontWeight:"bold",color:"white",marginBottom:"20px" }}>✏️ Custom Shift</div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px",marginBottom:"16px" }}>
            <div>
              <label style={{ fontSize:"11px",color:"#64748B",display:"block",marginBottom:"4px" }}>BEGINTIJD</label>
              <select value={customStart} onChange={e => setCustomStart(Number(e.target.value))}
                style={{ width:"100%",background:"#1e293b",color:"white",border:"1px solid #334155",borderRadius:"6px",padding:"8px" }}>
                {WORK_HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:"11px",color:"#64748B",display:"block",marginBottom:"4px" }}>EINDTIJD</label>
              <select value={customEnd} onChange={e => setCustomEnd(Number(e.target.value))}
                style={{ width:"100%",background:"#1e293b",color:"white",border:"1px solid #334155",borderRadius:"6px",padding:"8px" }}>
                {WORK_HOURS.filter(h => h>customStart).map(h => <option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}
              </select>
            </div>
          </div>
          <div style={{ background:"#1e293b",borderRadius:"6px",padding:"10px",marginBottom:"16px",fontSize:"11px",color:"#64748B",fontFamily:"monospace" }}>
            {bruto >= 9 ? <>{bruto} blokjes − 1u pauze = <span style={{ color:"#10B981" }}>{netto}u netto</span></> : <span style={{ color:"#10B981" }}>{netto}u (geen pauze)</span>}
          </div>
          <div style={{ display:"flex",gap:"8px" }}>
            <button onClick={() => setCustomShiftSlot(null)} style={{ flex:1,padding:"9px",background:"#1e293b",border:"none",color:"white",borderRadius:"8px",cursor:"pointer" }}>Annuleer</button>
            <button onClick={apply} style={{ flex:1,padding:"9px",background:"#F59E0B",border:"none",color:"black",borderRadius:"8px",cursor:"pointer",fontWeight:"bold" }}>✓ Toepassen</button>
          </div>
        </div>
      </div>
    );
  }

  
  function PrintModal() {
    return (
      <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center" }} onClick={() => setShowPrintModal(false)}>
        <div onClick={e=>e.stopPropagation()} style={{ background:"#0f172a",borderRadius:"16px",padding:"28px",width:"360px",border:"1px solid #1e293b" }}>
          <h3 style={{ margin:"0 0 20px 0",color:"white" }}>🖨️ Planning Printen</h3>
          <div style={{ display:"flex",gap:"10px",marginBottom:"20px" }}>
            {(["A4","A3"] as const).map(sz => (
              <button key={sz} onClick={() => setPrintSize(sz)}
                style={{ flex:1,padding:"12px",border:"2px solid",borderColor:printSize===sz?"#3B82F6":"#334155",background:printSize===sz?"#1d4ed8":"#0f172a",color:"white",borderRadius:"8px",cursor:"pointer",fontWeight:"bold" }}>
                {sz}
              </button>
            ))}
          </div>
          <div style={{ display:"flex",gap:"10px" }}>
            <button onClick={() => setShowPrintModal(false)} style={{ flex:1,padding:"10px",background:"#1e293b",border:"none",color:"white",borderRadius:"8px",cursor:"pointer" }}>Annuleer</button>
            <button onClick={() => { setShowPrintModal(false); setTimeout(handlePrint,150); }}
              style={{ flex:1,padding:"10px",background:"#3B82F6",border:"none",color:"white",borderRadius:"8px",cursor:"pointer",fontWeight:"bold" }}>
              🖨️ Print {printSize}
            </button>
          </div>
        </div>
      </div>
    );
  }

 
  function TabPlanning() {
    const dates = displayDates();
    return (
      <div style={{ background:"rgba(255,255,255,0.01)", borderRadius:"12px", overflowX:"auto", padding:"16px" }}>
        <div style={{ display:"flex", gap:"10px", alignItems:"center", flexWrap:"wrap", marginBottom:"14px" }}>
          <button onClick={prevPeriod} style={{ background:"#1e293b",border:"none",color:"white",borderRadius:"8px",padding:"7px 12px",cursor:"pointer",display:"flex",alignItems:"center" }}><ChevronLeft size={16}/></button>
          <div style={{ fontWeight:"700",color:"white",minWidth:"200px",textAlign:"center",fontSize:"14px" }}>
            {viewType==="week"
              ? `Week ${weekNum(weekStart)} · ${weekStart.toLocaleDateString("nl-NL",{day:"numeric",month:"short"})} – ${new Date(weekStart.getTime()+6*86400000).toLocaleDateString("nl-NL",{day:"numeric",month:"short",year:"numeric"})}`
              : `${MONTH_LABELS[viewMonth]} ${viewYear}`
            }
          </div>
          <button onClick={nextPeriod} style={{ background:"#1e293b",border:"none",color:"white",borderRadius:"8px",padding:"7px 12px",cursor:"pointer",display:"flex",alignItems:"center" }}><ChevronRight size={16}/></button>
          {viewType==="maand" && (
            <>
              <select value={viewYear} onChange={e => setViewYear(Number(e.target.value))} style={{ background:"#1e293b",color:"white",padding:"7px 10px",borderRadius:"8px",border:"none" }}>
                {[2024,2025,2026,2027,2028].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <select value={viewMonth} onChange={e => setViewMonth(Number(e.target.value))} style={{ background:"#1e293b",color:"white",padding:"7px 10px",borderRadius:"8px",border:"none" }}>
                {MONTH_LABELS.map((m,i) => <option key={m} value={i}>{m}</option>)}
              </select>
            </>
          )}
          <div style={{ background:"#1e293b",padding:"3px",borderRadius:"8px",display:"flex" }}>
            <button onClick={() => { setViewType("week"); setWeekStart(startOfWeek(new Date())); }}
              style={{ background:viewType==="week"?"#3B82F6":"transparent",border:"none",color:"white",padding:"5px 14px",borderRadius:"6px",cursor:"pointer",fontWeight:viewType==="week"?"700":"400" }}>Week</button>
            <button onClick={() => setViewType("maand")}
              style={{ background:viewType==="maand"?"#3B82F6":"transparent",border:"none",color:"white",padding:"5px 14px",borderRadius:"6px",cursor:"pointer",fontWeight:viewType==="maand"?"700":"400" }}>Maand</button>
          </div>
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:"6px", fontSize:"10px", color:"#475569" }}>
            <span style={{ color:"#10B981" }}>■</span> 1e &nbsp;<span style={{ color:"#A78BFA" }}>■</span> 2e
          </div>
        </div>

        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign:"left",padding:"8px 10px",color:"#475569",minWidth:"180px",position:"sticky",left:0,background:"#020617",zIndex:2,fontSize:"11px",fontWeight:"700",letterSpacing:"0.06em" }}>KLANT / TAAK</th>
              {dates.map(date => {
                const dl = dayLabel(date); const isWE = date.getDay()===0||date.getDay()===6;
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
                        {useFTE && (
                          <div style={{ display:"flex",alignItems:"center",gap:"8px",fontSize:"11px" }}>
                            <span style={{ color:"#475569" }}>Doel FTE:
                              <input type="number" step="0.5" value={client.fteNeeded}
                                onChange={e => setClients(prev => prev.map(c => c.id===client.id?{...c,fteNeeded:parseFloat(e.target.value)||0}:c))}
                                style={{ width:"45px",background:"#1e293b",color:"white",border:"1px solid #334155",borderRadius:"4px",padding:"1px 4px",marginLeft:"4px" }}/>
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
                  {(csubs.length?csubs:[{id:`client-${client.id}`,clientId:client.id,name:"Algemeen",targetSkills:[]}]).map(sub => (
                    <tr key={sub.id}>
                      <td style={{ padding:"8px 12px 8px 26px",fontSize:"12px",color:"#64748B",position:"sticky",left:0,background:"#020617",verticalAlign:"top",borderBottom:"1px solid #0a0f1a" }}>
                        ↳ {sub.name}
                        {sub.targetSkills.length>0 && (
                          <div style={{ fontSize:"9px",color:"#334155",marginTop:"2px" }}>
                            {sub.targetSkills.map(sid => skills.find(s => s.id===sid)?.name).filter(Boolean).join(", ")}
                          </div>
                        )}
                      </td>
                      {dates.map(date => {
                        const slotId = sub.id.startsWith("client-") ? `${fmtDate(date)}-${sub.id}` : `${fmtDate(date)}-${sub.id}`;
                        const avail  = deptEmployees.filter(e => isAvail(e,date)&&(sub.targetSkills.length===0||e.subCatIds.includes(sub.id)));
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


  function TabMedewerkers() {
    return (
      <div style={{ background:"#0f172a",borderRadius:"12px",padding:"20px",border:"1px solid #1e293b" }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"20px" }}>
          <h3 style={{ margin:0,color:"white",fontWeight:"700" }}>Medewerkers — {activeDept?.name}</h3>
          <button onClick={() => {
            const emp: Employee = { id:"e"+Date.now(), name:"Nieuwe medewerker", departmentId:activeDeptId,
              hoursPerWeek:40, mainClientId:"", subCatIds:[], subCatSkills:{},
              standardOffDays:["Zaterdag","Zondag"], vacationDates:[], defaultShiftId:"", hourlyWage:0, isAdmin:false };
            setEmployees(prev => [...prev,emp]);
          }} style={{ background:"#3B82F6",border:"none",color:"white",padding:"8px 16px",borderRadius:"8px",cursor:"pointer",fontWeight:"700",display:"flex",alignItems:"center",gap:"6px" }}>
            <Plus size={14}/> Toevoegen
          </button>
        </div>

        {deptEmployees.length===0 && <div style={{ color:"#334155",textAlign:"center",padding:"40px" }}>Geen medewerkers. Klik op + Toevoegen.</div>}

        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(360px,1fr))",gap:"20px" }}>
          {deptEmployees.map(emp => {
            const gepland = geplandUrenDezePeriode(emp.id);
            const pct     = Math.min(100, Math.round(gepland/emp.hoursPerWeek*100));
            const over    = gepland > emp.hoursPerWeek;
            return (
              <div key={emp.id} style={{ background:"#1e293b",borderRadius:"12px",padding:"18px",border:"1px solid #334155" }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"12px" }}>
                  <input value={emp.name} onChange={e => updEmployee({...emp,name:e.target.value})}
                    style={{ background:"none",border:"none",color:"white",fontSize:"16px",fontWeight:"700",flex:1,outline:"none" }}/>
                  <div style={{ display:"flex",gap:"6px" }}>
                    <button onClick={() => { setVacModalMonth(viewMonth);setVacModalYear(viewYear);setVacModal(emp.id); }}
                      style={{ background:"#F59E0B",color:"white",border:"none",padding:"5px 10px",borderRadius:"6px",fontSize:"11px",cursor:"pointer" }}>🌴</button>
                    <button onClick={() => { if(window.confirm("Medewerker verwijderen?")) setEmployees(prev => prev.filter(e => e.id!==emp.id)); }}
                      style={{ background:"none",border:"none",color:"#EF4444",cursor:"pointer" }}><Trash2 size={16}/></button>
                  </div>
                </div>

                {/* Urenbalk */}
                <div style={{ background:"#0f172a",borderRadius:"6px",padding:"8px",marginBottom:"12px" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",fontSize:"10px",marginBottom:"4px" }}>
                    <span style={{ color:"#64748B" }}>Ingepland deze periode</span>
                    <span style={{ color:over?"#EF4444":"#10B981",fontWeight:"700" }}>{gepland}u / {emp.hoursPerWeek}u</span>
                  </div>
                  <div style={{ height:"4px",background:"#334155",borderRadius:"2px",overflow:"hidden" }}>
                    <div style={{ width:`${pct}%`,height:"100%",background:over?"#EF4444":"#10B981",transition:"width 0.3s" }}/>
                  </div>
                </div>

                <div style={{ display:"flex",gap:"10px",flexWrap:"wrap",marginBottom:"12px" }}>
                  {[
                    { label:"UREN/WEEK", content: <input type="number" value={emp.hoursPerWeek} onChange={e => updEmployee({...emp,hoursPerWeek:Number(e.target.value)})} style={{ width:"60px",background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:"4px",padding:"4px 5px" }}/> },
                    { label:"HOOFD KLANT", content: <select value={emp.mainClientId} onChange={e => updEmployee({...emp,mainClientId:e.target.value})} style={{ background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:"4px",padding:"4px 6px" }}>
                      <option value="">Geen</option>{deptClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select> },
                    { label:"STANDAARD SHIFT", content: <select value={emp.defaultShiftId||""} onChange={e => updEmployee({...emp,defaultShiftId:e.target.value})} style={{ background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:"4px",padding:"4px 6px" }}>
                      <option value="">Geen</option>{shiftDefs.map(sh => <option key={sh.id} value={sh.id}>{sh.label}</option>)}
                    </select> },
                    { label:"AFDELING", content: <select value={emp.departmentId} onChange={e => updEmployee({...emp,departmentId:e.target.value})} style={{ background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:"4px",padding:"4px 6px" }}>
                      {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select> },
                  ].map(({label,content}) => (
                    <div key={label}>
                      <label style={{ fontSize:"9px",color:"#64748B",display:"block",marginBottom:"3px",fontWeight:"700",letterSpacing:"0.06em" }}>{label}</label>
                      {content}
                    </div>
                  ))}
                </div>

                {/* Vrije dagen */}
                <div style={{ background:"#0f172a",borderRadius:"6px",padding:"8px",marginBottom:"12px" }}>
                  <div style={{ fontSize:"9px",color:"#F59E0B",fontWeight:"700",marginBottom:"6px",letterSpacing:"0.06em" }}>VASTE VRIJE DAGEN</div>
                  <div style={{ display:"flex",gap:"4px",flexWrap:"wrap" }}>
                    {DAY_LABELS.map(day => {
                      const isOff = emp.standardOffDays.includes(day);
                      return <button key={day} onClick={() => updEmployee({...emp,standardOffDays:isOff?emp.standardOffDays.filter(d=>d!==day):[...emp.standardOffDays,day]})}
                        style={{ padding:"3px 8px",borderRadius:"12px",border:"none",fontSize:"10px",cursor:"pointer",background:isOff?"#EF4444":"#334155",color:isOff?"white":"#64748B" }}>
                        {day.slice(0,2)}</button>;
                    })}
                  </div>
                </div>

                {/* Subcategorieën */}
                <div style={{ borderTop:"1px solid #334155",paddingTop:"10px",marginBottom:"10px" }}>
                  <div style={{ fontSize:"9px",color:"#64748B",marginBottom:"6px",fontWeight:"700",letterSpacing:"0.06em" }}>TAKEN / SUBCATEGORIEËN</div>
                  {deptClients.map(client => {
                    const csubs = subcats.filter(s => s.clientId===client.id);
                    if (!csubs.length) return null;
                    return (
                      <div key={client.id} style={{ background:"#0f172a",borderRadius:"4px",padding:"6px",marginBottom:"4px" }}>
                        <div style={{ fontSize:"10px",fontWeight:"700",color:"#38BDF8",marginBottom:"4px" }}>{client.name}</div>
                        <div style={{ display:"flex",flexWrap:"wrap",gap:"4px" }}>
                          {csubs.map(sub => {
                            const has = emp.subCatIds.includes(sub.id);
                            return <button key={sub.id} onClick={() => {
                              const newIds = has?emp.subCatIds.filter(id=>id!==sub.id):[...emp.subCatIds,sub.id];
                              const newMx  = {...emp.subCatSkills};
                              if (!has) { const ex=newMx[sub.id]||{}; const init:Record<string,number>={}; skills.forEach(s=>{init[s.id]=ex[s.id]??0;}); newMx[sub.id]=init; }
                              updEmployee({...emp,subCatIds:newIds,subCatSkills:newMx});
                            }} style={{ fontSize:"9px",padding:"3px 7px",borderRadius:"10px",border:"none",background:has?"#10B981":"#334155",color:"white",cursor:"pointer" }}>{sub.name}</button>;
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Skill matrix */}
                {emp.subCatIds.length>0 && (
                  <div style={{ borderTop:"1px solid #334155",paddingTop:"10px" }}>
                    <div style={{ fontSize:"9px",color:"#F59E0B",fontWeight:"700",marginBottom:"8px",letterSpacing:"0.06em" }}>SKILL MATRIX</div>
                    {emp.subCatIds.map(subId => {
                      const sub    = subcats.find(s => s.id===subId);
                      const client = sub ? clients.find(c => c.id===sub.clientId) : null;
                      if (!sub||!sub.targetSkills.length) return null;
                      return (
                        <div key={subId} style={{ background:"#0f172a",borderRadius:"6px",padding:"8px",marginBottom:"6px" }}>
                          <div style={{ fontSize:"11px",fontWeight:"700",color:"#38BDF8",marginBottom:"6px" }}>{client?.name} – {sub.name}</div>
                          {sub.targetSkills.map(skillId => {
                            const sk  = skills.find(s => s.id===skillId); if (!sk) return null;
                            const raw = emp.subCatSkills[subId]?.[skillId];
                            const val = typeof raw==="number"&&!isNaN(raw)?raw:0;
                            return (
                              <div key={skillId} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:"11px",marginBottom:"4px",background:"#1e293b",padding:"4px 7px",borderRadius:"4px" }}>
                                <span title={sk.criteria} style={{ cursor:"help",borderBottom:"1px dotted #475569" }}>{sk.name}</span>
                                <div style={{ display:"flex",alignItems:"center",gap:"6px" }}>
                                  <div style={{ width:"55px",height:"4px",background:"#334155",borderRadius:"2px",overflow:"hidden" }}>
                                    <div style={{ width:`${val}%`,height:"100%",background:val>=80?"#10B981":val>=50?"#F59E0B":"#EF4444",transition:"width 0.3s" }}/>
                                  </div>
                                  <input type="number" value={val} min={0} max={100}
                                    onChange={e => {
                                      const v = Math.min(100,Math.max(0,Number(e.target.value)));
                                      const nm = {...(emp.subCatSkills[subId]||{}),[skillId]:v};
                                      updEmployee({...emp,subCatSkills:{...emp.subCatSkills,[subId]:nm}});
                                    }}
                                    style={{ width:"40px",background:"transparent",color:"white",border:"1px solid #334155",borderRadius:"3px",padding:"2px",textAlign:"center",fontSize:"10px" }}/>
                                  <span style={{ color:"#64748B",fontSize:"10px" }}>%</span>
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

 
  function TabBeheer() {
    return (
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))",gap:"20px" }}>
        {/* Afdelingen */}
        <section style={{ background:"#0f172a",borderRadius:"12px",padding:"20px",border:"1px solid #1e293b" }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px" }}>
            <div style={{ display:"flex",alignItems:"center",gap:"8px" }}><Building2 size={15} color="#3B82F6"/><h3 style={{ margin:0,color:"white",fontSize:"14px",fontWeight:"700" }}>Afdelingen</h3></div>
            <button onClick={() => { const n=prompt("Naam nieuwe afdeling?"); if(n) setDepts(prev=>[...prev,{id:"d"+Date.now(),name:n}]); }}
              style={{ background:"#3B82F6",border:"none",color:"white",padding:"5px 10px",borderRadius:"6px",cursor:"pointer",fontSize:"12px",display:"flex",alignItems:"center",gap:"4px" }}><Plus size={11}/>Nieuw</button>
          </div>
          {depts.map(d => (
            <div key={d.id} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",background:"#1e293b",borderRadius:"6px",padding:"8px 12px",marginBottom:"5px" }}>
              <input value={d.name} onChange={e => setDepts(prev => prev.map(x => x.id===d.id?{...x,name:e.target.value}:x))} style={{ background:"none",border:"none",color:"white",flex:1,outline:"none" }}/>
              {depts.length>1 && <button onClick={() => { if(window.confirm("Afdeling verwijderen?")) setDepts(prev => prev.filter(x => x.id!==d.id)); }} style={{ background:"none",border:"none",color:"#EF4444",cursor:"pointer" }}><Trash2 size={14}/></button>}
            </div>
          ))}
        </section>

        {/* Skills */}
        <section style={{ background:"#0f172a",borderRadius:"12px",padding:"20px",border:"1px solid #1e293b" }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px" }}>
            <div style={{ display:"flex",alignItems:"center",gap:"8px" }}><Zap size={15} color="#8B5CF6"/><h3 style={{ margin:0,color:"white",fontSize:"14px",fontWeight:"700" }}>Skills & Criteria</h3></div>
            <button onClick={() => {
              const n=prompt("Naam nieuwe skill?"); if (!n) return;
              const ns: Skill = {id:"s"+Date.now(),name:n,criteria:""};
              setSkills(prev => [...prev,ns]);
              setEmployees(prev => prev.map(emp => {
                const nm={...emp.subCatSkills};
                emp.subCatIds.forEach(subId => { nm[subId]={...(nm[subId]||{}),[ns.id]:0}; });
                return {...emp,subCatSkills:nm};
              }));
            }} style={{ background:"#8B5CF6",border:"none",color:"white",padding:"5px 10px",borderRadius:"6px",cursor:"pointer",fontSize:"12px",display:"flex",alignItems:"center",gap:"4px" }}><Plus size={11}/>Skill</button>
          </div>
          {skills.map(s => (
            <div key={s.id} style={{ background:"#1e293b",borderRadius:"8px",padding:"10px",marginBottom:"8px" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"6px" }}>
                <input value={s.name} onChange={e => setSkills(prev => prev.map(x => x.id===s.id?{...x,name:e.target.value}:x))} style={{ background:"none",border:"none",color:"white",fontWeight:"700",fontSize:"13px",flex:1,outline:"none" }}/>
                <button onClick={() => { if(window.confirm("Skill verwijderen?")) setSkills(prev => prev.filter(x => x.id!==s.id)); }} style={{ background:"none",border:"none",color:"#EF4444",cursor:"pointer" }}><Trash2 size={14}/></button>
              </div>
              <textarea value={s.criteria} onChange={e => setSkills(prev => prev.map(x => x.id===s.id?{...x,criteria:e.target.value}:x))}
                placeholder="Vereisten voor 100%..." rows={2}
                style={{ width:"100%",background:"#0f172a",color:"#64748B",border:"1px solid #334155",borderRadius:"4px",fontSize:"11px",padding:"6px",resize:"vertical",boxSizing:"border-box" }}/>
            </div>
          ))}
        </section>

        {/* Klanten */}
        <section style={{ background:"#0f172a",borderRadius:"12px",padding:"20px",border:"1px solid #1e293b",gridColumn:"1/-1" }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px" }}>
            <div style={{ display:"flex",alignItems:"center",gap:"8px" }}><Users size={15} color="#10B981"/><h3 style={{ margin:0,color:"white",fontSize:"14px",fontWeight:"700" }}>Klanten & Subcategorieën ({activeDept?.name})</h3></div>
            <button onClick={() => { const n=prompt("Naam nieuwe klant?"); if(n) setClients(prev=>[...prev,{id:"c"+Date.now(),name:n,departmentId:activeDeptId,fteNeeded:1}]); }}
              style={{ background:"#10B981",border:"none",color:"white",padding:"7px 14px",borderRadius:"8px",cursor:"pointer",fontWeight:"700",display:"flex",alignItems:"center",gap:"6px" }}><Plus size={14}/>Klant</button>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:"14px" }}>
            {deptClients.map(client => {
              const csubs = subcats.filter(s => s.clientId===client.id);
              return (
                <div key={client.id} style={{ background:"#1e293b",borderRadius:"10px",padding:"14px",borderLeft:"3px solid #38BDF8" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px" }}>
                    <input value={client.name} onChange={e => setClients(prev => prev.map(c => c.id===client.id?{...c,name:e.target.value}:c))} style={{ background:"none",border:"none",color:"white",fontWeight:"700",fontSize:"14px",flex:1,outline:"none" }}/>
                    <button onClick={() => { if(window.confirm("Klant + subcategorieën verwijderen?")){ setClients(prev => prev.filter(c => c.id!==client.id)); setSubcats(prev => prev.filter(s => s.clientId!==client.id)); } }} style={{ background:"none",border:"none",color:"#EF4444",cursor:"pointer" }}><Trash2 size={14}/></button>
                  </div>
                  <div style={{ marginBottom:"10px" }}>
                    <label style={{ fontSize:"9px",color:"#64748B",display:"block",marginBottom:"3px",fontWeight:"700",letterSpacing:"0.06em" }}>FTE DOEL</label>
                    <input type="number" step="0.5" value={client.fteNeeded} onChange={e => setClients(prev => prev.map(c => c.id===client.id?{...c,fteNeeded:parseFloat(e.target.value)||0}:c))}
                      style={{ width:"70px",background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:"4px",padding:"4px 6px" }}/>
                  </div>
                  {csubs.map(sub => (
                    <div key={sub.id} style={{ background:"#0f172a",borderRadius:"6px",padding:"8px",marginBottom:"6px" }}>
                      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"6px" }}>
                        <input value={sub.name} onChange={e => setSubcats(prev => prev.map(s => s.id===sub.id?{...s,name:e.target.value}:s))} style={{ background:"none",border:"none",color:"#94A3B8",fontWeight:"700",fontSize:"12px",flex:1,outline:"none" }}/>
                        <button onClick={() => setSubcats(prev => prev.filter(s => s.id!==sub.id))} style={{ background:"none",border:"none",color:"#EF4444",cursor:"pointer",fontSize:"11px" }}>✕</button>
                      </div>
                      <div style={{ fontSize:"9px",color:"#475569",marginBottom:"5px",letterSpacing:"0.06em",fontWeight:"700" }}>VEREISTE SKILLS:</div>
                      <div style={{ display:"flex",flexWrap:"wrap",gap:"4px" }}>
                        {skills.map(s => {
                          const has = sub.targetSkills.includes(s.id);
                          return <button key={s.id} onClick={() => { const nt=has?sub.targetSkills.filter(x=>x!==s.id):[...sub.targetSkills,s.id]; setSubcats(prev => prev.map(sc => sc.id===sub.id?{...sc,targetSkills:nt}:sc)); }} title={s.criteria}
                            style={{ fontSize:"9px",padding:"3px 8px",borderRadius:"10px",cursor:"pointer",border:has?"1px solid #8B5CF6":"1px solid #334155",background:has?"#8B5CF6":"transparent",color:has?"white":"#475569" }}>
                            {has?"✓ ":""}{s.name}
                          </button>;
                        })}
                        {skills.length===0 && <span style={{ fontSize:"9px",color:"#334155" }}>Maak eerst skills aan ↑</span>}
                      </div>
                    </div>
                  ))}
                  <button onClick={() => { const n=prompt("Naam subcategorie?"); if(n) setSubcats(prev=>[...prev,{id:"sub"+Date.now(),clientId:client.id,name:n,targetSkills:[]}]); }}
                    style={{ width:"100%",padding:"5px",background:"none",border:"1px dashed #334155",color:"#64748B",borderRadius:"4px",fontSize:"11px",cursor:"pointer",marginTop:"4px" }}>
                    + Subcategorie
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Shift Definities */}
        <section style={{ background:"#0f172a",borderRadius:"12px",padding:"20px",border:"1px solid #1e293b" }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px" }}>
            <div style={{ display:"flex",alignItems:"center",gap:"8px" }}><Clock size={15} color="#F59E0B"/><h3 style={{ margin:0,color:"white",fontSize:"14px",fontWeight:"700" }}>Shift Definities</h3></div>
            <button onClick={() => { const label=prompt("Naam shift (bv. 06–15)?"); if(!label) return; setShiftDefs(prev=>[...prev,{id:"sh"+Date.now(),label,hours:[]}]); }}
              style={{ background:"#F59E0B",border:"none",color:"black",padding:"5px 10px",borderRadius:"6px",cursor:"pointer",fontSize:"12px",fontWeight:"700",display:"flex",alignItems:"center",gap:"4px" }}><Plus size={11}/>Shift</button>
          </div>
          {shiftDefs.map(sh => (
            <div key={sh.id} style={{ background:"#1e293b",borderRadius:"8px",padding:"12px",marginBottom:"8px" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px" }}>
                <input value={sh.label} onChange={e => setShiftDefs(prev => prev.map(x => x.id===sh.id?{...x,label:e.target.value}:x))} style={{ background:"none",border:"none",color:"#F59E0B",fontWeight:"700",fontSize:"13px",flex:1,outline:"none" }}/>
                <button onClick={() => { if(window.confirm("Shift verwijderen?")) setShiftDefs(prev => prev.filter(x => x.id!==sh.id)); }} style={{ background:"none",border:"none",color:"#EF4444",cursor:"pointer" }}><Trash2 size={14}/></button>
              </div>
              <div style={{ fontSize:"9px",color:"#475569",marginBottom:"6px",fontWeight:"700",letterSpacing:"0.06em" }}>UREN (klik om aan/uit te zetten):</div>
              <div style={{ display:"flex",gap:"3px",flexWrap:"wrap" }}>
                {WORK_HOURS.map(h => {
                  const on = sh.hours.includes(h);
                  return <button key={h} onClick={() => setShiftDefs(prev => prev.map(x => x.id===sh.id?{...x,hours:on?x.hours.filter(hr=>hr!==h):[...x.hours,h].sort((a,b)=>a-b)}:x))}
                    style={{ padding:"3px 6px",borderRadius:"4px",border:"none",fontSize:"10px",cursor:"pointer",background:on?"#F59E0B":"#334155",color:on?"black":"#475569",fontWeight:on?"700":"400" }}>
                    {h}
                  </button>;
                })}
              </div>
              <div style={{ fontSize:"10px",color:"#64748B",marginTop:"6px",fontFamily:"monospace" }}>
                {sh.hours.length>0
                  ? `${String(Math.min(...sh.hours)).padStart(2,"0")}:00 – ${String(Math.max(...sh.hours)+1).padStart(2,"0")}:00 · ${sh.hours.length} blokjes → ${nettoUren(sh.hours)}u netto${sh.hours.length>=9?" (−1u pauze)":""}`
                  : <span style={{ color:"#EF4444" }}>Geen uren geselecteerd</span>
                }
              </div>
            </div>
          ))}
        </section>
      </div>
    );
  }


  const tabs = [
    { id:"planning",   label:"Planning",        icon:<Calendar size={14}/> },
    { id:"medewerkers",label:"Medewerkers",      icon:<Users size={14}/> },
    { id:"beheer",     label:"Klanten & Shifts", icon:<Settings size={14}/> },
    ...(isAdmin ? [
      { id:"financieel", label:"Financieel",     icon:<Euro size={14}/> },
      { id:"admin",      label:"Gebruikers",     icon:<Shield size={14}/> },
    ] : []),
  ];

  return (
    <div style={{ minHeight:"100vh",background:"#020617",color:"#F8FAFC",fontFamily:"'Segoe UI',system-ui,sans-serif",padding:"16px" }}>
      {vacModal        && <VacationModal/>}
      {customShiftSlot && <CustomShiftModal/>}
      {showPrintModal  && <PrintModal/>}
      <PrintView/>

      <nav className="screen-only" style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"18px",borderBottom:"1px solid #0f172a",paddingBottom:"14px",flexWrap:"wrap",gap:"10px" }}>
        <div style={{ display:"flex",alignItems:"center",gap:"6px",flexWrap:"wrap" }}>
          <select value={activeDeptId} onChange={e => setActiveDeptId(e.target.value)}
            style={{ background:"#3B82F6",color:"white",padding:"8px 12px",borderRadius:"8px",border:"none",fontWeight:"700",cursor:"pointer" }}>
            {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
              style={{ background:activeTab===tab.id?"#0f172a":"transparent",color:activeTab===tab.id?"white":"#64748B",border:activeTab===tab.id?"1px solid #1e293b":"1px solid transparent",padding:"7px 14px",borderRadius:"8px",cursor:"pointer",fontWeight:activeTab===tab.id?"700":"400",fontSize:"13px",display:"flex",alignItems:"center",gap:"6px",transition:"all 0.15s" }}>
              {tab.icon}{tab.label}
            </button>
          ))}
          {loading && <span style={{ fontSize:"11px",color:"#F59E0B",marginLeft:"4px" }}>⏳ Laden...</span>}
        </div>

        <div style={{ display:"flex",gap:"8px",alignItems:"center" }}>
          <div style={{ display:"flex",alignItems:"center",gap:"6px",background:"#0f172a",padding:"6px 12px",borderRadius:"8px",border:"1px solid #1e293b" }}>
            <span style={{ fontSize:"11px",color:"#64748B" }}>FTE</span>
            <button onClick={() => setUseFTE(v => !v)} style={{ background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center" }}>
              {useFTE ? <ToggleRight size={22} color="#10B981"/> : <ToggleLeft size={22} color="#334155"/>}
            </button>
          </div>
          <button onClick={runAutoPlanner} style={{ background:"#10B981",color:"white",border:"none",padding:"8px 14px",borderRadius:"8px",cursor:"pointer",fontWeight:"700",display:"flex",alignItems:"center",gap:"6px" }}>
            <Zap size={14}/>Auto-Plan
          </button>
          <button onClick={() => { if(window.confirm("Volledige planning leegmaken?")) setSchedule({}); }}
            style={{ background:"rgba(239,68,68,0.1)",color:"#EF4444",border:"1px solid rgba(239,68,68,0.2)",padding:"8px 14px",borderRadius:"8px",cursor:"pointer",display:"flex",alignItems:"center",gap:"6px" }}>
            <Trash2 size={14}/>Leeg
          </button>
          <button onClick={() => setShowPrintModal(true)} style={{ background:"#8B5CF6",color:"white",border:"none",padding:"8px 14px",borderRadius:"8px",cursor:"pointer",fontWeight:"700",display:"flex",alignItems:"center",gap:"6px" }}>
            <Printer size={14}/>Print
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
        {activeTab==="admin"       && isAdmin && (
          <div style={{ maxWidth:"600px" }}>
            <AdminUserPanel/>
          </div>
        )}
      </main>

      <style>{`
        @media print { .screen-only{display:none!important} .print-wrap{display:block!important} }
        @media screen { .print-wrap{display:none!important} }
        input:focus, select:focus, textarea:focus { outline:1px solid #3B82F6; border-radius:4px; }
        button:active { transform:scale(0.97); }
        ::-webkit-scrollbar { width:6px; height:6px; }
        ::-webkit-scrollbar-track { background:#0f172a; }
        ::-webkit-scrollbar-thumb { background:#1e293b; border-radius:3px; }
        ::-webkit-scrollbar-thumb:hover { background:#334155; }
      `}</style>
    </div>
  );
}


export default function AppRoot() {
  const [session,     setSession]     = useState<Session|null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    sb.auth.getSession().then(({data}) => { setSession(data.session); setAuthChecked(true); });
    const { data: listener } = sb.auth.onAuthStateChange((_event, sess) => { setSession(sess); });
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
