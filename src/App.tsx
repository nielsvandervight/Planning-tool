/**
* PERSONEELSPLANNING APP
 * Fixes:
 *  1. PDF download als directe link (geen popup blocker)
 *  2. FTE planning: 2 FTE = 2 medewerkers per dag ingepland
 *  3. Uren: 9 blokjes = 8u netto (1u pauze automatisch)
 *  4. PDF print: elk uur toont naam van medewerker
 *  5. Geen TypeScript errors die Vercel build breken
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Users, Calendar, Settings, Euro, LogOut,
  ChevronLeft, ChevronRight, Plus, Trash2, Printer, Zap,
  ToggleLeft, ToggleRight, AlertTriangle, Eye, EyeOff,
  TrendingUp, Building2, PieChart, Clock, Shield, Coffee,
  X, Check, Edit2, Download, FileText
} from "lucide-react";

// ─── Supabase ─────────────────────────────────────────────────────────────────
const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Guard: als env vars ontbreken geef duidelijke fout
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("❌ Supabase env vars ontbreken. Voeg VITE_SUPABASE_URL en VITE_SUPABASE_ANON_KEY toe.");
}

export const sb = createClient(
  SUPABASE_URL || "https://placeholder.supabase.co",
  SUPABASE_ANON_KEY || "placeholder"
);

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
interface SlotRow {
  employeeId: string;
  shiftId: string;
  selectedHours: number[];
  coverEmployeeId?: string;
}
interface SlotEntry { rows: SlotRow[]; }

// ─── Constanten ───────────────────────────────────────────────────────────────
const WORK_HOURS   = [5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22];
const DAY_LABELS   = ["Maandag","Dinsdag","Woensdag","Donderdag","Vrijdag","Zaterdag","Zondag"];
const MONTH_LABELS = ["Januari","Februari","Maart","April","Mei","Juni","Juli",
                      "Augustus","September","Oktober","November","December"];
const COLORS = [
  "#3B82F6","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899","#06B6D4","#84CC16",
  "#F97316","#6366F1","#14B8A6","#F43F5E","#A78BFA","#34D399","#FBBF24","#60A5FA",
  "#E879F9","#FB7185","#4ADE80","#38BDF8","#FCD34D","#A3E635",
];

const BREAK_PRESETS = [
  { label:"30 min",       breaks:[{ id:"p1", startHour:12, startMin:0, endHour:12, endMin:30, label:"Lunch" }] },
  { label:"60 min",       breaks:[{ id:"p2", startHour:12, startMin:0, endHour:13, endMin:0,  label:"Lunch" }] },
  { label:"15+30+15 min", breaks:[
    { id:"p3a", startHour:10, startMin:0, endHour:10, endMin:15, label:"Pauze" },
    { id:"p3b", startHour:12, startMin:0, endHour:12, endMin:30, label:"Lunch" },
    { id:"p3c", startHour:15, startMin:0, endHour:15, endMin:15, label:"Pauze" },
  ]},
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

function weekNum(d: Date): number {
  const u = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dn = u.getUTCDay() || 7;
  u.setUTCDate(u.getUTCDate() + 4 - dn);
  const y0 = new Date(Date.UTC(u.getUTCFullYear(), 0, 1));
  return Math.ceil((((u.getTime()-y0.getTime())/86400000)+1)/7);
}

function startOfWeek(d: Date): Date {
  const r = new Date(d);
  const day = r.getDay();
  r.setDate(r.getDate() - day + (day===0?-6:1));
  r.setHours(0,0,0,0);
  return r;
}

function datesInMonth(month: number, year: number): Date[] {
  const out: Date[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth()===month) { out.push(new Date(d)); d.setDate(d.getDate()+1); }
  return out;
}

const dayLabel  = (d: Date) => DAY_LABELS[d.getDay()===0?6:d.getDay()-1];
const isWeekend = (d: Date) => d.getDay()===0||d.getDay()===6;
const getWeekKey= (d: Date) => fmtDate(startOfWeek(d));
const fmtEuro   = (n: number) => new Intl.NumberFormat("nl-NL",{style:"currency",currency:"EUR"}).format(n);
const fmtTime   = (h: number, m: number) => `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;

function contrastColor(hex: string): string {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return (r*299+g*587+b*114)/1000>128?"#000":"#fff";
}

/**
 * CORRECTE PAUZE BEREKENING:
 * - 9 blokjes (uren) = 9 bruto uur = 8 netto uur (1u pauze)
 * - Als employee breaks heeft, gebruik die. Anders: >=6u = 30min, >=9u = 60min
 */
function calcBreakMins(breaks: BreakSlot[], selectedHours: number[]): number {
  const blocksCount = selectedHours?.length || 0;
  if (!breaks || breaks.length === 0) {
    // Standaard: wettelijke pauze
    if (blocksCount >= 9) return 60;
    if (blocksCount >= 6) return 30;
    return 0;
  }
  let total = 0;
  breaks.forEach(b => {
    const bs = b.startHour + b.startMin/60;
    const be = b.endHour + b.endMin/60;
    if (!selectedHours?.length) return;
    const ss = Math.min(...selectedHours);
    const se = Math.max(...selectedHours) + 1;
    total += Math.max(0, Math.min(se, be) - Math.max(ss, bs)) * 60;
  });
  return total;
}

/**
 * Netto uren voor een medewerker:
 * selectedHours.length = bruto blokjes
 * aftrek = pauzetijd in uren
 */
function nettoUrenEmp(emp: Employee, hours: number[]): number {
  const bruto = hours?.length || 0;
  const pauzeMin = calcBreakMins(emp.breaks, hours);
  return Math.max(0, bruto - pauzeMin/60);
}

/**
 * Netto uren zonder employee-context (fallback)
 */
function nettoUren(hours: number[]): number {
  const b = hours?.length || 0;
  if (b >= 9) return b - 1;
  if (b >= 6) return b - 0.5;
  return b;
}

function isBreakHour(emp: Employee, h: number): boolean {
  return emp.breaks.some(b => {
    const bs = b.startHour + b.startMin/60;
    const be = b.endHour + b.endMin/60;
    return h >= bs && h < be;
  });
}

function shiftTimeStr(hours: number[]): string {
  if (!hours?.length) return "";
  return `${String(Math.min(...hours)).padStart(2,"0")}:00–${String(Math.max(...hours)+1).padStart(2,"0")}:00`;
}

function useDebounce<T extends (...args: any[])=>any>(fn: T, delay: number): T {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: any[]) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => ref.current(...args), delay);
  }, [delay]) as T;
}

function genId(prefix: string) { return prefix+Date.now()+Math.random().toString(36).slice(2,6); }

// ─── Modal ─────────────────────────────────────────────────────────────────────
const Modal = React.memo(function Modal({
  title, onClose, children, width="520px", zIndex=2000
}: { title:string; onClose:()=>void; children:React.ReactNode; width?:string; zIndex?:number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>("input,select,textarea,button");
    el?.focus();
  }, []);
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex,
      display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
      onClick={onClose}>
      <div ref={ref} onClick={e=>e.stopPropagation()}
        style={{background:"#0f172a",borderRadius:16,padding:28,width,
          maxWidth:"95vw",maxHeight:"90vh",overflowY:"auto",
          border:"1px solid #1e293b",boxShadow:"0 25px 80px rgba(0,0,0,.7)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div style={{fontSize:18,fontWeight:"bold",color:"white"}}>{title}</div>
          <button onClick={onClose} style={{background:"#1e293b",border:"none",
            color:"white",borderRadius:8,padding:"6px 14px",cursor:"pointer"}}>
            <X size={14}/></button>
        </div>
        {children}
      </div>
    </div>
  );
});

function ModalField({ label, children }: { label:string; children:React.ReactNode }) {
  return (
    <div style={{marginBottom:14}}>
      <label style={{fontSize:11,fontWeight:600,color:"#64748B",
        display:"block",marginBottom:6,letterSpacing:"0.06em"}}>{label}</label>
      {children}
    </div>
  );
}

const inputSt: React.CSSProperties = {
  width:"100%",padding:"10px 14px",background:"#1e293b",color:"white",
  border:"1px solid #334155",borderRadius:8,fontSize:13,
  boxSizing:"border-box",outline:"none"
};
const selectSt: React.CSSProperties = {...inputSt, cursor:"pointer"};

// ─── ColorPicker ──────────────────────────────────────────────────────────────
const ColorPicker = React.memo(function ColorPicker(
  { value, onChange }: { value:string; onChange:(c:string)=>void }
) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{position:"relative",display:"inline-block"}}>
      <div onClick={()=>setOpen(v=>!v)} title="Kies kleur"
        style={{width:28,height:28,borderRadius:"50%",background:value,
          cursor:"pointer",border:"2px solid #475569",boxSizing:"border-box"}}/>
      {open && (
        <div onClick={e=>e.stopPropagation()}
          style={{position:"absolute",top:34,left:0,background:"#1e293b",
            borderRadius:10,padding:10,border:"1px solid #334155",zIndex:200,
            display:"grid",gridTemplateColumns:"repeat(6,22px)",gap:4,
            boxShadow:"0 10px 30px rgba(0,0,0,.5)"}}>
          {COLORS.map(c => (
            <div key={c} onClick={()=>{onChange(c);setOpen(false);}}
              style={{width:22,height:22,borderRadius:"50%",background:c,cursor:"pointer",
                border:c===value?"3px solid white":"2px solid transparent",
                boxSizing:"border-box"}}/>
          ))}
          <div style={{gridColumn:"1/-1",marginTop:4,borderTop:"1px solid #334155",paddingTop:6}}>
            <label style={{fontSize:9,color:"#64748B",display:"block",marginBottom:3}}>EIGEN KLEUR</label>
            <input type="color" value={value}
              onChange={e=>{onChange(e.target.value);setOpen(false);}}
              style={{width:"100%",height:24,cursor:"pointer",background:"none",border:"none",borderRadius:4}}/>
          </div>
        </div>
      )}
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// LOGIN
// ══════════════════════════════════════════════════════════════════════════════
function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function login() {
    setLoading(true); setError("");
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  }

  return (
    <div style={{minHeight:"100vh",background:"#020617",display:"flex",
      alignItems:"center",justifyContent:"center",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <div style={{background:"#0f172a",borderRadius:20,padding:"48px 40px",width:380,
        border:"1px solid #1e293b",boxShadow:"0 40px 80px rgba(0,0,0,.8)"}}>
        <div style={{marginBottom:32,textAlign:"center"}}>
          <div style={{width:52,height:52,background:"#3B82F6",borderRadius:14,
            display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}>
            <Calendar size={26} color="white"/></div>
          <div style={{fontSize:24,fontWeight:700,color:"white",letterSpacing:"-.5px"}}>Personeelsplanning</div>
          <div style={{fontSize:13,color:"#475569",marginTop:6}}>Inloggen om verder te gaan</div>
        </div>
        {(!SUPABASE_URL || SUPABASE_URL.includes("placeholder")) && (
          <div style={{background:"rgba(245,158,11,.1)",border:"1px solid rgba(245,158,11,.3)",
            color:"#FCD34D",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12}}>
            ⚠️ Voeg VITE_SUPABASE_URL en VITE_SUPABASE_ANON_KEY toe aan je Vercel environment variables.
          </div>
        )}
        <ModalField label="E-MAILADRES">
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
            placeholder="naam@bedrijf.nl" style={inputSt}/>
        </ModalField>
        <ModalField label="WACHTWOORD">
          <input type="password" autoComplete="current-password"
            value={password} onChange={e=>setPassword(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&login()} placeholder="••••••••" style={inputSt}/>
        </ModalField>
        {error && <div style={{background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.3)",
          color:"#FCA5A5",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:13}}>
          {error}</div>}
        <button onClick={login} disabled={loading}
          style={{width:"100%",padding:12,background:loading?"#1e293b":"#3B82F6",
            border:"none",color:"white",borderRadius:10,fontWeight:700,fontSize:15,
            cursor:loading?"wait":"pointer"}}>
          {loading?"Inloggen...":"Inloggen"}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PDF GENERATIE — Uurrooster met naam per uur
// ══════════════════════════════════════════════════════════════════════════════

interface PDFData {
  deptName: string;
  weekLabel: string;
  dates: Date[];
  employees: Employee[];
  clients: Client[];
  subcats: Subcategory[];
  schedule: Record<string, SlotEntry>;
}

/**
 * Bouw HTML voor de PDF.
 * Per dag een rij per uur (5-22), per uur alle ingeplande medewerkers met naam.
 * Zo is in één oogopslag duidelijk wie wanneer werkt.
 */
function buildPDFHTML(data: PDFData, orientation: "landscape"|"portrait"): string {
  const { deptName, weekLabel, dates, employees, clients, subcats, schedule } = data;
  const workDays = dates.filter(d => !isWeekend(d));

  // Verzamel alle ingeplande data per dag per uur
  // structuur: dayStr -> hour -> [{ empName, empColor, clientName }]
  const hourMap: Record<string, Record<number, Array<{empName:string;empColor:string;clientName:string;isBreak:boolean}>>> = {};

  workDays.forEach(date => {
    const ds = fmtDate(date);
    hourMap[ds] = {};
    WORK_HOURS.forEach(h => { hourMap[ds][h] = []; });

    clients.forEach(client => {
      const csubs = subcats.filter(s => s.clientId === client.id);
      const slotGroups = csubs.length
        ? csubs.map(s => [`${ds}-${s.id}`, s] as [string, Subcategory])
        : [[`${ds}-client-${client.id}`, null] as [string, null]];

      slotGroups.forEach(([slotId, sub]) => {
        const entry = schedule[slotId];
        if (!entry?.rows) return;
        entry.rows.forEach(row => {
          if (!row.employeeId) return;
          const emp = employees.find(e => e.id === row.employeeId);
          if (!emp) return;
          const clientLabel = sub?.name || client.name;
          row.selectedHours?.forEach(h => {
            if (hourMap[ds][h] !== undefined) {
              const isBreak = isBreakHour(emp, h);
              hourMap[ds][h].push({
                empName: emp.name,
                empColor: emp.color,
                clientName: clientLabel,
                isBreak,
              });
            }
          });
        });
      });
    });
  });

  // Bepaal welke uren daadwerkelijk bezet zijn
  const activeHours = WORK_HOURS.filter(h =>
    workDays.some(d => (hourMap[fmtDate(d)][h]||[]).length > 0)
  );
  if (!activeHours.length) {
    // Geen planning, toon bericht
  }

  const minH = activeHours.length ? Math.max(5, Math.min(...activeHours) - 1) : 8;
  const maxH = activeHours.length ? Math.min(22, Math.max(...activeHours) + 1) : 17;
  const displayHours = WORK_HOURS.filter(h => h >= minH && h <= maxH);

  // Stijlen
  const isLandscape = orientation === "landscape";
  const cellW = isLandscape ? "120px" : "90px";
  const fs = isLandscape ? "11px" : "9px";
  const fsSmall = isLandscape ? "9px" : "8px";

  // Dag-headers
  const dayHeaders = workDays.map(d =>
    `<th style="padding:6px 4px;background:#1e293b;color:#f8fafc;font-size:${fs};
      font-weight:700;text-align:center;border:1px solid #334155;min-width:${cellW};">
      ${dayLabel(d).slice(0,2)} ${d.getDate()}/${d.getMonth()+1}
    </th>`
  ).join("");

  // Rijen per uur
  const rows = displayHours.map(h => {
    const cells = workDays.map(date => {
      const ds = fmtDate(date);
      const entries = hourMap[ds][h] || [];
      if (!entries.length) {
        return `<td style="padding:3px;border:1px solid #e5e7eb;background:#fafafa;"></td>`;
      }
      const tags = entries.map(e => {
        const bg = e.isBreak
          ? `background:repeating-linear-gradient(45deg,${e.empColor}33 0,${e.empColor}33 3px,${e.empColor}11 3px,${e.empColor}11 6px);`
          : `background:${e.empColor}22;`;
        const icon = e.isBreak ? "☕ " : "";
        return `<div style="${bg}border-left:3px solid ${e.empColor};border-radius:3px;
          padding:2px 5px;margin:1px 0;">
          <div style="font-size:${fs};font-weight:700;color:#0f172a;">${icon}${e.empName}</div>
          <div style="font-size:${fsSmall};color:#475569;">${e.clientName}</div>
        </div>`;
      }).join("");
      return `<td style="padding:3px;border:1px solid #e5e7eb;vertical-align:top;">${tags}</td>`;
    }).join("");

    const isLunchHour = h === 12 || h === 13;
    const rowBg = isLunchHour ? "background:#fffbeb;" : "background:#fff;";
    return `<tr style="${rowBg}">
      <td style="padding:4px 8px;border:1px solid #e5e7eb;font-size:${fs};
        font-weight:700;color:#374151;white-space:nowrap;background:#f8fafc;
        text-align:center;">
        ${String(h).padStart(2,"0")}:00
      </td>
      ${cells}
    </tr>`;
  }).join("");

  // Legende: welke medewerkers ingepland
  const scheduledEmps = new Set<string>();
  workDays.forEach(d => {
    Object.values(hourMap[fmtDate(d)] || {}).forEach(entries => {
      entries.forEach(e => scheduledEmps.add(`${e.empColor}|${e.empName}`));
    });
  });
  const legendItems = Array.from(scheduledEmps).map(k => {
    const [color, name] = k.split("|");
    return `<div style="display:flex;align-items:center;gap:5px;font-size:10px;color:#374151;">
      <div style="width:12px;height:12px;border-radius:50%;background:${color};flex-shrink:0;"></div>
      ${name}
    </div>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Helvetica Neue',Arial,sans-serif; background:#fff; color:#111; padding:16px; }
  table { border-collapse:col
