import React, {
  useState, useEffect, useCallback, useRef, useMemo
} from "react";
import { createClient, Session } from "@supabase/supabase-js";
import {
  Users, Calendar, Settings, Euro, LogOut,
  ChevronLeft, ChevronRight, Plus, Trash2, Printer, Zap,
  ToggleLeft, ToggleRight, AlertTriangle, Eye, EyeOff,
  TrendingUp, Building2, PieChart, Clock, Shield, Coffee,
  X, Check, Edit2, Download, FileText, Key
} from "lucide-react";

// ─── Supabase ─────────────────────────────────────────────────────────────────
const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── Types ────────────────────────────────────────────────────────────────────
export interface Department  { id: string; name: string; }
export interface Skill       { id: string; name: string; criteria: string; }
export interface ShiftDef    { id: string; label: string; hours: number[]; }
export interface Subcategory { id: string; clientId: string; name: string; targetSkills: string[]; requireBreakCover: boolean; }
export interface Client      { id: string; name: string; departmentId: string; fteNeeded: number; useFTE: boolean; }
export interface BreakSlot   { id: string; startHour: number; startMin: number; endHour: number; endMin: number; label: string; }
export interface Employee {
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
export interface SlotRow {
  employeeId: string;
  shiftId: string;
  selectedHours: number[];
  coverEmployeeId?: string;
}
export interface SlotEntry { rows: SlotRow[]; }

// ─── Constanten ───────────────────────────────────────────────────────────────
export const WORK_HOURS   = [5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22];
export const DAY_LABELS   = ["Maandag","Dinsdag","Woensdag","Donderdag","Vrijdag","Zaterdag","Zondag"];
export const MONTH_LABELS = ["Januari","Februari","Maart","April","Mei","Juni","Juli",
                      "Augustus","September","Oktober","November","December"];
export const COLORS = [
  "#3B82F6","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899","#06B6D4","#84CC16",
  "#F97316","#6366F1","#14B8A6","#F43F5E","#A78BFA","#34D399","#FBBF24","#60A5FA",
  "#E879F9","#FB7185","#4ADE80","#38BDF8","#FCD34D","#A3E635",
];

export const BREAK_PRESETS = [
  { label:"Geen pauze", breaks:[] },
  { label:"15 min",  breaks:[{ id:"p0", startHour:10, startMin:0, endHour:10, endMin:15, label:"Pauze" }] },
  { label:"30 min",  breaks:[{ id:"p1", startHour:12, startMin:0, endHour:12, endMin:30, label:"Lunch" }] },
  { label:"60 min",  breaks:[{ id:"p2", startHour:12, startMin:0, endHour:13, endMin:0,  label:"Lunch" }] },
  { label:"15+30+15 min", breaks:[
    { id:"p3a", startHour:10, startMin:0, endHour:10, endMin:15, label:"Pauze" },
    { id:"p3b", startHour:12, startMin:0, endHour:12, endMin:30, label:"Lunch" },
    { id:"p3c", startHour:15, startMin:0, endHour:15, endMin:15, label:"Pauze" },
  ]},
  { label:"2× 15 min", breaks:[
    { id:"p4a", startHour:10, startMin:0, endHour:10, endMin:15, label:"Pauze" },
    { id:"p4b", startHour:15, startMin:0, endHour:15, endMin:15, label:"Pauze" },
  ]},
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
export const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

export function weekNum(d: Date): number {
  const u = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dn = u.getUTCDay() || 7;
  u.setUTCDate(u.getUTCDate() + 4 - dn);
  const y0 = new Date(Date.UTC(u.getUTCFullYear(), 0, 1));
  return Math.ceil((((u.getTime()-y0.getTime())/86400000)+1)/7);
}
export function startOfWeek(d: Date): Date {
  const r = new Date(d); const day = r.getDay();
  r.setDate(r.getDate() - day + (day===0?-6:1));
  r.setHours(0,0,0,0); return r;
}
export function datesInMonth(month: number, year: number): Date[] {
  const out: Date[] = []; const d = new Date(year, month, 1);
  while (d.getMonth()===month) { out.push(new Date(d)); d.setDate(d.getDate()+1); }
  return out;
}
export const dayLabel    = (d: Date) => DAY_LABELS[d.getDay()===0?6:d.getDay()-1];
export const isWeekend   = (d: Date) => d.getDay()===0||d.getDay()===6;
export const getWeekKey  = (d: Date) => fmtDate(startOfWeek(d));
export const fmtEuro     = (n: number) => new Intl.NumberFormat("nl-NL",{style:"currency",currency:"EUR"}).format(n);
export const fmtTime     = (h: number, m: number) => `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;

export function contrastColor(hex: string): string {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return (r*299+g*587+b*114)/1000>128?"#000":"#fff";
}

/**
 * Berekent pauze-minuten die vallen binnen de geselecteerde uren.
 * Als er geen breaks zijn en er >= 9 uur gewerkt wordt, wordt standaard 60 min aangehouden.
 */
export function calcBreakMins(breaks: BreakSlot[], selectedHours: number[]): number {
  if (!selectedHours?.length) return 0;
  if (!breaks?.length) return selectedHours.length >= 9 ? 60 : 0;
  let total = 0;
  const ss = Math.min(...selectedHours);
  const se = Math.max(...selectedHours) + 1; // einde laatste uur
  breaks.forEach(b => {
    const bs = b.startHour + b.startMin / 60;
    const be = b.endHour   + b.endMin   / 60;
    // Overlap tussen [ss, se) en [bs, be)
    total += Math.max(0, Math.min(se, be) - Math.max(ss, bs)) * 60;
  });
  return Math.round(total);
}

/**
 * Netto gewerkte uren voor een medewerker: bruto uren minus zijn pauze.
 */
export function nettoUrenEmp(emp: Employee, hours: number[]): number {
  return Math.max(0, (hours?.length || 0) - calcBreakMins(emp.breaks, hours) / 60);
}

/**
 * Generieke netto uren zonder emp-specifieke breaks (fallback: -1u bij >= 9u).
 */
export function nettoUren(hours: number[]): number {
  const b = hours?.length || 0;
  return b >= 9 ? b - 1 : b;
}

export function isBreakHour(emp: Employee, h: number): boolean {
  return emp.breaks.some(b => h >= b.startHour + b.startMin/60 && h < b.endHour + b.endMin/60);
}

export function shiftTimeStr(hours: number[]): string {
  if (!hours?.length) return "";
  return `${String(Math.min(...hours)).padStart(2,"0")}:00–${String(Math.max(...hours)+1).padStart(2,"0")}:00`;
}

export function genId(prefix: string) { return prefix + Date.now() + Math.random().toString(36).slice(2,6); }

// ─── useDebounce ─────────────────────────────────────────────────────────────
function useDebounce<T extends (...args: any[]) => any>(fn: T, delay: number): T {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const ref   = useRef(fn); ref.current = fn;
  return useCallback((...args: Parameters<T>) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => ref.current(...args), delay);
  }, [delay]) as T;
}

// ─── Styles ───────────────────────────────────────────────────────────────────
export const inputSt: React.CSSProperties = {
  width:"100%", padding:"10px 14px", background:"#1e293b", color:"white",
  border:"1px solid #334155", borderRadius:8, fontSize:13,
  boxSizing:"border-box", outline:"none"
};
export const selectSt: React.CSSProperties = { ...inputSt, cursor:"pointer" };

// ══════════════════════════════════════════════════════════════════════════════
// GEDEELDE UI COMPONENTEN (buiten App)
// ══════════════════════════════════════════════════════════════════════════════

// ─── Modal ────────────────────────────────────────────────────────────────────
export const Modal = React.memo(function Modal({
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

export function ModalField({label,children}:{label:string;children:React.ReactNode}) {
  return (
    <div style={{marginBottom:14}}>
      <label style={{fontSize:11,fontWeight:600,color:"#64748B",
        display:"block",marginBottom:6,letterSpacing:"0.06em"}}>{label}</label>
      {children}
    </div>
  );
}

// ─── ColorPicker ──────────────────────────────────────────────────────────────
export const ColorPicker = React.memo(function ColorPicker(
  { value, onChange }: { value:string; onChange:(c:string)=>void }
) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{position:"relative",display:"inline-block"}}>
      <div onClick={() => setOpen(v=>!v)} title="Kies kleur"
        style={{width:28,height:28,borderRadius:"50%",background:value,
          cursor:"pointer",border:"2px solid #475569",boxSizing:"border-box"}}/>
      {open && (
        <div onClick={e=>e.stopPropagation()}
          style={{position:"absolute",top:34,left:0,background:"#1e293b",
            borderRadius:10,padding:10,border:"1px solid #334155",zIndex:200,
            display:"grid",gridTemplateColumns:"repeat(6,22px)",gap:4,
            boxShadow:"0 10px 30px rgba(0,0,0,.5)"}}>
          {COLORS.map(c => (
            <div key={c} onClick={() => { onChange(c); setOpen(false); }}
              style={{width:22,height:22,borderRadius:"50%",background:c,cursor:"pointer",
                border:c===value?"3px solid white":"2px solid transparent",
                boxSizing:"border-box"}}/>
          ))}
          <div style={{gridColumn:"1/-1",marginTop:4,borderTop:"1px solid #334155",paddingTop:6}}>
            <input type="color" value={value}
              onChange={e => { onChange(e.target.value); setOpen(false); }}
              style={{width:"100%",height:24,cursor:"pointer",background:"none",
                border:"none",borderRadius:4}}/>
          </div>
        </div>
      )}
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// PDF GENERATIE
// ══════════════════════════════════════════════════════════════════════════════
interface PDFData {
  deptName: string;
  weekLabel: string;
  weekStart: Date;
  dates: Date[];
  employees: Employee[];
  clients: Client[];
  subcats: Subcategory[];
  schedule: Record<string,SlotEntry>;
  skills: Skill[];
  shiftDefs: ShiftDef[];
}

function generatePrintHTML(data: PDFData, paperSize: "A4"|"A3"): string {
  const { deptName, weekLabel, dates, employees, clients, subcats, schedule, shiftDefs } = data;
  const workDays = dates.filter(d => !isWeekend(d));

  const scheduledEmpIds = new Set<string>();
  workDays.forEach(date => {
    const ds = fmtDate(date);
    Object.entries(schedule).forEach(([slotId, entry]) => {
      if (slotId.startsWith(ds)) {
        entry.rows?.forEach(r => { if (r.employeeId) scheduledEmpIds.add(r.employeeId); });
      }
    });
  });
  const scheduledEmps = employees
    .filter(e => scheduledEmpIds.has(e.id))
    .sort((a,b) => a.name.localeCompare(b.name));

  function getEmpDayInfo(emp: Employee, date: Date) {
    const ds = fmtDate(date);
    const infos: { timeStr:string; clientName:string; subName:string; breakMins:number; coverName:string; shiftLabel:string; color:string }[] = [];
    clients.forEach(client => {
      const csubs = subcats.filter(s => s.clientId === client.id);
      const slots = csubs.length
        ? csubs.map(s => [`${ds}-${s.id}`, s, client] as [string, Subcategory|null, Client])
        : [[`${ds}-client-${client.id}`, null, client] as [string, Subcategory|null, Client]];
      slots.forEach(([slotId, sub, cl]) => {
        const entry = schedule[slotId];
        entry?.rows?.forEach(row => {
          if (row.employeeId !== emp.id) return;
          const timeStr   = shiftTimeStr(row.selectedHours);
          const breakMins = calcBreakMins(emp.breaks, row.selectedHours);
          const coverEmp  = row.coverEmployeeId ? employees.find(e => e.id === row.coverEmployeeId) : null;
          const sh        = shiftDefs.find(s => s.id === row.shiftId);
          infos.push({ timeStr, clientName:cl.name, subName:sub?.name||"Algemeen",
            breakMins, coverName:coverEmp?coverEmp.name.split(" ")[0]:"",
            shiftLabel:sh?.label||(row.shiftId==="custom"?"Custom":""), color:emp.color });
        });
      });
    });
    return infos;
  }

  const isA3  = paperSize === "A3";
  const pageW = isA3 ? 420 : 297;
  const pageH = isA3 ? 297 : 210;
  const dpi   = 3.7795;
  const pxW   = Math.round(pageW * dpi);
  const pxH   = Math.round(pageH * dpi);

  const empHex = (hex: string, a: number) => {
    const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
  };

  const colW     = Math.floor((pxW - 180) / workDays.length);
  const rowH     = Math.max(48, Math.floor((pxH - 120) / Math.max(scheduledEmps.length, 1)));
  const fontSize = Math.max(8, Math.min(12, rowH / 4));

  const dayHeaders = workDays.map((d,i) => `
    <div style="position:absolute;left:${180+i*colW}px;top:0;width:${colW}px;height:60px;
      border-left:1px solid #cbd5e1;display:flex;flex-direction:column;align-items:center;
      justify-content:center;background:#0f172a;color:white;">
      <div style="font-size:${fontSize+2}px;font-weight:800;">${dayLabel(d).slice(0,2)} ${d.getDate()}</div>
      <div style="font-size:${fontSize-1}px;color:#94a3b8;">${MONTH_LABELS[d.getMonth()].slice(0,3)} · Wk ${weekNum(d)}</div>
    </div>`).join("");

  const empRows = scheduledEmps.map((emp, ri) => {
    const top   = 60 + ri * rowH;
    const bgRow = ri % 2 === 0 ? "#ffffff" : "#f8fafc";

    const dayCells = workDays.map((date, ci) => {
      const infos = getEmpDayInfo(emp, date);
      const left  = 180 + ci * colW;
      if (!infos.length) {
        return `<div style="position:absolute;left:${left}px;top:${top}px;width:${colW}px;height:${rowH}px;
          border-left:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;background:${bgRow};
          display:flex;align-items:center;justify-content:center;">
          <span style="color:#cbd5e1;font-size:${fontSize}px;">—</span></div>`;
      }
      const cellContent = infos.map(info => `
        <div style="background:${empHex(info.color,0.12)};border-left:3px solid ${info.color};
          border-radius:3px;padding:2px 4px;margin-bottom:2px;">
          <div style="font-weight:800;font-size:${fontSize+1}px;color:#0f172a;">${info.timeStr}</div>
          <div style="font-size:${fontSize-1}px;color:#334155;">${info.subName}</div>
          ${info.breakMins>0?`<div style="font-size:${fontSize-2}px;color:#b45309;">
            ☕ ${info.breakMins}min${info.coverName?` → ${info.coverName}`:""}</div>`:""}
        </div>`).join("");
      return `<div style="position:absolute;left:${left}px;top:${top}px;width:${colW}px;height:${rowH}px;
        border-left:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;background:${bgRow};
        padding:3px;overflow:hidden;box-sizing:border-box;">${cellContent}</div>`;
    }).join("");

    // Netto uren berekening voor PDF
    const netto = workDays.reduce((sum, date) => {
      const ds = fmtDate(date);
      let dayHours: number[] = [];
      Object.entries(schedule).forEach(([slotId, entry]) => {
        if (!slotId.startsWith(ds)) return;
        entry.rows?.forEach(r => {
          if (r.employeeId === emp.id) dayHours = [...dayHours, ...r.selectedHours];
        });
      });
      const uniqueHours = [...new Set(dayHours)];
      return sum + (uniqueHours.length > 0 ? nettoUrenEmp(emp, uniqueHours) : 0);
    }, 0);

    return `
      <div style="position:absolute;left:0;top:${top}px;width:180px;height:${rowH}px;
        background:${empHex(emp.color,0.08)};border-right:2px solid ${emp.color};
        border-bottom:1px solid #e2e8f0;display:flex;align-items:center;
        padding:0 8px;box-sizing:border-box;overflow:hidden;">
        <div style="width:10px;height:10px;border-radius:50%;background:${emp.color};flex-shrink:0;margin-right:8px;"></div>
        <div style="overflow:hidden;">
          <div style="font-weight:700;font-size:${fontSize+1}px;color:#0f172a;
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${emp.name}</div>
          <div style="font-size:${fontSize-2}px;color:#64748b;">${netto.toFixed(1)}u / ${emp.hoursPerWeek}u</div>
        </div>
      </div>${dayCells}`;
  }).join("");

  const totalW = 180 + workDays.length * colW;
  const totalH = 60  + scheduledEmps.length * rowH;

  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<title>Planning ${deptName} — ${weekLabel}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  @page{size:${paperSize} landscape;margin:8mm;}
  body{font-family:'Helvetica Neue',Arial,sans-serif;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .page-header{padding:10px 0 8px 0;border-bottom:3px solid #0f172a;margin-bottom:14px;display:flex;justify-content:space-between;align-items:flex-end;}
  .page-title{font-size:22px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;}
  .page-subtitle{font-size:12px;color:#64748b;margin-top:4px;}
  .page-meta{font-size:11px;color:#94a3b8;text-align:right;}
  .legend{display:flex;gap:18px;flex-wrap:wrap;margin-top:12px;padding-top:8px;border-top:1px solid #e2e8f0;}
  .legend-item{display:flex;align-items:center;gap:5px;font-size:10px;color:#475569;}
  .grid-wrap{position:relative;width:${totalW}px;overflow:hidden;}
  .emp-label-header{position:absolute;left:0;top:0;width:180px;height:60px;background:#0f172a;
    border-right:2px solid #334155;display:flex;align-items:center;padding:0 12px;
    font-size:${fontSize}px;font-weight:700;color:#94a3b8;letter-spacing:0.06em;}
  @media screen{body{padding:20px;background:#f1f5f9;}.print-wrapper{background:white;padding:20px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);max-width:1400px;margin:0 auto;}.print-btn{display:inline-flex;align-items:center;gap:8px;background:#0f172a;color:white;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:700;font-size:14px;margin-bottom:16px;}}
  @media print{body{padding:0;background:white;}.print-wrapper{padding:0;box-shadow:none;}.no-print{display:none!important;}}
</style>
</head><body>
<div class="print-wrapper">
  <div class="no-print" style="margin-bottom:16px;display:flex;gap:10px;align-items:center;">
    <button class="print-btn" onclick="window.print()">🖨️ Afdrukken (${paperSize} Liggend)</button>
    <span style="font-size:12px;color:#64748b;">${scheduledEmps.length} medewerkers · ${workDays.length} werkdagen</span>
  </div>
  <div class="page-header">
    <div>
      <div class="page-title">${deptName} — Weekplanning</div>
      <div class="page-subtitle">${weekLabel} · Afgedrukt: ${new Date().toLocaleDateString("nl-NL",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
    </div>
    <div class="page-meta">${scheduledEmps.length} medewerkers ingepland<br/>${workDays.length} werkdagen</div>
  </div>
  <div class="grid-wrap" style="height:${totalH}px;">
    <div class="emp-label-header">MEDEWERKER</div>
    ${dayHeaders}
    ${empRows}
  </div>
  <div class="legend">
    <div class="legend-item"><span style="display:inline-block;width:12px;height:12px;background:#0f172a;border-radius:2px;"></span> Naam medewerker + uren/week</div>
    <div class="legend-item">☕ = Pauze (met duur)</div>
    <div class="legend-item">→ = Vervanging tijdens pauze</div>
    <div class="legend-item">— = Niet ingepland op deze dag</div>
  </div>
</div>
</body></html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// PDF PREVIEW MODAL (buiten App)
// ══════════════════════════════════════════════════════════════════════════════
export const PDFPreviewModal = React.memo(function PDFPreviewModal({
  data, onClose
}: { data:PDFData; onClose:()=>void }) {
  const [paperSize, setPaperSize] = useState<"A4"|"A3">("A4");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const html = useMemo(() => generatePrintHTML(data, paperSize), [data, paperSize]);

  useEffect(() => {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) { doc.open(); doc.write(html); doc.close(); }
    }
  }, [html]);

  function openPrint() {
    const w = window.open("","_blank");
    if (w) { w.document.write(html); w.document.close(); setTimeout(()=>w.print(),500); }
  }
  function downloadHTML() {
    const blob = new Blob([html],{type:"text/html;charset=utf-8"});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    const wk = data.weekLabel.replace(/[\s·/–]/g,"_").replace(/_+/g,"_");
    a.download = `planning_${data.deptName}_${wk}.html`;
    a.click(); URL.revokeObjectURL(url);
  }
  function downloadPDF() {
    const w = window.open("","_blank");
    if (!w) return;
    w.document.write(html); w.document.close();
    setTimeout(()=>{ w.focus(); w.print(); },600);
  }

  return (
    <Modal title="🖨️ Afdrukken & Exporteren" onClose={onClose} width="900px" zIndex={3000}>
      <div style={{display:"flex",gap:10,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:11,color:"#64748B",fontWeight:700}}>PAPIERFORMAAT:</span>
        {(["A4","A3"] as const).map(o=>(
          <button key={o} onClick={()=>setPaperSize(o)}
            style={{padding:"6px 16px",borderRadius:8,border:"2px solid",
              borderColor:paperSize===o?"#3B82F6":"#334155",
              background:paperSize===o?"#1d4ed8":"#0f172a",
              color:"white",cursor:"pointer",fontWeight:700,fontSize:12}}>
            {o} Liggend
          </button>
        ))}
      </div>
      <div style={{border:"1px solid #334155",borderRadius:8,overflow:"hidden",
        marginBottom:16,background:"#f8fafc",height:460}}>
        <iframe ref={iframeRef} title="Print Preview" style={{width:"100%",height:"100%",border:"none"}}/>
      </div>
      <div style={{background:"#1e293b",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:11,color:"#94a3b8"}}>
        💡 <strong style={{color:"white"}}>Tip:</strong> Gebruik "Afdrukken als PDF" (Chrome/Edge: Ctrl+P → Opslaan als PDF). Schakel "Achtergrondafbeeldingen" in voor kleuren.
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={onClose}
          style={{flex:1,padding:10,background:"#1e293b",border:"none",color:"white",borderRadius:8,cursor:"pointer"}}>Sluiten</button>
        <button onClick={downloadHTML}
          style={{flex:1,padding:10,background:"#0f172a",border:"1px solid #334155",
            color:"#38BDF8",borderRadius:8,cursor:"pointer",fontWeight:700,
            display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
          <Download size={14}/> HTML opslaan
        </button>
        <button onClick={downloadPDF}
          style={{flex:2,padding:10,background:"#3B82F6",border:"none",color:"white",borderRadius:8,cursor:"pointer",
            fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
          <FileText size={15}/> Openen & PDF opslaan
        </button>
        <button onClick={openPrint}
          style={{flex:1,padding:10,background:"#8B5CF6",border:"none",color:"white",
            borderRadius:8,cursor:"pointer",fontWeight:700,
            display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
          <Printer size={14}/> Print
        </button>
      </div>
    </Modal>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ══════════════════════════════════════════════════════════════════════════════
function LoginScreen() {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

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
            <Calendar size={26} color="white"/>
          </div>
          <div style={{fontSize:24,fontWeight:700,color:"white",letterSpacing:"-.5px"}}>Personeelsplanning</div>
          <div style={{fontSize:13,color:"#475569",marginTop:6}}>Inloggen om verder te gaan</div>
        </div>
        <ModalField label="E-MAILADRES">
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
            placeholder="naam@bedrijf.nl" style={inputSt}/>
        </ModalField>
        <ModalField label="WACHTWOORD">
          <input type="password" autoComplete="current-password"
            value={password} onChange={e=>setPassword(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&login()} placeholder="••••••••" style={inputSt}/>
        </ModalField>
        {error && (
          <div style={{background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.3)",
            color:"#FCA5A5",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:13}}>
            {error}
          </div>
        )}
        <button onClick={login} disabled={loading}
          style={{width:"100%",padding:12,background:loading?"#1e293b":"#3B82F6",
            border:"none",color:"white",borderRadius:10,fontWeight:700,fontSize:15,
            cursor:loading?"wait":"pointer"}}>
          {loading ? "Inloggen..." : "Inloggen"}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ADD / EDIT MODALS — allemaal BUITEN App
// ══════════════════════════════════════════════════════════════════════════════

// Props die deze modals delen met App via een callback-object
export interface ModalCallbacks {
  depts:        Department[];
  skills:       Skill[];
  shiftDefs:    ShiftDef[];
  clients:      Client[];
  subcats:      Subcategory[];
  employees:    Employee[];
  activeDeptId: string;
  onClose:      () => void;
  setDeptsRaw:  React.Dispatch<React.SetStateAction<Department[]>>;
  setSkillsRaw: React.Dispatch<React.SetStateAction<Skill[]>>;
  setClientsRaw:React.Dispatch<React.SetStateAction<Client[]>>;
  setSubcatsRaw:React.Dispatch<React.SetStateAction<Subcategory[]>>;
  setShiftsRaw: React.Dispatch<React.SetStateAction<ShiftDef[]>>;
  setEmployees: React.Dispatch<React.SetStateAction<Employee[]>>;
  updEmployee:  (emp: Employee) => void;
  syncSkill:    (s: Skill) => void;
  syncClient:   (c: Client) => void;
  syncSubcat:   (s: Subcategory) => void;
  syncShift:    (s: ShiftDef) => void;
}

// ─── AddDeptModal ─────────────────────────────────────────────────────────────
export const AddDeptModal = React.memo(function AddDeptModal({
  activeDeptId, setDeptsRaw, setActiveDeptId, onClose
}: {
  activeDeptId: string;
  setDeptsRaw:  React.Dispatch<React.SetStateAction<Department[]>>;
  setActiveDeptId: (id:string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  async function save() {
    if (!name.trim()) return;
    const nd: Department = { id:genId("d"), name:name.trim() };
    const { error } = await sb.from("departments").insert({ id:nd.id, name:nd.name });
    if (!error) {
      setDeptsRaw(p => [...p, nd]);
      if (!activeDeptId) setActiveDeptId(nd.id);
    }
    onClose();
  }
  return (
    <Modal title="➕ Nieuwe Afdeling" onClose={onClose}>
      <ModalField label="NAAM AFDELING">
        <input autoFocus value={name} onChange={e=>setName(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&save()} placeholder="Bijv. Zorg, Keuken..." style={inputSt}/>
      </ModalField>
      <div style={{display:"flex",gap:8,marginTop:16}}>
        <button onClick={onClose} style={{flex:1,padding:10,background:"#1e293b",border:"none",color:"white",borderRadius:8,cursor:"pointer"}}>Annuleer</button>
        <button onClick={save} style={{flex:2,padding:10,background:"#3B82F6",border:"none",color:"white",borderRadius:8,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><Check size={14}/>Opslaan</button>
      </div>
    </Modal>
  );
});

// ─── AddSkillModal ────────────────────────────────────────────────────────────
export const AddSkillModal = React.memo(function AddSkillModal({
  editing, setSkillsRaw, syncSkill, onClose
}: {
  editing?:     Skill;
  setSkillsRaw: React.Dispatch<React.SetStateAction<Skill[]>>;
  syncSkill:    (s:Skill)=>void;
  onClose:      ()=>void;
}) {
  const [name,     setName]     = useState(editing?.name     || "");
  const [criteria, setCriteria] = useState(editing?.criteria || "");

  async function save() {
    if (!name.trim()) return;
    if (editing) {
      const upd = { ...editing, name:name.trim(), criteria };
      setSkillsRaw(p => p.map(s => s.id===editing.id ? upd : s));
      syncSkill(upd);
    } else {
      const ns: Skill = { id:genId("s"), name:name.trim(), criteria };
      const { error } = await sb.from("skills").insert({ id:ns.id, name:ns.name, criteria:ns.criteria });
      if (!error) setSkillsRaw(p => [...p, ns]);
    }
    onClose();
  }
  return (
    <Modal title={editing ? "✏️ Skill Bewerken" : "➕ Nieuwe Skill"} onClose={onClose}>
      <ModalField label="NAAM SKILL">
        <input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="Bijv. BHV, HACCP..." style={inputSt}/>
      </ModalField>
      <ModalField label="CRITERIA">
        <textarea value={criteria} onChange={e=>setCriteria(e.target.value)}
          rows={3} placeholder="Wanneer scoort iemand 100%..." style={{...inputSt,resize:"vertical"}}/>
      </ModalField>
      <div style={{display:"flex",gap:8,marginTop:8}}>
        <button onClick={onClose} style={{flex:1,padding:10,background:"#1e293b",border:"none",color:"white",borderRadius:8,cursor:"pointer"}}>Annuleer</button>
        <button onClick={save} style={{flex:2,padding:10,background:"#8B5CF6",border:"none",color:"white",borderRadius:8,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><Check size={14}/>Opslaan</button>
      </div>
    </Modal>
  );
});

// ─── AddClientModal ───────────────────────────────────────────────────────────
export const AddClientModal = React.memo(function AddClientModal({
  activeDeptId, setClientsRaw, onClose
}: {
  activeDeptId:  string;
  setClientsRaw: React.Dispatch<React.SetStateAction<Client[]>>;
  onClose:       ()=>void;
}) {
  const [name,      setName]      = useState("");
  const [fteNeeded, setFteNeeded] = useState(1);

  async function save() {
    if (!name.trim()) return;
    const nc: Client = { id:genId("c"), name:name.trim(), departmentId:activeDeptId, fteNeeded, useFTE:true };
    const { error } = await sb.from("clients").insert({
      id:nc.id, name:nc.name, department_id:nc.departmentId, fte_needed:nc.fteNeeded, use_fte:true
    });
    if (!error) setClientsRaw(p => [...p, nc]);
    onClose();
  }
  return (
    <Modal title="➕ Nieuwe Klant / Locatie" onClose={onClose}>
      <ModalField label="NAAM">
        <input autoFocus value={name} onChange={e=>setName(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&save()} placeholder="Bijv. Locatie Noord..." style={inputSt}/>
      </ModalField>
      <ModalField label="FTE DOEL">
        <input type="number" step="0.5" min="0.5" value={fteNeeded}
          onChange={e=>setFteNeeded(parseFloat(e.target.value)||1)} style={{...inputSt,width:120}}/>
      </ModalField>
      <div style={{display:"flex",gap:8,marginTop:8}}>
        <button onClick={onClose} style={{flex:1,padding:10,background:"#1e293b",border:"none",color:"white",borderRadius:8,cursor:"pointer"}}>Annuleer</button>
        <button onClick={save} style={{flex:2,padding:10,background:"#10B981",border:"none",color:"white",borderRadius:8,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><Check size={14}/>Opslaan</button>
      </div>
    </Modal>
  );
});

// ─── AddSubcatModal ───────────────────────────────────────────────────────────
export const AddSubcatModal = React.memo(function AddSubcatModal({
  clientId, editing, skills, clients, setSubcatsRaw, syncSubcat, onClose
}: {
  clientId:      string;
  editing?:      Subcategory;
  skills:        Skill[];
  clients:       Client[];
  setSubcatsRaw: React.Dispatch<React.SetStateAction<Subcategory[]>>;
  syncSubcat:    (s:Subcategory)=>void;
  onClose:       ()=>void;
}) {
  const client       = clients.find(c => c.id === clientId);
  const [name,          setName]         = useState(editing?.name             || "");
  const [targetSkills,  setTargetSkills] = useState<string[]>(editing?.targetSkills || []);
  const [breakCover,    setBreakCover]   = useState(editing?.requireBreakCover || false);

  async function save() {
    if (!name.trim()) return;
    if (editing) {
      const upd = { ...editing, name:name.trim(), targetSkills, requireBreakCover:breakCover };
      setSubcatsRaw(p => p.map(s => s.id===editing.id ? upd : s));
      syncSubcat(upd);
    } else {
      const ns: Subcategory = { id:genId("sub"), clientId, name:name.trim(), targetSkills, requireBreakCover:breakCover };
      const { error } = await sb.from("subcategories").insert({
        id:ns.id, client_id:ns.clientId, name:ns.name, target_skills:ns.targetSkills, require_break_cover:ns.requireBreakCover
      });
      if (!error) setSubcatsRaw(p => [...p, ns]);
    }
    onClose();
  }
  function toggleSkill(sid: string) {
    setTargetSkills(prev => prev.includes(sid) ? prev.filter(x=>x!==sid) : [...prev, sid]);
  }
  return (
    <Modal title={editing ? "✏️ Subcategorie Bewerken" : "➕ Nieuwe Subcategorie"} onClose={onClose}>
      <div style={{fontSize:11,color:"#64748B",marginBottom:12}}>
        Klant: <strong style={{color:"#38BDF8"}}>{client?.name}</strong>
      </div>
      <ModalField label="NAAM SUBCATEGORIE">
        <input autoFocus value={name} onChange={e=>setName(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&save()} placeholder="Bijv. Receptie, Keuken..." style={inputSt}/>
      </ModalField>
      <ModalField label="VEREISTE SKILLS">
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {skills.map(s => {
            const has = targetSkills.includes(s.id);
            return (
              <button key={s.id} onClick={()=>toggleSkill(s.id)}
                style={{padding:"4px 10px",borderRadius:12,border:has?"1px solid #8B5CF6":"1px solid #334155",
                  background:has?"#8B5CF6":"transparent",color:has?"white":"#475569",cursor:"pointer",fontSize:11}}>
                {has?"✓ ":""}{s.name}
              </button>
            );
          })}
        </div>
      </ModalField>
      <ModalField label="PAUZE COVER">
        <div style={{display:"flex",alignItems:"center",gap:10,background:"#1e293b",borderRadius:8,padding:"10px 14px"}}>
          <button onClick={()=>setBreakCover(v=>!v)} style={{background:"none",border:"none",cursor:"pointer",padding:0}}>
            {breakCover ? <ToggleRight size={24} color="#F59E0B"/> : <ToggleLeft size={24} color="#475569"/>}
          </button>
          <span style={{fontSize:12,color:breakCover?"#F59E0B":"#94A3B8"}}>
            {breakCover ? "Pauzes moeten gedekt worden" : "Geen vervanging vereist"}
          </span>
        </div>
      </ModalField>
      <div style={{display:"flex",gap:8,marginTop:8}}>
        <button onClick={onClose} style={{flex:1,padding:10,background:"#1e293b",border:"none",color:"white",borderRadius:8,cursor:"pointer"}}>Annuleer</button>
        <button onClick={save} style={{flex:2,padding:10,background:"#10B981",border:"none",color:"white",borderRadius:8,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><Check size={14}/>Opslaan</button>
      </div>
    </Modal>
  );
});

// ─── AddShiftModal ────────────────────────────────────────────────────────────
export const AddShiftModal = React.memo(function AddShiftModal({
  setShiftsRaw, onClose
}: {
  setShiftsRaw: React.Dispatch<React.SetStateAction<ShiftDef[]>>;
  onClose:      ()=>void;
}) {
  const [label, setLabel] = useState("");
  const [hours, setHours] = useState<number[]>([]);

  async function save() {
    if (!label.trim()) return;
    const ns: ShiftDef = { id:genId("sh"), label:label.trim(), hours };
    const { error } = await sb.from("shift_defs").insert({ id:ns.id, label:ns.label, hours:ns.hours });
    if (!error) setShiftsRaw(p => [...p, ns]);
    onClose();
  }
  function toggle(h: number) {
    setHours(prev => prev.includes(h) ? prev.filter(x=>x!==h) : [...prev,h].sort((a,b)=>a-b));
  }
  return (
    <Modal title="➕ Nieuwe Shift" onClose={onClose}>
      <ModalField label="NAAM SHIFT">
        <input autoFocus value={label} onChange={e=>setLabel(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&save()} placeholder="Bijv. 07–15, Avond..." style={inputSt}/>
      </ModalField>
      <ModalField label="UREN SELECTEREN">
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {WORK_HOURS.map(h => {
            const on = hours.includes(h);
            return (
              <button key={h} onClick={()=>toggle(h)}
                style={{padding:"5px 8px",borderRadius:4,border:"none",fontSize:11,cursor:"pointer",
                  background:on?"#F59E0B":"#334155",color:on?"black":"#475569",fontWeight:on?700:400}}>
                {h}
              </button>
            );
          })}
        </div>
        {hours.length > 0 && (
          <div style={{fontSize:11,color:"#64748B",marginTop:8,fontFamily:"monospace"}}>
            {String(Math.min(...hours)).padStart(2,"0")}:00 – {String(Math.max(...hours)+1).padStart(2,"0")}:00 · {nettoUren(hours)}u netto
          </div>
        )}
      </ModalField>
      <div style={{display:"flex",gap:8,marginTop:8}}>
        <button onClick={onClose} style={{flex:1,padding:10,background:"#1e293b",border:"none",color:"white",borderRadius:8,cursor:"pointer"}}>Annuleer</button>
        <button onClick={save} style={{flex:2,padding:10,background:"#F59E0B",border:"none",color:"black",borderRadius:8,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><Check size={14}/>Opslaan</button>
      </div>
    </Modal>
  );
});

// ─── AddEmployeeModal ─────────────────────────────────────────────────────────
export const AddEmployeeModal = React.memo(function AddEmployeeModal({
  depts, shiftDefs, employees, activeDeptId, setEmployees, onClose
}: {
  depts:        Department[];
  shiftDefs:    ShiftDef[];
  employees:    Employee[];
  activeDeptId: string;
  setEmployees: React.Dispatch<React.SetStateAction<Employee[]>>;
  onClose:      ()=>void;
}) {
  const [name,           setName]          = useState("");
  const [deptId,         setDeptId]        = useState(activeDeptId);
  const [hoursPerWeek,   setHoursPerWeek]  = useState(40);
  const [color,          setColor]         = useState(COLORS[employees.length % COLORS.length]);
  const [breakPresetIdx, setBreakPresetIdx]= useState(3);
  const [defaultShiftId, setDefaultShiftId]= useState(shiftDefs[0]?.id || "");
  const [hourlyWage,     setHourlyWage]    = useState(0);

  async function save() {
    if (!name.trim()) return;
    const selectedBreaks = BREAK_PRESETS[breakPresetIdx].breaks.map(b => ({...b, id:genId("br")}));
    const newEmp: Employee = {
      id:genId("e"), name:name.trim(), departmentId:deptId,
      hoursPerWeek, mainClientId:"", subCatIds:[], subCatSkills:{},
      standardOffDays:["Zaterdag","Zondag"], vacationDates:[],
      defaultShiftId, hourlyWage, isAdmin:false, color, breaks:selectedBreaks,
    };
    await sb.from("employees").insert({
      id:newEmp.id, name:newEmp.name, department_id:newEmp.departmentId,
      hours_per_week:newEmp.hoursPerWeek, main_client_id:null,
      sub_cat_ids:[], sub_cat_skills:{},
      standard_off_days:newEmp.standardOffDays, vacation_dates:[],
      default_shift_id:newEmp.defaultShiftId||null, hourly_wage:newEmp.hourlyWage,
      is_admin:false, color:newEmp.color, breaks:newEmp.breaks, pause_config:newEmp.breaks,
    });
    setEmployees(p => [...p, newEmp]);
    onClose();
  }
  return (
    <Modal title="➕ Nieuwe Medewerker" onClose={onClose} width="480px">
      <ModalField label="NAAM">
        <input autoFocus value={name} onChange={e=>setName(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&save()} placeholder="Voor- en achternaam" style={inputSt}/>
      </ModalField>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <ModalField label="AFDELING">
          <select value={deptId} onChange={e=>setDeptId(e.target.value)} style={selectSt}>
            {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </ModalField>
        <ModalField label="UREN PER WEEK">
          <input type="number" min={1} max={80} value={hoursPerWeek}
            onChange={e=>setHoursPerWeek(+e.target.value)} style={inputSt}/>
        </ModalField>
        <ModalField label="UURLOON (€)">
          <input type="number" step="0.01" min={0} value={hourlyWage}
            onChange={e=>setHourlyWage(parseFloat(e.target.value)||0)} style={inputSt}/>
        </ModalField>
        <ModalField label="STANDAARD SHIFT">
          <select value={defaultShiftId} onChange={e=>setDefaultShiftId(e.target.value)} style={selectSt}>
            <option value="">Geen</option>
            {shiftDefs.map(sh => <option key={sh.id} value={sh.id}>{sh.label}</option>)}
          </select>
        </ModalField>
      </div>
      <ModalField label="PAUZE SCHEMA">
        <select value={breakPresetIdx} onChange={e=>setBreakPresetIdx(+e.target.value)} style={selectSt}>
          {BREAK_PRESETS.map((p,i) => <option key={i} value={i}>{p.label}</option>)}
        </select>
        {BREAK_PRESETS[breakPresetIdx].breaks.length > 0 && (
          <div style={{marginTop:8,display:"flex",flexWrap:"wrap",gap:4}}>
            {BREAK_PRESETS[breakPresetIdx].breaks.map((b,i) => (
              <span key={i} style={{background:"rgba(245,158,11,.12)",color:"#F59E0B",
                border:"1px solid rgba(245,158,11,.2)",borderRadius:8,padding:"2px 8px",fontSize:10}}>
                ☕ {b.label}: {fmtTime(b.startHour,b.startMin)}–{fmtTime(b.endHour,b.endMin)}
              </span>
            ))}
          </div>
        )}
      </ModalField>
      <ModalField label="KLEUR">
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <ColorPicker value={color} onChange={setColor}/>
          <span style={{fontSize:11,color:"#64748B"}}>Klik om kleur te kiezen</span>
          <div style={{marginLeft:"auto",display:"flex",gap:4}}>
            {COLORS.slice(0,8).map(c => (
              <div key={c} onClick={()=>setColor(c)}
                style={{width:18,height:18,borderRadius:"50%",background:c,cursor:"pointer",
                  border:c===color?"2px solid white":"2px solid transparent"}}/>
            ))}
          </div>
        </div>
      </ModalField>
      <div style={{display:"flex",gap:8,marginTop:8}}>
        <button onClick={onClose} style={{flex:1,padding:10,background:"#1e293b",border:"none",color:"white",borderRadius:8,cursor:"pointer"}}>Annuleer</button>
        <button onClick={save} style={{flex:2,padding:10,background:"#3B82F6",border:"none",color:"white",borderRadius:8,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><Check size={14}/>Aanmaken</button>
      </div>
    </Modal>
  );
});

// ─── ChangePasswordModal ──────────────────────────────────────────────────────
export const ChangePasswordModal = React.memo(function ChangePasswordModal({
  userId, userName, currentUserId, onClose
}: {
  userId:        string;
  userName:      string;
  currentUserId: string;
  onClose:       ()=>void;
}) {
  const [pw,      setPw]      = useState("");
  const [pw2,     setPw2]     = useState("");
  const [status,  setStatus]  = useState<{type:"ok"|"err";msg:string}|null>(null);
  const [loading, setLoading] = useState(false);

  async function save() {
    if (!pw.trim() || pw.length < 6) { setStatus({type:"err",msg:"Minimaal 6 tekens."}); return; }
    if (pw !== pw2)                   { setStatus({type:"err",msg:"Wachtwoorden komen niet overeen."}); return; }
    setLoading(true);
    try {
      if (userId === currentUserId) {
        const { error } = await sb.auth.updateUser({ password:pw });
        if (error) throw error;
        setStatus({type:"ok",msg:"Wachtwoord succesvol gewijzigd!"});
        setTimeout(() => onClose(), 1500);
      } else {
        setStatus({type:"ok",msg:`Stuur een wachtwoord-reset e-mail naar de gebruiker of gebruik het Supabase dashboard om het wachtwoord van ${userName} te wijzigen.`});
      }
    } catch(e:any) { setStatus({type:"err",msg:e.message||"Fout opgetreden."}); }
    setLoading(false);
  }
  return (
    <Modal title={`🔑 Wachtwoord wijzigen — ${userName}`} onClose={onClose} width="380px">
      <ModalField label="NIEUW WACHTWOORD">
        <input type="password" autoFocus value={pw} onChange={e=>setPw(e.target.value)}
          placeholder="Minimaal 6 tekens" style={inputSt}/>
      </ModalField>
      <ModalField label="BEVESTIG WACHTWOORD">
        <input type="password" value={pw2} onChange={e=>setPw2(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&save()} placeholder="Herhaal wachtwoord" style={inputSt}/>
      </ModalField>
      {status && (
        <div style={{background:status.type==="ok"?"rgba(16,185,129,.1)":"rgba(239,68,68,.1)",
          border:`1px solid ${status.type==="ok"?"rgba(16,185,129,.3)":"rgba(239,68,68,.3)"}`,
          color:status.type==="ok"?"#6EE7B7":"#FCA5A5",borderRadius:8,
          padding:"10px 14px",marginBottom:14,fontSize:12}}>
          {status.msg}
        </div>
      )}
      <div style={{display:"flex",gap:8,marginTop:8}}>
        <button onClick={onClose} style={{flex:1,padding:10,background:"#1e293b",border:"none",color:"white",borderRadius:8,cursor:"pointer"}}>Annuleer</button>
        <button onClick={save} disabled={loading}
          style={{flex:2,padding:10,background:"#8B5CF6",border:"none",color:"white",borderRadius:8,cursor:"pointer",
            fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:6,opacity:loading?.7:1}}>
          <Key size={14}/>{loading?"Opslaan...":"Wachtwoord opslaan"}
        </button>
      </div>
    </Modal>
  );
});

// ─── VacationModal ────────────────────────────────────────────────────────────
export const VacationModal = React.memo(function VacationModal({
  emp, onClose, updEmployee
}: {
  emp:         Employee;
  onClose:     ()=>void;
  updEmployee: (emp:Employee)=>void;
}) {
  const [month, setMonth] = useState(new Date().getMonth());
  const [year,  setYear]  = useState(new Date().getFullYear());

  function vacCells(): (Date|null)[] {
    const dates = datesInMonth(month, year);
    const fd    = new Date(year, month, 1).getDay();
    const off   = fd === 0 ? 6 : fd - 1;
    const cells: (Date|null)[] = Array(off).fill(null).concat(dates);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }
  function toggleOff(day: string) {
    const has = emp.standardOffDays.includes(day);
    updEmployee({...emp, standardOffDays: has ? emp.standardOffDays.filter(d=>d!==day) : [...emp.standardOffDays, day]});
  }
  function toggleVac(ds: string) {
    const has = emp.vacationDates.includes(ds);
    updEmployee({...emp, vacationDates: has ? emp.vacationDates.filter(d=>d!==ds) : [...emp.vacationDates, ds]});
  }
  const cells = vacCells();

  return (
    <Modal title={`🌴 Vakantie & Vrije Dagen — ${emp.name}`} onClose={onClose} width="520px">
      <div style={{marginBottom:16,background:"#1e293b",borderRadius:10,padding:14}}>
        <div style={{fontSize:11,color:"#F59E0B",fontWeight:"bold",marginBottom:8}}>VASTE VRIJE DAGEN</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {DAY_LABELS.map(day => {
            const isOff = emp.standardOffDays.includes(day);
            return (
              <button key={day} onClick={()=>toggleOff(day)}
                style={{padding:"5px 12px",borderRadius:20,border:"none",fontSize:12,cursor:"pointer",
                  background:isOff?"#EF4444":"#334155",color:isOff?"white":"#94A3B8",fontWeight:isOff?"bold":"normal"}}>
                {day.slice(0,2)}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <button onClick={()=>{ if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1); }}
          style={{background:"#1e293b",border:"none",color:"white",borderRadius:6,padding:"5px 14px",cursor:"pointer"}}>‹</button>
        <span style={{fontWeight:"bold",color:"white"}}>{MONTH_LABELS[month]} {year}</span>
        <button onClick={()=>{ if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1); }}
          style={{background:"#1e293b",border:"none",color:"white",borderRadius:6,padding:"5px 14px",cursor:"pointer"}}>›</button>
      </div>
      <div style={{background:"#1e293b",borderRadius:10,padding:12}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:6}}>
          {["Ma","Di","Wo","Do","Vr","Za","Zo"].map(d=>(
            <div key={d} style={{textAlign:"center",fontSize:10,color:"#64748B",fontWeight:"bold",padding:"4px 0"}}>{d}</div>
          ))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
          {cells.map((date,i) => {
            if (!date) return <div key={i}/>;
            const ds  = fmtDate(date);
            const dl  = dayLabel(date);
            const isStd = emp.standardOffDays.includes(dl);
            const isVac = emp.vacationDates.includes(ds);
            let bg="#1e293b", col="#94A3B8", lbl="";
            if (isStd) { bg="#7C3AED22"; col="#7C3AED"; lbl="V"; }
            if (isVac) { bg="#F59E0B";   col="white";   lbl="🌴"; }
            return (
              <div key={ds} onClick={()=>!isStd&&toggleVac(ds)}
                style={{textAlign:"center",padding:"6px 2px",borderRadius:6,fontSize:12,
                  cursor:isStd?"not-allowed":"pointer",background:bg,color:col,
                  fontWeight:isVac?"bold":"normal",userSelect:"none"}}>
                <div>{date.getDate()}</div>
                {lbl && <div style={{fontSize:9}}>{lbl}</div>}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{display:"flex",gap:16,marginTop:12,fontSize:10,color:"#64748B"}}>
        <span><span style={{color:"#7C3AED"}}>■</span> Vaste vrije dag</span>
        <span><span style={{color:"#F59E0B"}}>■</span> Vakantie</span>
        <span style={{marginLeft:"auto"}}>Totaal: <strong style={{color:"white"}}>{emp.vacationDates.length} vakantiedagen</strong></span>
      </div>
    </Modal>
  );
});

// ─── CustomShiftModal ─────────────────────────────────────────────────────────
export const CustomShiftModal = React.memo(function CustomShiftModal({
  slotId, rowIdx, schedule, updSchedule, onClose
}: {
  slotId:      string;
  rowIdx:      number;
  schedule:    Record<string,SlotEntry>;
  updSchedule: (slotId:string, entry:SlotEntry)=>void;
  onClose:     ()=>void;
}) {
  const [customStart, setCustomStart] = useState(8);
  const [customEnd,   setCustomEnd]   = useState(17);

  function apply() {
    const hours: number[] = [];
    for (let h = customStart; h < customEnd; h++) {
      if (WORK_HOURS.includes(h)) hours.push(h);
    }
    const entry = schedule[slotId] || { rows:[] };
    const rows  = [...entry.rows];
    if (rows[rowIdx]) rows[rowIdx] = { ...rows[rowIdx], shiftId:"custom", selectedHours:hours };
    updSchedule(slotId, { rows });
    onClose();
  }
  const bruto = customEnd - customStart;
  const netto = bruto >= 9 ? bruto - 1 : bruto;

  return (
    <Modal title="✏️ Aangepaste Tijden" onClose={onClose} width="300px">
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
        <ModalField label="BEGINTIJD">
          <select value={customStart} onChange={e=>setCustomStart(+e.target.value)} style={selectSt}>
            {WORK_HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}
          </select>
        </ModalField>
        <ModalField label="EINDTIJD">
          <select value={customEnd} onChange={e=>setCustomEnd(+e.target.value)} style={selectSt}>
            {WORK_HOURS.filter(h=>h>customStart).map(h => <option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}
          </select>
        </ModalField>
      </div>
      <div style={{background:"#1e293b",borderRadius:6,padding:10,marginBottom:16,fontSize:11,color:"#64748B",fontFamily:"monospace"}}>
        {bruto>=9
          ? <>{bruto}u − 1u pauze = <span style={{color:"#10B981"}}>{netto}u netto</span></>
          : <span style={{color:"#10B981"}}>{netto}u netto</span>}
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={onClose} style={{flex:1,padding:9,background:"#1e293b",border:"none",color:"white",borderRadius:8,cursor:"pointer"}}>Annuleer</button>
        <button onClick={apply}   style={{flex:1,padding:9,background:"#F59E0B",border:"none",color:"black", borderRadius:8,cursor:"pointer",fontWeight:"bold"}}>✓ Toepassen</button>
      </div>
    </Modal>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// PLANNING CEL (buiten App)
// ══════════════════════════════════════════════════════════════════════════════
export const PlanningCell = React.memo(function PlanningCell({
  slotId, date, avail, schedule, employees, shiftDefs, subcats,
  updSchedule, updEmployee, geplandUrenWeek, assignCoverForRow, defaultHours
}: {
  slotId:            string;
  date:              Date;
  avail:             Employee[];
  schedule:          Record<string,SlotEntry>;
  employees:         Employee[];
  shiftDefs:         ShiftDef[];
  subcats:           Subcategory[];
  updSchedule:       (slotId:string, entry:SlotEntry)=>void;
  updEmployee:       (emp:Employee)=>void;
  geplandUrenWeek:   (empId:string, refDate:Date)=>number;
  assignCoverForRow: (slotId:string, rowIdx:number, emp:Employee, date:Date)=>string|undefined;
  defaultHours:      (emp:Employee)=>number[];
}) {
  const entry = schedule[slotId] || { rows:[] };
  const sub   = subcats.find(s => slotId.includes(s.id));

  function getShift(id: string) { return shiftDefs.find(s => s.id === id); }
  function isOverLimit(emp: Employee) { return geplandUrenWeek(emp.id, date) >= emp.hoursPerWeek; }

  function availForRow(ri: number): Employee[] {
    const used = entry.rows.filter((_,i) => i !== ri).map(r => r.employeeId).filter(Boolean);
    return avail.filter(e => !used.includes(e.id));
  }

  function addRow() {
    if (entry.rows.length >= 3) return;
    const used = entry.rows.map(r => r.employeeId);
    const next = avail.find(e => !used.includes(e.id));
    const sh   = (next?.defaultShiftId ? getShift(next.defaultShiftId) : undefined) || shiftDefs[1] || shiftDefs[0];
    updSchedule(slotId, { rows:[...entry.rows, {
      employeeId:next?.id||"", shiftId:sh?.id||"",
      selectedHours: next ? (sh?.hours||defaultHours(next)) : []
    }]});
  }
  function removeRow(i: number) {
    updSchedule(slotId, { rows:entry.rows.filter((_,ri)=>ri!==i) });
  }
  function setEmp(i: number, empId: string) {
    const emp = employees.find(e => e.id === empId);
    const sh  = (emp?.defaultShiftId ? getShift(emp.defaultShiftId) : undefined) || shiftDefs[1] || shiftDefs[0];
    const rows = [...entry.rows];
    const coverEmpId = emp ? assignCoverForRow(slotId, i, emp, date) : undefined;
    rows[i] = { employeeId:empId, shiftId:sh?.id||"", selectedHours:emp?(sh?.hours||defaultHours(emp)):[], coverEmployeeId:coverEmpId };
    updSchedule(slotId, { rows });
  }
  function applyShift(i: number, shiftId: string) {
    // Custom shift wordt afgehandeld via de CustomShiftModal in App
    if (shiftId === "custom") {
      // Emit een event om de custom modal te openen — we doen dit via een callback
      return;
    }
    const sh   = getShift(shiftId);
    const rows = [...entry.rows];
    rows[i] = { ...rows[i], shiftId, selectedHours:sh ? sh.hours : rows[i].selectedHours };
    updSchedule(slotId, { rows });
  }
  function applyBreakPreset(i: number, presetIdx: number) {
    const emp = employees.find(e => e.id === entry.rows[i]?.employeeId);
    if (!emp) return;
    const newBreaks = BREAK_PRESETS[presetIdx].breaks.map(b => ({...b, id:genId("br")}));
    updEmployee({ ...emp, breaks:newBreaks });
  }
  function setCover(rowIdx: number, coverId: string) {
    const rows = [...entry.rows];
    rows[rowIdx] = { ...rows[rowIdx], coverEmployeeId:coverId||undefined };
    updSchedule(slotId, { rows });
  }

  return (
    <td style={{padding:4,verticalAlign:"top",minWidth:190,borderBottom:"1px solid #0a0f1a",borderRight:"1px solid #0a0f1a"}}>
      {entry.rows.map((row, ri) => {
        const emp        = employees.find(e => e.id === row.employeeId);
        const empColor   = emp?.color || (ri===0?"#3B82F6":"#7C3AED");
        const textCol    = emp ? contrastColor(empColor) : "white";
        const over       = emp ? isOverLimit(emp) : false;
        const netto      = emp ? nettoUrenEmp(emp, row.selectedHours) : nettoUren(row.selectedHours);
        const breakMins  = emp ? calcBreakMins(emp.breaks, row.selectedHours) : (row.selectedHours?.length>=9?60:0);
        const coverEmp   = row.coverEmployeeId ? employees.find(e=>e.id===row.coverEmployeeId) : null;
        const currentBPI = emp ? BREAK_PRESETS.findIndex(p =>
          p.breaks.length === emp.breaks.length &&
          p.breaks.every((b,bi) => emp.breaks[bi] &&
            b.startHour===emp.breaks[bi].startHour && b.startMin===emp.breaks[bi].startMin)
        ) : -1;

        return (
          <div key={ri} style={{marginBottom:ri<entry.rows.length-1?6:0,
            borderBottom:ri<entry.rows.length-1?"1px dashed #1e293b":"none",
            paddingBottom:ri<entry.rows.length-1?6:0}}>

            {/* Medewerker dropdown */}
            <div style={{display:"flex",gap:2,marginBottom:3}}>
              <select value={row.employeeId} onChange={e=>setEmp(ri,e.target.value)}
                style={{flex:1,padding:"5px 6px",borderRadius:6,
                  background:row.employeeId?empColor:"#1e293b",
                  color:row.employeeId?textCol:"#64748B",
                  border:over?"2px solid #EF4444":"1px solid #334155",
                  fontSize:12,cursor:"pointer",fontWeight:row.employeeId?700:400}}>
                <option value="">— Medewerker —</option>
                {availForRow(ri).map(e => {
                  const ol = isOverLimit(e);
                  return (
                    <option key={e.id} value={e.id} style={{color:ol?"#EF4444":"white",background:"#1e293b"}}>
                      {e.name}{ol?" ⚠":""}
                    </option>
                  );
                })}
              </select>
              <button onClick={()=>removeRow(ri)} style={{background:"#1e293b",border:"none",
                color:"#475569",borderRadius:4,width:22,cursor:"pointer",fontSize:11,
                display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            </div>

            {over && row.employeeId && (
              <div style={{fontSize:9,color:"#EF4444",marginBottom:3,display:"flex",alignItems:"center",gap:3}}>
                <AlertTriangle size={9}/> Weekuren overschreden
              </div>
            )}

            {row.employeeId && (
              <>
                {/* Shift dropdown */}
                <div style={{marginBottom:3}}>
                  <select value={row.shiftId||""} onChange={e=>applyShift(ri,e.target.value)}
                    style={{width:"100%",padding:"4px 6px",background:"#0f172a",
                      color:"#F59E0B",border:"1px solid #334155",borderRadius:5,
                      fontSize:11,cursor:"pointer"}}>
                    <option value="">— Shift kiezen —</option>
                    {shiftDefs.map(sh => (
                      <option key={sh.id} value={sh.id}>
                        🕐 {sh.label} ({sh.hours.length>0
                          ? `${String(Math.min(...sh.hours)).padStart(2,"0")}:00–${String(Math.max(...sh.hours)+1).padStart(2,"0")}:00`
                          : "?"})
                      </option>
                    ))}
                    <option value="custom">✏️ Aangepaste tijden</option>
                  </select>
                </div>

                {/* Pauze dropdown */}
                <div style={{marginBottom:3}}>
                  <select value={currentBPI>=0?currentBPI:""}
                    onChange={e=>applyBreakPreset(ri,+e.target.value)}
                    style={{width:"100%",padding:"4px 6px",background:"#0f172a",
                      color:"#F59E0B",border:"1px solid #334155",borderRadius:5,
                      fontSize:11,cursor:"pointer"}}>
                    <option value="">☕ Pauze schema</option>
                    {BREAK_PRESETS.map((p,i) => <option key={i} value={i}>☕ {p.label}</option>)}
                  </select>
                </div>

                {/* Visuele uurblokjes */}
                <div style={{display:"flex",gap:1,marginBottom:3}}>
                  {WORK_HOURS.map(h => {
                    const on  = row.selectedHours?.includes(h);
                    const brk = emp ? isBreakHour(emp, h) : false;
                    return (
                      <div key={h} title={`${String(h).padStart(2,"0")}:00${brk?" ☕":""}`}
                        style={{flex:1,height:8,borderRadius:1,
                          background:on
                            ? (brk ? `repeating-linear-gradient(45deg,${empColor} 0,${empColor} 2px,#0f172a 2px,#0f172a 4px)` : empColor)
                            : "#1e293b"}}/>
                    );
                  })}
                </div>

                {/* Tijdinfo */}
                <div style={{fontSize:10,color:"#94A3B8",marginBottom:3,fontWeight:600}}>
                  {shiftTimeStr(row.selectedHours)}
                  {row.selectedHours?.length>0 && (
                    <span style={{color:"#64748B"}}> · {netto.toFixed(1)}u netto</span>
                  )}
                </div>

                {/* Pauze badge */}
                {breakMins > 0 && (
                  <div style={{background:"rgba(245,158,11,.1)",border:"1px solid rgba(245,158,11,.25)",
                    borderRadius:4,padding:"2px 6px",marginBottom:3,fontSize:10,color:"#F59E0B",
                    display:"flex",alignItems:"center",gap:4}}>
                    <Coffee size={9}/>
                    <span>Pauze: {breakMins} min</span>
                    {coverEmp && <span style={{color:"#10B981",marginLeft:4}}>→ {coverEmp.name.split(" ")[0]}</span>}
                  </div>
                )}

                {/* Pauze cover */}
                {emp && breakMins > 0 && sub?.requireBreakCover && (
                  <div style={{background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.2)",
                    borderRadius:4,padding:"4px 6px",marginTop:2}}>
                    <div style={{fontSize:9,color:"#F59E0B",fontWeight:700,marginBottom:3}}>☕ VERVANGER PAUZE</div>
                    <select value={row.coverEmployeeId||""}
                      onChange={e=>setCover(ri,e.target.value)}
                      style={{width:"100%",background:"#1e293b",
                        color:coverEmp?"#10B981":"#64748B",
                        border:`1px solid ${coverEmp?"#10B981":"#334155"}`,
                        borderRadius:4,padding:"3px 5px",fontSize:10}}>
                      <option value="">— Vervanger kiezen —</option>
                      {avail.filter(e=>e.id!==row.employeeId).map(e=>(
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                    {coverEmp && (
                      <div style={{fontSize:9,color:"#10B981",marginTop:3,display:"flex",alignItems:"center",gap:3}}>
                        <Check size={8}/> <strong>{coverEmp.name}</strong> vervangt tijdens pauze
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}

      {entry.rows.length < 3 && (
        <button onClick={addRow} style={{width:"100%",marginTop:3,padding:"3px 6px",
          background:"none",border:"1px dashed #1e293b",color:"#475569",
          borderRadius:4,fontSize:10,cursor:"pointer",display:"flex",
          alignItems:"center",justifyContent:"center",gap:4}}>
          <Plus size={10}/> medewerker
        </button>
      )}
    </td>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN PANEL (buiten App)
// ══════════════════════════════════════════════════════════════════════════════
export const AdminPanel = React.memo(function AdminPanel({
  currentUserId, activeDeptId, depts, employees, setEmployees, setAddModal
}: {
  currentUserId: string;
  activeDeptId:  string;
  depts:         Department[];
  employees:     Employee[];
  setEmployees:  React.Dispatch<React.SetStateAction<Employee[]>>;
  setAddModal:   (v:any)=>void;
}) {
  const [naam,       setNaam]      = useState("");
  const [email,      setEmail]     = useState("");
  const [password,   setPassword]  = useState("");
  const [isAdminNew, setIsAdminNew]= useState(false);
  const [loading,    setLoading]   = useState(false);
  const [status,     setStatus]    = useState<{type:"ok"|"err";msg:string}|null>(null);
  const [allUsers,   setAllUsers]  = useState<any[]>([]);

  useEffect(() => {
    sb.from("employees").select("id,name,email,is_admin,department_id,color")
      .then(({ data }) => { if (data) setAllUsers(data); });
  }, []);

  async function addUser() {
    if (!naam.trim()||!email.trim()||!password.trim()) {
      setStatus({type:"err",msg:"Vul alle velden in."}); return;
    }
    setLoading(true); setStatus(null);
    try {
      const { data:sd, error:se } = await sb.auth.signUp({ email, password });
      if (se) throw se;
      const uid = sd.user?.id;
      if (!uid) throw new Error("Geen user-ID van Supabase Auth.");
      const col = COLORS[employees.length % COLORS.length];
      const { data, error } = await sb.from("employees").insert({
        id:uid, name:naam, email, is_admin:isAdminNew,
        department_id:activeDeptId||depts[0]?.id||null,
        hours_per_week:0, main_client_id:null, sub_cat_ids:[], sub_cat_skills:{},
        standard_off_days:[], vacation_dates:[], default_shift_id:null,
        hourly_wage:0, color:col, breaks:[], pause_config:[],
      }).select();
      if (error) throw error;
      if (data) setAllUsers(p => [...p, data[0]]);
      setStatus({type:"ok",msg:`✅ Gebruiker ${naam} aangemaakt. Verificatiemail verstuurd naar ${email}.`});
      setNaam(""); setEmail(""); setPassword("");
    } catch(e:any) { setStatus({type:"err",msg:"Fout: "+(e.message||"Onbekend")}); }
    setLoading(false);
  }

  async function toggleAdmin(uid: string, cur: boolean) {
    const { error } = await sb.from("employees").update({is_admin:!cur}).eq("id",uid);
    if (!error) {
      setAllUsers(p => p.map(u => u.id===uid?{...u,is_admin:!cur}:u));
      setEmployees(p => p.map(e => e.id===uid?{...e,isAdmin:!cur}:e));
    }
  }
  async function removeUser(uid: string) {
    if (!window.confirm("Gebruikersaccount verwijderen?")) return;
    await sb.from("employees").update({email:null}).eq("id",uid);
    setAllUsers(p => p.filter(u => u.id !== uid));
  }

  return (
    <div style={{display:"grid",gap:20,maxWidth:700}}>
      <div style={{background:"rgba(245,158,11,.06)",border:"1px solid rgba(245,158,11,.2)",
        borderRadius:10,padding:"12px 16px",fontSize:12,color:"#F59E0B"}}>
        <strong>ℹ️ Gebruikers vs. Medewerkers:</strong> Gebruikers hebben login-toegang. Medewerkers zijn in de planning.
        Maak beide apart aan via de respectievelijke tabbladen.
      </div>

      <div style={{background:"#0f172a",borderRadius:16,padding:28,border:"1px solid #1e293b"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:24}}>
          <Shield size={20} color="#8B5CF6"/>
          <h3 style={{margin:0,color:"white",fontSize:16,fontWeight:700}}>Nieuwe login-gebruiker aanmaken</h3>
        </div>
        <ModalField label="NAAM"><input type="text" value={naam} onChange={e=>setNaam(e.target.value)} placeholder="Jan de Vries" style={inputSt}/></ModalField>
        <ModalField label="E-MAILADRES"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="jan@bedrijf.nl" style={inputSt}/></ModalField>
        <ModalField label="WACHTWOORD"><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Minimaal 6 tekens" style={inputSt}/></ModalField>
        <div style={{display:"flex",alignItems:"center",gap:10,background:"#1e293b",borderRadius:8,padding:"12px 14px",marginBottom:14}}>
          <button onClick={()=>setIsAdminNew(v=>!v)} style={{background:"none",border:"none",cursor:"pointer",padding:0}}>
            {isAdminNew?<ToggleRight size={28} color="#8B5CF6"/>:<ToggleLeft size={28} color="#475569"/>}
          </button>
          <div>
            <div style={{fontSize:13,color:isAdminNew?"#C4B5FD":"#94A3B8",fontWeight:600}}>{isAdminNew?"Beheerder":"Standaard gebruiker"}</div>
            <div style={{fontSize:11,color:"#475569"}}>{isAdminNew?"Toegang tot financiën & gebruikersbeheer":"Alleen planning inzien/bewerken"}</div>
          </div>
        </div>
        {status && (
          <div style={{background:status.type==="ok"?"rgba(16,185,129,.1)":"rgba(239,68,68,.1)",
            border:`1px solid ${status.type==="ok"?"rgba(16,185,129,.3)":"rgba(239,68,68,.3)"}`,
            color:status.type==="ok"?"#6EE7B7":"#FCA5A5",
            borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12}}>{status.msg}</div>
        )}
        <button onClick={addUser} disabled={loading}
          style={{width:"100%",padding:11,background:"#8B5CF6",border:"none",color:"white",borderRadius:8,fontWeight:700,cursor:loading?"wait":"pointer",opacity:loading?.7:1}}>
          {loading?"Aanmaken...":"➕ Gebruiker aanmaken"}
        </button>
      </div>

      <div style={{background:"#0f172a",borderRadius:16,padding:28,border:"1px solid #1e293b"}}>
        <h3 style={{margin:"0 0 18px 0",color:"white",fontSize:15,fontWeight:700}}>
          Alle gebruikers ({allUsers.length})
        </h3>
        {allUsers.map(u => (
          <div key={u.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
            background:"#1e293b",borderRadius:8,padding:"12px 14px",marginBottom:8,
            borderLeft:`3px solid ${u.color||"#3B82F6"}`}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:10,height:10,borderRadius:"50%",background:u.color||"#3B82F6"}}/>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:"white"}}>{u.name}</div>
                <div style={{fontSize:10,color:"#64748B",marginTop:2}}>{u.email||"Geen e-mail"}</div>
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <button onClick={()=>toggleAdmin(u.id,u.is_admin)}
                style={{background:u.is_admin?"rgba(139,92,246,.15)":"#0f172a",
                  border:`1px solid ${u.is_admin?"#8B5CF6":"#334155"}`,
                  color:u.is_admin?"#8B5CF6":"#475569",
                  borderRadius:6,padding:"4px 10px",fontSize:11,cursor:"pointer",fontWeight:600}}>
                {u.is_admin?"⭐ Admin":"👤 Gebruiker"}
              </button>
              <button onClick={()=>setAddModal({type:"changePassword",data:{userId:u.id,userName:u.name}})}
                style={{background:"#0f172a",border:"1px solid #334155",color:"#64748B",
                  borderRadius:6,padding:"4px 8px",fontSize:11,cursor:"pointer",
                  display:"flex",alignItems:"center",gap:3}}>
                <Key size={11}/> Ww
              </button>
              {u.id !== currentUserId && (
                <button onClick={()=>removeUser(u.id)} style={{background:"none",border:"none",color:"#EF4444",cursor:"pointer"}}>
                  <Trash2 size={14}/>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// HOOFD APP
// ══════════════════════════════════════════════════════════════════════════════
function App({ session }: { session:Session }) {
  const [activeTab, setActiveTab] = useState<"planning"|"medewerkers"|"beheer"|"financieel"|"admin">("planning");

  const [depts,     setDeptsRaw]    = useState<Department[]>([]);
  const [skills,    setSkillsRaw]   = useState<Skill[]>([]);
  const [shiftDefs, setShiftsRaw]   = useState<ShiftDef[]>([]);
  const [clients,   setClientsRaw]  = useState<Client[]>([]);
  const [subcats,   setSubcatsRaw]  = useState<Subcategory[]>([]);
  const [employees, setEmployees]   = useState<Employee[]>([]);
  const [schedule,  setSchedule]    = useState<Record<string,SlotEntry>>({});

  const [activeDeptId, setActiveDeptId] = useState("");
  const [viewType,     setViewType]     = useState<"week"|"maand">("week");
  const [useFTE,       setUseFTE]       = useState(true);
  const [loading,      setLoading]      = useState(true);

  const today = new Date();
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(today));
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [viewYear,  setViewYear]  = useState(today.getFullYear());

  // Modal state — één object
  const [addModal, setAddModal] = useState<{
    type: "dept"|"skill"|"client"|"subcat"|"shift"|"employee"|"editSkill"|"editSubcat"|"changePassword"|null;
    data?: any;
  }>({ type:null });

  // Afzonderlijke modals
  const [vacModalEmpId,    setVacModalEmpId]    = useState<string|null>(null);
  const [customShiftSlot,  setCustomShiftSlot]  = useState<{slotId:string;rowIdx:number}|null>(null);
  const [showPDFModal,     setShowPDFModal]     = useState(false);
  const [showCalcFor,      setShowCalcFor]      = useState<string|null>(null);

  const currentUserId = session.user.id;
  const currentEmp    = employees.find(e => e.id === currentUserId) ?? employees.find(e => e.isAdmin);
  const isAdmin       = currentEmp?.isAdmin ?? false;

  // ─── Data laden ─────────────────────────────────────────────────────────────
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
        if (dr.data?.length)  setDeptsRaw(dr.data.map((x:any) => ({id:x.id,name:x.name})));
        if (skr.data?.length) setSkillsRaw(skr.data.map((x:any) => ({id:x.id,name:x.name,criteria:x.criteria||""})));
        if (shr.data?.length) setShiftsRaw(shr.data.map((x:any) => ({id:x.id,label:x.label,hours:x.hours||[]})));
        if (cr.data?.length)  setClientsRaw(cr.data.map((x:any) => ({id:x.id,name:x.name,departmentId:x.department_id,fteNeeded:x.fte_needed||1,useFTE:x.use_fte!==false})));
        if (scr.data?.length) setSubcatsRaw(scr.data.map((x:any) => ({id:x.id,clientId:x.client_id,name:x.name,targetSkills:x.target_skills||[],requireBreakCover:x.require_break_cover||false})));
        if (er.data?.length)  setEmployees(er.data.map((x:any) => ({
          id:x.id,name:x.name,departmentId:x.department_id,
          hoursPerWeek:x.hours_per_week||40,mainClientId:x.main_client_id||"",
          subCatIds:x.sub_cat_ids||[],subCatSkills:x.sub_cat_skills||{},
          standardOffDays:x.standard_off_days||[],vacationDates:x.vacation_dates||[],
          defaultShiftId:x.default_shift_id||"",hourlyWage:x.hourly_wage||0,
          isAdmin:x.is_admin||false,color:x.color||COLORS[0],
          breaks:(x.pause_config||x.breaks||[]).map((b:any) => ({
            id:b.id||genId("br"),
            startHour:b.startHour??(b.start?parseInt(b.start.split(":")[0]):12),
            startMin :b.startMin ??(b.start?parseInt(b.start.split(":")[1]||"0"):0),
            endHour  :b.endHour  ??(b.end  ?parseInt(b.end.split(":")[0]):12),
            endMin   :b.endMin   ??(b.end  ?parseInt(b.end.split(":")[1]||"0"):30),
            label    :b.label||"Pauze",
          })),
        })));
        if (schr.data?.length) {
          const built: Record<string,SlotEntry> = {};
          schr.data.forEach((x:any) => { built[x.slot_id] = { rows:x.rows||[] }; });
          setSchedule(built);
        }
        if (dr.data?.length) setActiveDeptId(dr.data[0].id);
      } catch(e) { console.error("DB laad-fout:", e); }
      setLoading(false);
    })();
  }, []);

  // ─── Sync helpers ───────────────────────────────────────────────────────────
  const _sCell = useCallback(async (sid:string, e:SlotEntry) => {
    await sb.from("schedule").upsert({slot_id:sid,rows:e.rows,updated_at:new Date().toISOString()},{onConflict:"slot_id"});
  }, []);
  const syncCell = useDebounce(_sCell, 500);

  const _sEmp = useCallback(async (emp:Employee) => {
    await sb.from("employees").upsert({
      id:emp.id,name:emp.name,department_id:emp.departmentId,
      hours_per_week:emp.hoursPerWeek,main_client_id:emp.mainClientId||null,
      sub_cat_ids:emp.subCatIds,sub_cat_skills:emp.subCatSkills,
      standard_off_days:emp.standardOffDays,vacation_dates:emp.vacationDates,
      default_shift_id:emp.defaultShiftId||null,hourly_wage:emp.hourlyWage||0,
      is_admin:emp.isAdmin||false,color:emp.color||COLORS[0],
      pause_config:emp.breaks||[],breaks:emp.breaks||[],
      updated_at:new Date().toISOString(),
    },{onConflict:"id"});
  }, []);
  const syncEmp = useDebounce(_sEmp, 700);

  const syncDept   = useDebounce(useCallback(async (d:Department) => { await sb.from("departments").upsert({id:d.id,name:d.name},{onConflict:"id"}); },[]),700);
  const syncSkill  = useDebounce(useCallback(async (s:Skill)      => { await sb.from("skills").upsert({id:s.id,name:s.name,criteria:s.criteria},{onConflict:"id"}); },[]),700);
  const syncClient = useDebounce(useCallback(async (c:Client)     => { await sb.from("clients").upsert({id:c.id,name:c.name,department_id:c.departmentId,fte_needed:c.fteNeeded,use_fte:c.useFTE},{onConflict:"id"}); },[]),700);
  const syncSubcat = useDebounce(useCallback(async (s:Subcategory)=> { await sb.from("subcategories").upsert({id:s.id,client_id:s.clientId,name:s.name,target_skills:s.targetSkills,require_break_cover:s.requireBreakCover},{onConflict:"id"}); },[]),700);
  const syncShift  = useDebounce(useCallback(async (s:ShiftDef)   => { await sb.from("shift_defs").upsert({id:s.id,label:s.label,hours:s.hours},{onConflict:"id"}); },[]),700);

  function updSchedule(slotId:string, entry:SlotEntry) {
    setSchedule(prev => ({...prev,[slotId]:entry}));
    syncCell(slotId, entry);
  }
  function updEmployee(emp:Employee) {
    setEmployees(prev => prev.map(e => e.id===emp.id ? emp : e));
    syncEmp(emp);
  }

  async function delDept(id:string)     { setDeptsRaw(p=>p.filter(d=>d.id!==id));  await sb.from("departments").delete().eq("id",id); }
  async function delSkill(id:string)    { setSkillsRaw(p=>p.filter(s=>s.id!==id)); await sb.from("skills").delete().eq("id",id); }
  async function delClient(id:string)   { setClientsRaw(p=>p.filter(c=>c.id!==id)); setSubcatsRaw(p=>p.filter(s=>s.clientId!==id)); await sb.from("clients").delete().eq("id",id); }
  async function delSubcat(id:string)   { setSubcatsRaw(p=>p.filter(s=>s.id!==id)); await sb.from("subcategories").delete().eq("id",id); }
  async function delShift(id:string)    { setShiftsRaw(p=>p.filter(s=>s.id!==id));  await sb.from("shift_defs").delete().eq("id",id); }
  async function delEmployee(id:string) { setEmployees(p=>p.filter(e=>e.id!==id));  await sb.from("employees").delete().eq("id",id); }

  // ─── Navigatie ──────────────────────────────────────────────────────────────
  const displayDates = useCallback(():Date[] => {
    if (viewType==="maand") return datesInMonth(viewMonth, viewYear);
    return Array.from({length:7},(_,i) => { const d=new Date(weekStart); d.setDate(weekStart.getDate()+i); return d; });
  }, [viewType,viewMonth,viewYear,weekStart]);

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
  function goToWeek(wn:number) {
    const jan4=new Date(viewYear,0,4);
    const dow=jan4.getDay()||7;
    const w1=new Date(jan4); w1.setDate(jan4.getDate()-dow+1);
    const t=new Date(w1); t.setDate(w1.getDate()+(wn-1)*7);
    setWeekStart(startOfWeek(t));
  }

  const deptClients   = clients.filter(c => c.departmentId===activeDeptId);
  const deptEmployees = employees.filter(e => e.departmentId===activeDeptId);
  const activeDept    = depts.find(d => d.id===activeDeptId);

  function isAvail(emp:Employee, date:Date): boolean {
    if (emp.standardOffDays.includes(dayLabel(date))) return false;
    if (emp.vacationDates.includes(fmtDate(date))) return false;
    return true;
  }
  function defaultHoursForEmp(emp:Employee): number[] {
    const wd = 7 - emp.standardOffDays.length;
    const h  = wd > 0 ? Math.round(emp.hoursPerWeek/wd) : 8;
    return Array.from({length:Math.min(h,9)}, (_,i) => 8+i);
  }
  function getShift(id:string) { return shiftDefs.find(s => s.id===id); }

  function calcScore(emp:Employee, sub:Subcategory): number {
    if (!sub.targetSkills.length) return 0;
    const mx   = emp.subCatSkills[sub.id] || {};
    const vals = sub.targetSkills.map(sid => { const v=mx[sid]; return typeof v==="number"&&!isNaN(v)?v:0; });
    return Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
  }

  function geplandUrenWeek(empId:string, refDate:Date): number {
    const sw = startOfWeek(refDate);
    let total = 0;
    const emp = employees.find(e => e.id===empId);
    for (let i=0; i<7; i++) {
      const d  = new Date(sw); d.setDate(sw.getDate()+i);
      const ds = fmtDate(d);
      Object.entries(schedule).filter(([sid]) => sid.startsWith(ds)).forEach(([,entry]) => {
        entry.rows?.forEach(r => {
          if (r.employeeId===empId)
            total += emp ? nettoUrenEmp(emp,r.selectedHours) : nettoUren(r.selectedHours);
        });
      });
    }
    return total;
  }

  function fteForClient(clientId:string): number {
    const dates = displayDates();
    const csubs = subcats.filter(s => s.clientId===clientId);
    let upd = 0;
    dates.forEach(date => {
      const ds=fmtDate(date); const seen=new Set<string>();
      if (!csubs.length) {
        schedule[`${ds}-client-${clientId}`]?.rows?.forEach(r => { if(r.employeeId) seen.add(r.employeeId); });
      } else {
        csubs.forEach(sub => { schedule[`${ds}-${sub.id}`]?.rows?.forEach(r => { if(r.employeeId) seen.add(r.employeeId); }); });
      }
      upd += seen.size;
    });
    return upd / (dates.filter(d=>!isWeekend(d)).length || 5);
  }

  function assignCoverForRow(slotId:string, rowIdx:number, emp:Employee, date:Date): string|undefined {
    if (!emp.breaks?.length) return undefined;
    const sub = subcats.find(s => slotId.includes(s.id));
    if (!sub?.requireBreakCover) return undefined;
    const existing = schedule[slotId]?.rows?.map(r=>r.employeeId).filter(Boolean) || [];
    const candidate = deptEmployees.find(e =>
      e.id !== emp.id &&
      !existing.includes(e.id) &&
      isAvail(e, date) &&
      (sub.targetSkills.length===0 || e.subCatIds.includes(sub.id))
    );
    return candidate?.id;
  }

  // ─── Auto planner ───────────────────────────────────────────────────────────
  function runAutoPlanner() {
    const dates = displayDates();
    const dC    = clients.filter(c => c.departmentId===activeDeptId);
    const dE    = employees.filter(e => e.departmentId===activeDeptId);
    const ns    = { ...schedule };
    const wht:  Record<string,Record<string,number>> = {};

    dates.forEach(date => {
      if (isWeekend(date)) return;
      const ds = fmtDate(date);
      const wk = getWeekKey(date);
      if (!wht[wk]) wht[wk] = {};
      const usedToday: string[] = [];

      dC.forEach(client => {
        const csubs = subcats.filter(s => s.clientId===client.id);
        const slots = csubs.length
          ? csubs.map(s => [`${ds}-${s.id}`, s] as [string,Subcategory])
          : [[`${ds}-client-${client.id}`, null] as [string,null]];

        slots.forEach(([slotId, sub]) => {
          const cands = dE.filter(e => {
            if (!isAvail(e,date)||usedToday.includes(e.id)) return false;
            if (sub && !e.subCatIds.includes(sub.id)) return false;
            const planned = (wht[wk][e.id]||0) + geplandUrenWeek(e.id,date);
            return planned < e.hoursPerWeek;
          }).sort((a,b) => {
            const as=sub?calcScore(a,sub):0, bs=sub?calcScore(b,sub):0;
            return (bs+(b.mainClientId===client.id?1000:0)) - (as+(a.mainClientId===client.id?1000:0));
          });

          if (cands[0]) {
            const emp = cands[0];
            usedToday.push(emp.id);
            const sh = (emp.defaultShiftId?getShift(emp.defaultShiftId):undefined) || shiftDefs[1] || shiftDefs[0];
            wht[wk][emp.id] = (wht[wk][emp.id]||0) + nettoUrenEmp(emp, sh?.hours||[]);
            const coverEmpId = assignCoverForRow(slotId, 0, emp, date);
            ns[slotId] = { rows:[{employeeId:emp.id,shiftId:sh?.id||"",selectedHours:sh?.hours||defaultHoursForEmp(emp),coverEmployeeId:coverEmpId}] };
          }
        });
      });
    });
    setSchedule(ns);
    Object.entries(ns).forEach(([sid,e]) => syncCell(sid,e));
  }

  // ─── Render add modals ───────────────────────────────────────────────────────
  function renderAddModal() {
    if (!addModal.type) return null;
    if (addModal.type === "dept")
      return <AddDeptModal activeDeptId={activeDeptId} setDeptsRaw={setDeptsRaw} setActiveDeptId={setActiveDeptId} onClose={()=>setAddModal({type:null})}/>;
    if (addModal.type === "skill")
      return <AddSkillModal setSkillsRaw={setSkillsRaw} syncSkill={syncSkill} onClose={()=>setAddModal({type:null})}/>;
    if (addModal.type === "editSkill")
      return <AddSkillModal editing={addModal.data} setSkillsRaw={setSkillsRaw} syncSkill={syncSkill} onClose={()=>setAddModal({type:null})}/>;
    if (addModal.type === "client")
      return <AddClientModal activeDeptId={activeDeptId} setClientsRaw={setClientsRaw} onClose={()=>setAddModal({type:null})}/>;
    if (addModal.type === "subcat")
      return <AddSubcatModal clientId={addModal.data?.clientId} skills={skills} clients={clients} setSubcatsRaw={setSubcatsRaw} syncSubcat={syncSubcat} onClose={()=>setAddModal({type:null})}/>;
    if (addModal.type === "editSubcat")
      return <AddSubcatModal clientId={addModal.data?.clientId} editing={addModal.data?.editing} skills={skills} clients={clients} setSubcatsRaw={setSubcatsRaw} syncSubcat={syncSubcat} onClose={()=>setAddModal({type:null})}/>;
    if (addModal.type === "shift")
      return <AddShiftModal setShiftsRaw={setShiftsRaw} onClose={()=>setAddModal({type:null})}/>;
    if (addModal.type === "employee")
      return <AddEmployeeModal depts={depts} shiftDefs={shiftDefs} employees={employees} activeDeptId={activeDeptId} setEmployees={setEmployees} onClose={()=>setAddModal({type:null})}/>;
    if (addModal.type === "changePassword")
      return <ChangePasswordModal userId={addModal.data?.userId} userName={addModal.data?.userName} currentUserId={currentUserId} onClose={()=>setAddModal({type:null})}/>;
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TAB: PLANNING
  // ══════════════════════════════════════════════════════════════════════════
  function TabPlanning() {
    const dates    = displayDates();
    const workDays = dates.filter(d => !isWeekend(d));

    // Rij per medewerker — ook buiten EmpWeekRow houden we dit als inner function
    // want het heeft directe closure-toegang nodig tot schedule/employees/etc.
    function EmpWeekRow({ emp }: { emp:Employee }) {
      const gepland = geplandUrenWeek(emp.id, weekStart);
      const pct     = Math.min(100, Math.round(gepland/emp.hoursPerWeek*100));
      const over    = gepland > emp.hoursPerWeek;

      return (
        <tr style={{borderBottom:"1px solid #0a0f1a"}}>
          <td style={{padding:"8px 10px",verticalAlign:"middle",minWidth:160,
            position:"sticky",left:0,background:"#020617",zIndex:2,
            borderRight:"2px solid #1e293b"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:10,height:10,borderRadius:"50%",background:emp.color,flexShrink:0}}/>
              <div>
                <div style={{fontWeight:700,fontSize:13,color:"white",whiteSpace:"nowrap"}}>{emp.name}</div>
                <div style={{fontSize:10,color:"#475569"}}>
                  <span style={{color:over?"#EF4444":"#64748B"}}>{gepland.toFixed(1)}u</span>
                  <span style={{color:"#334155"}}> / {emp.hoursPerWeek}u</span>
                </div>
                <div style={{width:60,height:2,background:"#1e293b",borderRadius:1,marginTop:2}}>
                  <div style={{width:`${pct}%`,height:"100%",background:over?"#EF4444":emp.color,borderRadius:1,transition:"width .3s"}}/>
                </div>
              </div>
            </div>
          </td>
          {workDays.map(date => {
            const ds       = fmtDate(date);
            const empSlots: {slotId:string;sub:Subcategory|null;client:Client|null;row:SlotRow}[] = [];
            deptClients.forEach(client => {
              const csubs = subcats.filter(s => s.clientId===client.id);
              (csubs.length?csubs:[null]).forEach(sub => {
                const slotId = sub ? `${ds}-${sub.id}` : `${ds}-client-${client.id}`;
                const entry  = schedule[slotId];
                entry?.rows?.forEach(row => {
                  if (row.employeeId===emp.id) empSlots.push({slotId,sub,client,row});
                });
              });
            });
            const isOff = !isAvail(emp, date);
            return (
              <td key={ds} style={{padding:4,verticalAlign:"top",minWidth:160,
                borderRight:"1px solid #0a0f1a",
                background:isOff?"rgba(100,116,139,0.04)":"transparent"}}>
                {isOff && (
                  <div style={{textAlign:"center",color:"#334155",fontSize:10,padding:"8px 0"}}>
                    {emp.vacationDates.includes(ds)?"🌴 Vakantie":"🔴 Vrij"}
                  </div>
                )}
                {!isOff && empSlots.length===0 && (
                  <div style={{textAlign:"center",color:"#1e293b",fontSize:10,padding:"8px 0"}}>—</div>
                )}
                {!isOff && empSlots.map(({sub,client,row},i) => {
                  const netto     = nettoUrenEmp(emp, row.selectedHours);
                  const breakMins = calcBreakMins(emp.breaks, row.selectedHours);
                  const coverEmp  = row.coverEmployeeId ? employees.find(e=>e.id===row.coverEmployeeId) : null;
                  const sh        = shiftDefs.find(s=>s.id===row.shiftId);
                  const r = parseInt(emp.color.slice(1,3),16);
                  const g = parseInt(emp.color.slice(3,5),16);
                  const b = parseInt(emp.color.slice(5,7),16);
                  return (
                    <div key={i} style={{background:`rgba(${r},${g},${b},0.1)`,
                      border:`1px solid ${emp.color}44`,borderLeft:`3px solid ${emp.color}`,
                      borderRadius:6,padding:"5px 7px",marginBottom:i<empSlots.length-1?4:0}}>
                      <div style={{fontWeight:800,fontSize:13,color:"white",letterSpacing:"-0.3px"}}>
                        {shiftTimeStr(row.selectedHours)||"—"}
                      </div>
                      {sh && <div style={{fontSize:10,color:emp.color,fontWeight:700,marginTop:1}}>{sh.label}</div>}
                      <div style={{fontSize:10,color:"#64748B",marginTop:1}}>
                        {client?.name}{sub?" · "+sub.name:""}
                      </div>
                      <div style={{fontSize:10,color:"#94A3B8",marginTop:1}}>{netto.toFixed(1)}u netto</div>
                      {breakMins > 0 && (
                        <div style={{marginTop:3,background:"rgba(245,158,11,0.12)",
                          borderRadius:3,padding:"2px 5px",fontSize:9,color:"#F59E0B",
                          display:"flex",alignItems:"center",gap:3}}>
                          <Coffee size={8}/>
                          <span>{breakMins} min pauze</span>
                          {coverEmp && (
                            <span style={{color:"#10B981",marginLeft:2}}>
                              → <strong>{coverEmp.name.split(" ")[0]}</strong>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </td>
            );
          })}
        </tr>
      );
    }

    return (
      <div style={{borderRadius:12,overflowX:"auto",padding:16}}>
        {/* Navigatie */}
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:14}}>
          <button onClick={prevPeriod} style={{background:"#1e293b",border:"none",color:"white",borderRadius:8,padding:"7px 12px",cursor:"pointer",display:"flex",alignItems:"center"}}><ChevronLeft size={16}/></button>
          <div style={{fontWeight:700,color:"white",minWidth:200,textAlign:"center",fontSize:14}}>
            {viewType==="week"
              ? `Week ${weekNum(weekStart)} · ${weekStart.toLocaleDateString("nl-NL",{day:"numeric",month:"short"})} – ${new Date(weekStart.getTime()+6*86400000).toLocaleDateString("nl-NL",{day:"numeric",month:"short",year:"numeric"})}`
              : `${MONTH_LABELS[viewMonth]} ${viewYear}`}
          </div>
          <button onClick={nextPeriod} style={{background:"#1e293b",border:"none",color:"white",borderRadius:8,padding:"7px 12px",cursor:"pointer",display:"flex",alignItems:"center"}}><ChevronRight size={16}/></button>

          {viewType==="week" && (
            <select value={weekNum(weekStart)} onChange={e=>goToWeek(+e.target.value)}
              style={{background:"#1e293b",color:"white",padding:"7px 10px",borderRadius:8,border:"none",fontSize:12}}>
              {Array.from({length:53},(_,i)=>i+1).map(wn=><option key={wn} value={wn}>Week {wn}</option>)}
            </select>
          )}
          {viewType==="maand" && (
            <>
              <select value={viewYear} onChange={e=>setViewYear(+e.target.value)} style={{background:"#1e293b",color:"white",padding:"7px 10px",borderRadius:8,border:"none"}}>
                {[2024,2025,2026,2027,2028,2029].map(y=><option key={y} value={y}>{y}</option>)}
              </select>
              <select value={viewMonth} onChange={e=>setViewMonth(+e.target.value)} style={{background:"#1e293b",color:"white",padding:"7px 10px",borderRadius:8,border:"none"}}>
                {MONTH_LABELS.map((m,i)=><option key={m} value={i}>{m}</option>)}
              </select>
            </>
          )}
          <div style={{background:"#1e293b",padding:3,borderRadius:8,display:"flex"}}>
            <button onClick={()=>{setViewType("week");setWeekStart(startOfWeek(today));}}
              style={{background:viewType==="week"?"#3B82F6":"transparent",border:"none",color:"white",padding:"5px 14px",borderRadius:6,cursor:"pointer",fontWeight:viewType==="week"?700:400}}>Week</button>
            <button onClick={()=>setViewType("maand")}
              style={{background:viewType==="maand"?"#3B82F6":"transparent",border:"none",color:"white",padding:"5px 14px",borderRadius:6,cursor:"pointer",fontWeight:viewType==="maand"?700:400}}>Maand</button>
          </div>
        </div>

        {/* FTE waarschuwing */}
        {useFTE && deptClients.some(c=>c.useFTE&&fteForClient(c.id)<c.fteNeeded) && (
          <div style={{background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.25)",
            borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:"#FCA5A5",
            display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <AlertTriangle size={13} color="#EF4444"/>
            <strong>Onderbezetting:</strong>
            {deptClients.filter(c=>c.useFTE&&fteForClient(c.id)<c.fteNeeded).map(c=>(
              <span key={c.id} style={{background:"rgba(239,68,68,.15)",padding:"2px 8px",borderRadius:10}}>
                {c.name}: {fteForClient(c.id).toFixed(2)} / {c.fteNeeded} FTE
              </span>
            ))}
          </div>
        )}

        {/* Overzicht-tabel: medewerkers als rijen */}
        <div style={{overflowX:"auto",borderRadius:10,border:"1px solid #1e293b"}}>
          <table style={{width:"100%",borderCollapse:"collapse",tableLayout:"fixed"}}>
            <thead>
              <tr style={{background:"#0f172a"}}>
                <th style={{textAlign:"left",padding:"10px 12px",color:"#64748B",width:160,
                  position:"sticky",left:0,background:"#0f172a",zIndex:3,
                  fontSize:10,fontWeight:700,letterSpacing:"0.08em",
                  borderRight:"2px solid #1e293b",borderBottom:"2px solid #1e293b"}}>MEDEWERKER</th>
                {workDays.map(date => {
                  const isToday = fmtDate(date)===fmtDate(today);
                  return (
                    <th key={fmtDate(date)} style={{padding:"8px 6px",minWidth:160,
                      color:isToday?"#38BDF8":"#94A3B8",borderBottom:"2px solid #1e293b",
                      borderRight:"1px solid #1e293b",
                      background:isToday?"rgba(56,189,248,0.05)":"#0f172a"}}>
                      <div style={{fontWeight:800,fontSize:14}}>{dayLabel(date).slice(0,2)} {date.getDate()}</div>
                      <div style={{fontSize:10,color:"#475569",fontWeight:400}}>
                        {MONTH_LABELS[date.getMonth()].slice(0,3)} · Wk {weekNum(date)}
                      </div>
                      {isToday && <div style={{width:6,height:6,borderRadius:"50%",background:"#38BDF8",margin:"3px auto 0"}}/>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {deptEmployees.length===0 && (
                <tr><td colSpan={workDays.length+1} style={{padding:40,textAlign:"center",color:"#334155",fontStyle:"italic"}}>
                  Geen medewerkers in deze afdeling.
                </td></tr>
              )}
              {deptEmployees.map(emp => <EmpWeekRow key={emp.id} emp={emp}/>)}
            </tbody>
          </table>
        </div>

        {/* Invoer-tabel: klant/taak als rijen */}
        {viewType==="week" && deptClients.length>0 && (
          <div style={{marginTop:20}}>
            <div style={{fontSize:12,color:"#475569",fontWeight:700,letterSpacing:"0.06em",
              marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
              <Settings size={12} color="#475569"/>
              PLANNING INVOER — PER KLANT/TAAK
            </div>
            <div style={{overflowX:"auto",borderRadius:10,border:"1px solid #1e293b"}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead>
                  <tr style={{background:"#080e1a"}}>
                    <th style={{textAlign:"left",padding:"8px 10px",color:"#475569",minWidth:180,
                      position:"sticky",left:0,background:"#080e1a",zIndex:2,
                      fontSize:10,fontWeight:700,letterSpacing:"0.06em",
                      borderBottom:"1px solid #1e293b"}}>KLANT / TAAK</th>
                    {workDays.map(date=>(
                      <th key={fmtDate(date)} style={{padding:"6px 3px",fontSize:10,minWidth:190,
                        color:"#64748B",borderBottom:"1px solid #1e293b",textAlign:"center"}}>
                        {dayLabel(date).slice(0,2)} {date.getDate()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deptClients.map(client => {
                    const csubs   = subcats.filter(s => s.clientId===client.id);
                    const fte     = fteForClient(client.id);
                    const fteDiff = fte - client.fteNeeded;
                    return (
                      <React.Fragment key={client.id}>
                        <tr style={{background:"#0a1020"}}>
                          <td colSpan={workDays.length+1} style={{padding:"6px 12px",
                            color:"#38BDF8",fontWeight:700,borderTop:"1px solid #1e293b"}}>
                            <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                              <span>{client.name}</span>
                              {client.useFTE && (
                                <span style={{padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:700,
                                  background:fteDiff>=0?"rgba(16,185,129,.15)":"rgba(239,68,68,.15)",
                                  color:fteDiff>=0?"#10B981":"#EF4444"}}>
                                  {fte.toFixed(2)} / {client.fteNeeded} FTE {fteDiff>=0?"✓":"⚠"}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                        {(csubs.length
                          ? csubs
                          : [{id:`client-${client.id}`,clientId:client.id,name:"Algemeen",targetSkills:[],requireBreakCover:false}]
                        ).map(sub => (
                          <tr key={sub.id}>
                            <td style={{padding:"6px 10px 6px 22px",fontSize:11,color:"#64748B",
                              position:"sticky",left:0,background:"#080e1a",
                              verticalAlign:"top",borderBottom:"1px solid #0a0f1a"}}>
                              <div style={{display:"flex",alignItems:"center",gap:5}}>
                                <span style={{color:"#334155"}}>↳</span>
                                <span>{sub.name}</span>
                                {(sub as Subcategory).requireBreakCover && (
                                  <span style={{fontSize:9,background:"rgba(245,158,11,.12)",
                                    color:"#F59E0B",padding:"1px 5px",borderRadius:6,
                                    border:"1px solid rgba(245,158,11,.2)"}}>☕</span>
                                )}
                              </div>
                            </td>
                            {workDays.map(date => {
                              const slotId = `${fmtDate(date)}-${sub.id}`;
                              const avail  = deptEmployees.filter(e =>
                                isAvail(e,date) && ((sub as any).targetSkills?.length===0 || e.subCatIds.includes(sub.id))
                              );
                              return (
                                <PlanningCell
                                  key={fmtDate(date)}
                                  slotId={slotId}
                                  date={date}
                                  avail={avail}
                                  schedule={schedule}
                                  employees={employees}
                                  shiftDefs={shiftDefs}
                                  subcats={subcats}
                                  updSchedule={updSchedule}
                                  updEmployee={updEmployee}
                                  geplandUrenWeek={geplandUrenWeek}
                                  assignCoverForRow={assignCoverForRow}
                                  defaultHours={defaultHoursForEmp}
                                />
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
          </div>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TAB: MEDEWERKERS
  // ══════════════════════════════════════════════════════════════════════════
  function TabMedewerkers() {
    return (
      <div style={{background:"#0f172a",borderRadius:12,padding:20,border:"1px solid #1e293b"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <h3 style={{margin:0,color:"white",fontWeight:700}}>Medewerkers — {activeDept?.name}</h3>
          <button onClick={()=>setAddModal({type:"employee"})}
            style={{background:"#3B82F6",border:"none",color:"white",padding:"8px 16px",borderRadius:8,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",gap:6}}>
            <Plus size={14}/> Toevoegen
          </button>
        </div>
        {deptEmployees.length===0 && <div style={{color:"#334155",textAlign:"center",padding:40}}>Geen medewerkers. Klik op + Toevoegen.</div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(380px,1fr))",gap:20}}>
          {deptEmployees.map(emp => {
            const gepland       = geplandUrenWeek(emp.id, weekStart);
            const pct           = Math.min(100,Math.round(gepland/emp.hoursPerWeek*100));
            const over          = gepland > emp.hoursPerWeek;
            const totalBreakMins= emp.breaks.reduce((s,b)=>s+((b.endHour*60+b.endMin)-(b.startHour*60+b.startMin)),0);
            const bpi           = BREAK_PRESETS.findIndex(p =>
              p.breaks.length===emp.breaks.length &&
              p.breaks.every((b,bi) => emp.breaks[bi] && b.startHour===emp.breaks[bi].startHour && b.startMin===emp.breaks[bi].startMin)
            );
            return (
              <div key={emp.id} style={{background:"#1e293b",borderRadius:12,padding:18,border:"1px solid #334155",borderTop:`3px solid ${emp.color}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,flex:1}}>
                    <ColorPicker value={emp.color} onChange={c=>updEmployee({...emp,color:c})}/>
                    <input value={emp.name} onChange={e=>updEmployee({...emp,name:e.target.value})}
                      style={{background:"none",border:"none",color:"white",fontSize:16,fontWeight:700,flex:1,outline:"none"}}/>
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <button onClick={()=>setVacModalEmpId(emp.id)}
                      style={{background:"#F59E0B",color:"white",border:"none",padding:"5px 10px",borderRadius:6,fontSize:11,cursor:"pointer"}}>🌴</button>
                    <button onClick={()=>setAddModal({type:"changePassword",data:{userId:emp.id,userName:emp.name}})}
                      style={{background:"#334155",color:"#94A3B8",border:"none",padding:"5px 10px",borderRadius:6,fontSize:11,cursor:"pointer"}}><Key size={12}/></button>
                    <button onClick={async()=>{if(window.confirm("Medewerker verwijderen?"))await delEmployee(emp.id);}}
                      style={{background:"none",border:"none",color:"#EF4444",cursor:"pointer"}}><Trash2 size={16}/></button>
                  </div>
                </div>

                <div style={{background:"#0f172a",borderRadius:6,padding:8,marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:4}}>
                    <span style={{color:"#64748B"}}>Ingepland deze week</span>
                    <span style={{color:over?"#EF4444":"#10B981",fontWeight:700}}>{gepland.toFixed(1)}u / {emp.hoursPerWeek}u</span>
                  </div>
                  <div style={{height:4,background:"#334155",borderRadius:2,overflow:"hidden"}}>
                    <div style={{width:`${pct}%`,height:"100%",background:over?"#EF4444":emp.color,transition:"width .3s"}}/>
                  </div>
                </div>

                <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:12}}>
                  {([
                    {label:"UREN/WEEK",content:<input type="number" min={1} max={80} value={emp.hoursPerWeek} onChange={e=>updEmployee({...emp,hoursPerWeek:+e.target.value})} style={{width:60,background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:4,padding:"4px 5px"}}/>},
                    {label:"UURLOON (€)",content:<input type="number" step="0.01" min={0} value={emp.hourlyWage||0} onChange={e=>updEmployee({...emp,hourlyWage:parseFloat(e.target.value)||0})} style={{width:70,background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:4,padding:"4px 5px"}}/>},
                    {label:"HOOFD KLANT",content:<select value={emp.mainClientId} onChange={e=>updEmployee({...emp,mainClientId:e.target.value})} style={{background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:4,padding:"4px 6px"}}><option value="">Geen</option>{deptClients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>},
                    {label:"STD SHIFT",content:<select value={emp.defaultShiftId||""} onChange={e=>updEmployee({...emp,defaultShiftId:e.target.value})} style={{background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:4,padding:"4px 6px"}}><option value="">Geen</option>{shiftDefs.map(sh=><option key={sh.id} value={sh.id}>{sh.label}</option>)}</select>},
                    {label:"AFDELING",content:<select value={emp.departmentId} onChange={e=>updEmployee({...emp,departmentId:e.target.value})} style={{background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:4,padding:"4px 6px"}}>{depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>},
                    {label:"BEHEERDER",content:<button onClick={()=>updEmployee({...emp,isAdmin:!emp.isAdmin})} style={{background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center"}}>{emp.isAdmin?<ToggleRight size={24} color="#8B5CF6"/>:<ToggleLeft size={24} color="#475569"/>}</button>},
                  ] as {label:string;content:React.ReactNode}[]).map(({label,content})=>(
                    <div key={label}>
                      <label style={{fontSize:9,color:"#64748B",display:"block",marginBottom:3,fontWeight:700,letterSpacing:"0.06em"}}>{label}</label>
                      {content}
                    </div>
                  ))}
                </div>

                {/* Pauze schema */}
                <div style={{background:"#0f172a",borderRadius:8,padding:10,marginBottom:12}}>
                  <label style={{fontSize:9,color:"#F59E0B",fontWeight:700,display:"block",marginBottom:6,letterSpacing:"0.06em"}}>☕ PAUZE SCHEMA</label>
                  <select value={bpi >= 0 ? bpi : ""}
                    onChange={e=>{
                      const idx = +e.target.value;
                      const newBreaks = BREAK_PRESETS[idx].breaks.map(b=>({...b,id:genId("br")}));
                      updEmployee({...emp,breaks:newBreaks});
                    }}
                    style={{...selectSt,color:"#F59E0B"}}>
                    {BREAK_PRESETS.map((p,i)=><option key={i} value={i}>☕ {p.label}</option>)}
                  </select>
                  {emp.breaks.length>0&&(
                    <div style={{marginTop:6,display:"flex",flexWrap:"wrap",gap:4}}>
                      {emp.breaks.map(b=>(
                        <span key={b.id} style={{background:"rgba(245,158,11,.12)",color:"#F59E0B",
                          border:"1px solid rgba(245,158,11,.2)",borderRadius:8,padding:"2px 8px",fontSize:10}}>
                          {b.label}: {fmtTime(b.startHour,b.startMin)}–{fmtTime(b.endHour,b.endMin)}
                        </span>
                      ))}
                      <span style={{fontSize:10,color:"#64748B"}}>= {totalBreakMins}min</span>
                    </div>
                  )}
                </div>

                {/* Vrije dagen */}
                <div style={{background:"#0f172a",borderRadius:6,padding:8,marginBottom:12}}>
                  <div style={{fontSize:9,color:"#F59E0B",fontWeight:700,marginBottom:6,letterSpacing:"0.06em"}}>VASTE VRIJE DAGEN</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    {DAY_LABELS.map(day=>{
                      const isOff=emp.standardOffDays.includes(day);
                      return <button key={day} onClick={()=>updEmployee({...emp,standardOffDays:isOff?emp.standardOffDays.filter(d=>d!==day):[...emp.standardOffDays,day]})}
                        style={{padding:"3px 8px",borderRadius:12,border:"none",fontSize:10,cursor:"pointer",background:isOff?"#EF4444":"#334155",color:isOff?"white":"#64748B"}}>
                        {day.slice(0,2)}</button>;
                    })}
                  </div>
                </div>

                {/* Subcategorieën */}
                <div style={{borderTop:"1px solid #334155",paddingTop:10,marginBottom:10}}>
                  <div style={{fontSize:9,color:"#64748B",marginBottom:6,fontWeight:700,letterSpacing:"0.06em"}}>TAKEN / SUBCATEGORIEËN</div>
                  {deptClients.map(client=>{
                    const csubs=subcats.filter(s=>s.clientId===client.id);
                    if (!csubs.length) return null;
                    return (
                      <div key={client.id} style={{background:"#0f172a",borderRadius:4,padding:6,marginBottom:4}}>
                        <div style={{fontSize:10,fontWeight:700,color:"#38BDF8",marginBottom:4}}>{client.name}</div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                          {csubs.map(sub=>{
                            const has=emp.subCatIds.includes(sub.id);
                            return <button key={sub.id} onClick={()=>{
                              const newIds=has?emp.subCatIds.filter(id=>id!==sub.id):[...emp.subCatIds,sub.id];
                              const newMx={...emp.subCatSkills};
                              if (!has){const ex=newMx[sub.id]||{};const init:Record<string,number>={};skills.forEach(s=>{init[s.id]=ex[s.id]??0;});newMx[sub.id]=init;}
                              updEmployee({...emp,subCatIds:newIds,subCatSkills:newMx});
                            }} style={{fontSize:9,padding:"3px 7px",borderRadius:10,border:"none",background:has?"#10B981":"#334155",color:"white",cursor:"pointer"}}>
                              {sub.name}</button>;
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Skill matrix */}
                {emp.subCatIds.length>0&&(
                  <div style={{borderTop:"1px solid #334155",paddingTop:10}}>
                    <div style={{fontSize:9,color:"#F59E0B",fontWeight:700,marginBottom:8,letterSpacing:"0.06em"}}>SKILL MATRIX</div>
                    {emp.subCatIds.map(subId=>{
                      const sub=subcats.find(s=>s.id===subId);
                      const client=sub?clients.find(c=>c.id===sub.clientId):null;
                      if (!sub||!sub.targetSkills.length) return null;
                      return (
                        <div key={subId} style={{background:"#0f172a",borderRadius:6,padding:8,marginBottom:6}}>
                          <div style={{fontSize:11,fontWeight:700,color:"#38BDF8",marginBottom:6}}>{client?.name} – {sub.name}</div>
                          {sub.targetSkills.map(skillId=>{
                            const sk=skills.find(s=>s.id===skillId); if (!sk) return null;
                            const raw=emp.subCatSkills[subId]?.[skillId];
                            const val=typeof raw==="number"&&!isNaN(raw)?raw:0;
                            return (
                              <div key={skillId} style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:11,marginBottom:4,background:"#1e293b",padding:"4px 7px",borderRadius:4}}>
                                <span title={sk.criteria} style={{cursor:"help",borderBottom:"1px dotted #475569"}}>{sk.name}</span>
                                <div style={{display:"flex",alignItems:"center",gap:6}}>
                                  <div style={{width:55,height:4,background:"#334155",borderRadius:2,overflow:"hidden"}}>
                                    <div style={{width:`${val}%`,height:"100%",background:val>=80?"#10B981":val>=50?"#F59E0B":"#EF4444",transition:"width .3s"}}/>
                                  </div>
                                  <input type="number" value={val} min={0} max={100}
                                    onChange={e=>{
                                      const v=Math.min(100,Math.max(0,+e.target.value));
                                      const nm={...(emp.subCatSkills[subId]||{}),[skillId]:v};
                                      updEmployee({...emp,subCatSkills:{...emp.subCatSkills,[subId]:nm}});
                                    }}
                                    style={{width:40,background:"transparent",color:"white",border:"1px solid #334155",borderRadius:3,padding:2,textAlign:"center",fontSize:10}}/>
                                  <span style={{color:"#64748B",fontSize:10}}>%</span>
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

  // ══════════════════════════════════════════════════════════════════════════
  // TAB: BEHEER
  // ══════════════════════════════════════════════════════════════════════════
  function TabBeheer() {
    return (
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))",gap:20}}>
        {/* Afdelingen */}
        <section style={{background:"#0f172a",borderRadius:12,padding:20,border:"1px solid #1e293b"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><Building2 size={15} color="#3B82F6"/><h3 style={{margin:0,color:"white",fontSize:14,fontWeight:700}}>Afdelingen</h3></div>
            <button onClick={()=>setAddModal({type:"dept"})} style={{background:"#3B82F6",border:"none",color:"white",padding:"5px 10px",borderRadius:6,cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",gap:4}}><Plus size={11}/>Nieuw</button>
          </div>
          {depts.map(d=>(
            <div key={d.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#1e293b",borderRadius:6,padding:"8px 12px",marginBottom:5}}>
              <input value={d.name} onChange={e=>{const upd={...d,name:e.target.value};setDeptsRaw(p=>p.map(x=>x.id===d.id?upd:x));syncDept(upd);}}
                style={{background:"none",border:"none",color:"white",flex:1,outline:"none"}}/>
              {depts.length>1&&<button onClick={async()=>{if(window.confirm("Verwijderen?"))await delDept(d.id);}} style={{background:"none",border:"none",color:"#EF4444",cursor:"pointer"}}><Trash2 size={14}/></button>}
            </div>
          ))}
        </section>

        {/* Skills */}
        <section style={{background:"#0f172a",borderRadius:12,padding:20,border:"1px solid #1e293b"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><Zap size={15} color="#8B5CF6"/><h3 style={{margin:0,color:"white",fontSize:14,fontWeight:700}}>Skills & Criteria</h3></div>
            <button onClick={()=>setAddModal({type:"skill"})} style={{background:"#8B5CF6",border:"none",color:"white",padding:"5px 10px",borderRadius:6,cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",gap:4}}><Plus size={11}/>Skill</button>
          </div>
          {skills.map(s=>(
            <div key={s.id} style={{background:"#1e293b",borderRadius:8,padding:10,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{color:"white",fontWeight:700,fontSize:13}}>{s.name}</div>
                {s.criteria&&<div style={{color:"#64748B",fontSize:10,marginTop:2}}>{s.criteria.slice(0,50)}{s.criteria.length>50?"...":""}</div>}
              </div>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>setAddModal({type:"editSkill",data:s})} style={{background:"#1e293b",border:"1px solid #334155",color:"#64748B",borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:11}}><Edit2 size={11}/></button>
                <button onClick={async()=>{if(window.confirm("Verwijderen?"))await delSkill(s.id);}} style={{background:"none",border:"none",color:"#EF4444",cursor:"pointer"}}><Trash2 size={14}/></button>
              </div>
            </div>
          ))}
        </section>

        {/* Klanten */}
        <section style={{background:"#0f172a",borderRadius:12,padding:20,border:"1px solid #1e293b",gridColumn:"1/-1"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><Users size={15} color="#10B981"/><h3 style={{margin:0,color:"white",fontSize:14,fontWeight:700}}>Klanten ({activeDept?.name})</h3></div>
            <button onClick={()=>setAddModal({type:"client"})} style={{background:"#10B981",border:"none",color:"white",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",gap:6}}><Plus size={14}/>Klant</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:14}}>
            {deptClients.map(client=>{
              const csubs=subcats.filter(s=>s.clientId===client.id);
              return (
                <div key={client.id} style={{background:"#1e293b",borderRadius:10,padding:14,borderLeft:"3px solid #38BDF8"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <input value={client.name} onChange={e=>{const upd={...client,name:e.target.value};setClientsRaw(p=>p.map(c=>c.id===client.id?upd:c));syncClient(upd);}}
                      style={{background:"none",border:"none",color:"white",fontWeight:700,fontSize:14,flex:1,outline:"none"}}/>
                    <button onClick={async()=>{if(window.confirm("Klant + subcategorieën verwijderen?"))await delClient(client.id);}} style={{background:"none",border:"none",color:"#EF4444",cursor:"pointer"}}><Trash2 size={14}/></button>
                  </div>
                  <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:10}}>
                    <div>
                      <label style={{fontSize:9,color:"#64748B",display:"block",marginBottom:3,fontWeight:700}}>FTE DOEL</label>
                      <input type="number" step="0.5" min="0.5" value={client.fteNeeded}
                        onChange={e=>{const upd={...client,fteNeeded:parseFloat(e.target.value)||0};setClientsRaw(p=>p.map(c=>c.id===client.id?upd:c));syncClient(upd);}}
                        style={{width:70,background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:4,padding:"4px 6px"}}/>
                    </div>
                    <div>
                      <label style={{fontSize:9,color:"#64748B",display:"block",marginBottom:3,fontWeight:700}}>FTE AAN</label>
                      <button onClick={()=>{const upd={...client,useFTE:!client.useFTE};setClientsRaw(p=>p.map(c=>c.id===client.id?upd:c));syncClient(upd);}} style={{background:"none",border:"none",cursor:"pointer",padding:0}}>
                        {client.useFTE?<ToggleRight size={22} color="#10B981"/>:<ToggleLeft size={22} color="#475569"/>}
                      </button>
                    </div>
                  </div>
                  {csubs.map(sub=>(
                    <div key={sub.id} style={{background:"#0f172a",borderRadius:6,padding:8,marginBottom:6}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{color:"#94A3B8",fontSize:12,fontWeight:700}}>↳ {sub.name}</span>
                          {sub.requireBreakCover&&<span style={{fontSize:9,color:"#F59E0B",border:"1px solid rgba(245,158,11,.3)",borderRadius:8,padding:"1px 5px"}}>☕</span>}
                        </div>
                        <div style={{display:"flex",gap:4}}>
                          <button onClick={()=>setAddModal({type:"editSubcat",data:{clientId:client.id,editing:sub}})}
                            style={{background:"#1e293b",border:"1px solid #334155",color:"#64748B",borderRadius:4,padding:"2px 6px",cursor:"pointer",fontSize:9}}><Edit2 size={9}/></button>
                          <button onClick={async()=>await delSubcat(sub.id)} style={{background:"none",border:"none",color:"#EF4444",cursor:"pointer",fontSize:11}}>✕</button>
                        </div>
                      </div>
                    </div>
                  ))}
                  <button onClick={()=>setAddModal({type:"subcat",data:{clientId:client.id}})}
                    style={{width:"100%",padding:5,background:"none",border:"1px dashed #334155",color:"#64748B",borderRadius:4,fontSize:11,cursor:"pointer",marginTop:4}}>
                    + Subcategorie
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Shifts */}
        <section style={{background:"#0f172a",borderRadius:12,padding:20,border:"1px solid #1e293b"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><Clock size={15} color="#F59E0B"/><h3 style={{margin:0,color:"white",fontSize:14,fontWeight:700}}>Shift Definities</h3></div>
            <button onClick={()=>setAddModal({type:"shift"})} style={{background:"#F59E0B",border:"none",color:"black",padding:"5px 10px",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:700,display:"flex",alignItems:"center",gap:4}}><Plus size={11}/>Shift</button>
          </div>
          {shiftDefs.map(sh=>(
            <div key={sh.id} style={{background:"#1e293b",borderRadius:8,padding:12,marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <input value={sh.label} onChange={e=>{const upd={...sh,label:e.target.value};setShiftsRaw(p=>p.map(x=>x.id===sh.id?upd:x));syncShift(upd);}}
                  style={{background:"none",border:"none",color:"#F59E0B",fontWeight:700,fontSize:13,flex:1,outline:"none"}}/>
                <button onClick={async()=>{if(window.confirm("Verwijderen?"))await delShift(sh.id);}} style={{background:"none",border:"none",color:"#EF4444",cursor:"pointer"}}><Trash2 size={14}/></button>
              </div>
              <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                {WORK_HOURS.map(h=>{
                  const on=sh.hours.includes(h);
                  return <button key={h} onClick={()=>{const upd={...sh,hours:on?sh.hours.filter(hr=>hr!==h):[...sh.hours,h].sort((a,b)=>a-b)};setShiftsRaw(p=>p.map(x=>x.id===sh.id?upd:x));syncShift(upd);}}
                    style={{padding:"3px 6px",borderRadius:4,border:"none",fontSize:10,cursor:"pointer",background:on?"#F59E0B":"#334155",color:on?"black":"#475569",fontWeight:on?700:400}}>{h}</button>;
                })}
              </div>
              {sh.hours.length>0&&<div style={{fontSize:10,color:"#64748B",marginTop:6,fontFamily:"monospace"}}>
                {String(Math.min(...sh.hours)).padStart(2,"0")}:00 – {String(Math.max(...sh.hours)+1).padStart(2,"0")}:00 · {nettoUren(sh.hours)}u netto
              </div>}
            </div>
          ))}
        </section>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TAB: FINANCIEEL
  // ══════════════════════════════════════════════════════════════════════════
  function TabFinancieel() {
    const [filterDeptId,   setFilterDeptId]   = useState("all");
    const [filterClientId, setFilterClientId] = useState("all");
    const allDates = displayDates();

    const kostenData = useMemo(() => {
      const perKlant: Record<string,{naam:string;kosten:number;uren:number;deptId:string;subcats:Record<string,{naam:string;kosten:number;uren:number;details:any[]}>}> = {};
      const perDept:  Record<string,{naam:string;kosten:number;uren:number}> = {};

      depts.forEach(d => { perDept[d.id] = {naam:d.name,kosten:0,uren:0}; });

      clients.forEach(client => {
        const csubs = subcats.filter(s => s.clientId===client.id);
        perKlant[client.id] = {naam:client.name,kosten:0,uren:0,deptId:client.departmentId,subcats:{}};

        const slots = csubs.length
          ? csubs.map(s => ({slotPrefix:`-${s.id}`,    subName:s.name,                  subId:s.id}))
          : [            {slotPrefix:`-client-${client.id}`, subName:"Algemeen", subId:`client-${client.id}`}];

        slots.forEach(({slotPrefix,subName,subId}) => {
          perKlant[client.id].subcats[subId] = {naam:subName,kosten:0,uren:0,details:[]};

          allDates.forEach(date => {
            const ds     = fmtDate(date);
            const slotId = `${ds}${slotPrefix}`;
            const entry  = schedule[slotId];
            if (!entry?.rows) return;

            entry.rows.forEach(row => {
              if (!row.employeeId) return;
              const emp  = employees.find(e => e.id===row.employeeId);
              if (!emp)  return;
              const loon = Number(emp.hourlyWage) || 0;
              if (!loon) return;

              const netto  = nettoUrenEmp(emp, row.selectedHours);
              if (!netto)  return;
              const kosten = netto * loon;

              perKlant[client.id].kosten += kosten;
              perKlant[client.id].uren   += netto;
              perKlant[client.id].subcats[subId].kosten += kosten;
              perKlant[client.id].subcats[subId].uren   += netto;
              perKlant[client.id].subcats[subId].details.push({
                empNaam:emp.name, empColor:emp.color, netto, loon, kosten,
                datum:date.toLocaleDateString("nl-NL",{weekday:"short",day:"numeric",month:"short"}),
              });
              if (perDept[client.departmentId]) {
                perDept[client.departmentId].kosten += kosten;
                perDept[client.departmentId].uren   += netto;
              }
            });
          });
        });
      });
      return {perKlant,perDept};
    }, [schedule,employees,clients,subcats,depts,allDates]);

    const fc = Object.entries(kostenData.perKlant).filter(([cid,c]) => {
      if (filterDeptId!=="all" && c.deptId!==filterDeptId) return false;
      if (filterClientId!=="all" && cid!==filterClientId) return false;
      return true;
    });
    const totalKosten = fc.reduce((a,[,c])=>a+c.kosten,0);
    const totalUren   = fc.reduce((a,[,c])=>a+c.uren,0);
    const wf          = viewType==="week" ? 1 : allDates.length/7;
    const maandSchat  = (totalKosten/Math.max(wf,1)) * (52/12);
    const jaarSchat   = (totalKosten/Math.max(wf,1)) * 52;
    const empZonderLoon = employees.filter(e => !e.hourlyWage||e.hourlyWage===0);

    return (
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))",gap:20}}>
        {empZonderLoon.length>0&&(
          <div style={{gridColumn:"1/-1",background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.25)",
            borderRadius:10,padding:"12px 16px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <AlertTriangle size={14} color="#F59E0B"/>
            <span style={{fontSize:12,color:"#F59E0B"}}>
              <strong>Let op:</strong> {empZonderLoon.length} medewerker(s) zonder uurloon: {empZonderLoon.map(e=>e.name).join(", ")}
            </span>
          </div>
        )}

        {/* Filters */}
        <div style={{gridColumn:"1/-1",background:"#0f172a",borderRadius:12,padding:16,border:"1px solid #1e293b",display:"flex",gap:16,flexWrap:"wrap",alignItems:"center"}}>
          <select value={filterDeptId} onChange={e=>{setFilterDeptId(e.target.value);setFilterClientId("all");}}
            style={{background:"#1e293b",color:"white",border:"1px solid #334155",borderRadius:6,padding:"5px 10px",fontSize:12}}>
            <option value="all">Alle afdelingen</option>
            {depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={filterClientId} onChange={e=>setFilterClientId(e.target.value)}
            style={{background:"#1e293b",color:"white",border:"1px solid #334155",borderRadius:6,padding:"5px 10px",fontSize:12}}>
            <option value="all">Alle klanten</option>
            {clients.filter(c=>filterDeptId==="all"||c.departmentId===filterDeptId).map(c=>(
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* KPI */}
        <div style={{gridColumn:"1/-1",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:14}}>
          {[
            {label:"Loonkosten periode",value:fmtEuro(totalKosten),sub:`${totalUren.toFixed(1)} uur gewerkt`,icon:<Euro size={18}/>,color:"#3B82F6"},
            {label:"Schatting per maand",value:fmtEuro(maandSchat),sub:"Geëxtrapoleerd",icon:<TrendingUp size={18}/>,color:"#10B981"},
            {label:"Schatting per jaar", value:fmtEuro(jaarSchat), sub:"Geëxtrapoleerd",icon:<PieChart size={18}/>,color:"#8B5CF6"},
          ].map(kpi=>(
            <div key={kpi.label} style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:14,padding:20}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                <div style={{color:kpi.color}}>{kpi.icon}</div>
                <span style={{fontSize:11,color:"#64748B",fontWeight:600,letterSpacing:"0.04em"}}>{kpi.label.toUpperCase()}</span>
              </div>
              <div style={{fontSize:26,fontWeight:800,color:"white",letterSpacing:"-.5px"}}>{kpi.value}</div>
              <div style={{fontSize:10,color:"#475569",marginTop:4}}>{kpi.sub}</div>
            </div>
          ))}
        </div>

        {/* Uurlonen */}
        <section style={{background:"#0f172a",borderRadius:14,padding:22,border:"1px solid #1e293b"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:18}}>
            <Users size={17} color="#F59E0B"/>
            <h3 style={{margin:0,color:"white",fontSize:14,fontWeight:700}}>Uurlonen</h3>
          </div>
          {employees.filter(e=>filterDeptId==="all"||e.departmentId===filterDeptId).map(emp=>(
            <div key={emp.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#1e293b",borderRadius:8,padding:"10px 14px",marginBottom:8,borderLeft:`3px solid ${emp.color}`}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:10,height:10,borderRadius:"50%",background:emp.color}}/>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:"white"}}>{emp.name}</div>
                  <div style={{fontSize:10,color:"#64748B"}}>{depts.find(d=>d.id===emp.departmentId)?.name}</div>
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{color:"#64748B",fontSize:13}}>€</span>
                <input type="number" step="0.01" min={0} value={emp.hourlyWage||0}
                  onChange={e=>updEmployee({...emp,hourlyWage:parseFloat(e.target.value)||0})}
                  style={{width:70,background:"#0f172a",color:emp.hourlyWage?"white":"#EF4444",
                    border:`1px solid ${emp.hourlyWage?"#334155":"#EF4444"}`,
                    borderRadius:6,padding:"5px 8px",textAlign:"right",fontSize:13,fontWeight:600}}/>
                <span style={{color:"#64748B",fontSize:11}}>/uur</span>
              </div>
            </div>
          ))}
        </section>

        {/* Kosten per klant */}
        <section style={{background:"#0f172a",borderRadius:14,padding:22,border:"1px solid #1e293b",gridColumn:"span 2"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:18}}>
            <Building2 size={17} color="#38BDF8"/>
            <h3 style={{margin:0,color:"white",fontSize:14,fontWeight:700}}>Kosten per klant / taak</h3>
          </div>
          {fc.length===0&&(
            <div style={{color:"#334155",textAlign:"center",padding:40}}>
              <div style={{fontSize:14,marginBottom:8}}>Geen data voor deze selectie</div>
              <div style={{fontSize:11,color:"#1e293b"}}>Zorg dat medewerkers zijn ingepland en uurlonen zijn ingesteld</div>
            </div>
          )}
          {fc.map(([clientId,clientData])=>(
            <div key={clientId} style={{marginBottom:20,background:"#1e293b",borderRadius:10,overflow:"hidden"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 16px",background:"#172033"}}>
                <span style={{fontWeight:700,color:"#38BDF8",fontSize:14}}>{clientData.naam}</span>
                <div style={{textAlign:"right"}}>
                  <div style={{fontWeight:700,color:clientData.kosten>0?"white":"#475569"}}>{fmtEuro(clientData.kosten)}</div>
                  <div style={{fontSize:10,color:"#64748B"}}>{clientData.uren.toFixed(1)} uur</div>
                </div>
              </div>
              {Object.entries(clientData.subcats).map(([subId,subData])=>(
                <div key={subId}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 16px 10px 28px",borderBottom:"1px solid #0f172a"}}>
                    <span style={{color:"#94A3B8",fontSize:13}}>↳ {subData.naam}</span>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{textAlign:"right"}}>
                        <div style={{color:subData.kosten>0?"#94A3B8":"#334155",fontSize:13,fontWeight:600}}>{fmtEuro(subData.kosten)}</div>
                        <div style={{fontSize:9,color:"#475569"}}>{subData.uren.toFixed(1)} uur</div>
                      </div>
                      <button onClick={()=>setShowCalcFor(p=>p===subId?null:subId)}
                        style={{background:"#0f172a",border:"1px solid #334155",color:"#64748B",borderRadius:5,padding:"3px 8px",fontSize:10,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
                        {showCalcFor===subId?<EyeOff size={11}/>:<Eye size={11}/>} Detail
                      </button>
                    </div>
                  </div>
                  {showCalcFor===subId&&(
                    <div style={{padding:"12px 28px",background:"rgba(0,0,0,.2)"}}>
                      {subData.details.length===0&&<div style={{fontSize:11,color:"#334155",fontStyle:"italic"}}>Geen ingeplande uren met uurloon.</div>}
                      {subData.details.map((d:any,i:number)=>(
                        <div key={i} style={{fontSize:11,color:"#64748B",marginBottom:5,fontFamily:"monospace",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                          <span style={{width:8,height:8,borderRadius:"50%",background:d.empColor,display:"inline-block",flexShrink:0}}/>
                          <span style={{color:"#94A3B8"}}>{d.empNaam}</span>
                          <span style={{color:"#475569",fontSize:9}}>{d.datum}</span>:
                          <span style={{color:"#10B981"}}>{d.netto.toFixed(2)}u</span>
                          × {fmtEuro(d.loon)} = <span style={{color:"white",fontWeight:"bold"}}>{fmtEuro(d.kosten)}</span>
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

  // ─── Tabs definitie ──────────────────────────────────────────────────────────
  const tabs = [
    {id:"planning",    label:"Planning",        icon:<Calendar size={14}/>},
    {id:"medewerkers", label:"Medewerkers",     icon:<Users size={14}/>},
    {id:"beheer",      label:"Klanten & Shifts",icon:<Settings size={14}/>},
    ...(isAdmin ? [
      {id:"financieel",label:"Financieel",      icon:<Euro size={14}/>},
      {id:"admin",     label:"Gebruikers",      icon:<Shield size={14}/>},
    ] : []),
  ];

  const vacModalEmp = vacModalEmpId ? employees.find(e => e.id===vacModalEmpId) : null;

  if (loading) return (
    <div style={{minHeight:"100vh",background:"#020617",display:"flex",alignItems:"center",justifyContent:"center",
      color:"#475569",fontFamily:"'Segoe UI',system-ui,sans-serif",flexDirection:"column",gap:12}}>
      <div style={{width:40,height:40,border:"3px solid #1e293b",borderTop:"3px solid #3B82F6",
        borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
      <span>Data laden...</span>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#020617",color:"#F8FAFC",
      fontFamily:"'Segoe UI',system-ui,sans-serif",padding:16}}>

      {/* Modals */}
      {renderAddModal()}

      {vacModalEmp && (
        <VacationModal
          emp={vacModalEmp}
          onClose={()=>setVacModalEmpId(null)}
          updEmployee={updEmployee}
        />
      )}

      {customShiftSlot && (
        <CustomShiftModal
          slotId={customShiftSlot.slotId}
          rowIdx={customShiftSlot.rowIdx}
          schedule={schedule}
          updSchedule={updSchedule}
          onClose={()=>setCustomShiftSlot(null)}
        />
      )}

      {showPDFModal && (
        <PDFPreviewModal
          data={{
            deptName:  activeDept?.name || "",
            weekLabel: viewType==="week"
              ? `Week ${weekNum(weekStart)} · ${weekStart.toLocaleDateString("nl-NL",{day:"numeric",month:"short"})} – ${new Date(weekStart.getTime()+6*86400000).toLocaleDateString("nl-NL",{day:"numeric",month:"short",year:"numeric"})}`
              : `${MONTH_LABELS[viewMonth]} ${viewYear}`,
            weekStart,
            dates:     displayDates(),
            employees, clients:deptClients, subcats, schedule, skills, shiftDefs,
          }}
          onClose={()=>setShowPDFModal(false)}
        />
      )}

      {/* Navigatie */}
      <nav style={{display:"flex",justifyContent:"space-between",alignItems:"center",
        marginBottom:18,borderBottom:"1px solid #0f172a",paddingBottom:14,flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          {depts.length===0
            ? <div style={{color:"#475569",fontSize:12,padding:8}}>Geen afdelingen</div>
            : <select value={activeDeptId} onChange={e=>setActiveDeptId(e.target.value)}
                style={{background:"#3B82F6",color:"white",padding:"8px 12px",borderRadius:8,border:"none",fontWeight:700,cursor:"pointer"}}>
                {depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
          }
          {tabs.map(tab=>(
            <button key={tab.id} onClick={()=>setActiveTab(tab.id as any)}
              style={{background:activeTab===tab.id?"#0f172a":"transparent",
                color:activeTab===tab.id?"white":"#64748B",
                border:activeTab===tab.id?"1px solid #1e293b":"1px solid transparent",
                padding:"7px 14px",borderRadius:8,cursor:"pointer",
                fontWeight:activeTab===tab.id?700:400,fontSize:13,
                display:"flex",alignItems:"center",gap:6}}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          {/* FTE toggle */}
          <div style={{display:"flex",alignItems:"center",gap:6,background:"#0f172a",padding:"6px 12px",borderRadius:8,border:"1px solid #1e293b"}}>
            <span style={{fontSize:11,color:"#64748B"}}>FTE</span>
            <button onClick={()=>setUseFTE(v=>!v)} style={{background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center"}}>
              {useFTE?<ToggleRight size={22} color="#10B981"/>:<ToggleLeft size={22} color="#334155"/>}
            </button>
          </div>

          {/* Auto-planner */}
          <button onClick={()=>{
            if(window.confirm("Automatisch inplannen? Bestaande planning wordt overschreven."))
              runAutoPlanner();
          }} style={{background:"#10B981",color:"white",border:"none",padding:"8px 16px",
            borderRadius:8,cursor:"pointer",fontWeight:700,
            display:"flex",alignItems:"center",gap:6,fontSize:13}}>
            <Zap size={14}/> Auto-planner
          </button>

          {/* Leegmaken */}
          <button onClick={()=>{if(window.confirm("Planning leegmaken?")){setSchedule({});sb.from("schedule").delete().neq("slot_id","__never__");}}}
            style={{background:"rgba(239,68,68,.1)",color:"#EF4444",border:"1px solid rgba(239,68,68,.2)",
              padding:"8px 12px",borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",gap:6,fontSize:12}}>
            <Trash2 size={13}/>Leeg
          </button>

          {/* PDF */}
          <button onClick={()=>setShowPDFModal(true)}
            style={{background:"#8B5CF6",color:"white",border:"none",padding:"8px 14px",
              borderRadius:8,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",gap:6,fontSize:13}}>
            <Printer size={14}/> Afdrukken
          </button>

          {/* Wachtwoord eigen account */}
          <button onClick={()=>setAddModal({type:"changePassword",data:{userId:currentUserId,userName:currentEmp?.name||"Mijn account"}})}
            style={{background:"#0f172a",border:"1px solid #1e293b",color:"#64748B",padding:"8px 10px",borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",gap:4,fontSize:12}}>
            <Key size={13}/>
          </button>

          {/* Uitloggen */}
          <button onClick={()=>sb.auth.signOut()}
            style={{background:"transparent",color:"#475569",border:"1px solid #1e293b",
              padding:"8px 12px",borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",gap:6,fontSize:12}}>
            <LogOut size={13}/>Uit
          </button>
        </div>
      </nav>

      <main>
        {activeTab==="planning"    && <TabPlanning/>}
        {activeTab==="medewerkers" && <TabMedewerkers/>}
        {activeTab==="beheer"      && <TabBeheer/>}
        {activeTab==="financieel"  && isAdmin && <TabFinancieel/>}
        {activeTab==="admin"       && isAdmin && (
          <AdminPanel
            currentUserId={currentUserId}
            activeDeptId={activeDeptId}
            depts={depts}
            employees={employees}
            setEmployees={setEmployees}
            setAddModal={setAddModal}
          />
        )}
      </main>

      <style>{`
        input:focus,select:focus,textarea:focus{outline:1px solid #3B82F6!important;border-radius:4px;}
        button:active{transform:scale(.97);}
        ::-webkit-scrollbar{width:6px;height:6px;}
        ::-webkit-scrollbar-track{background:#0f172a;}
        ::-webkit-scrollbar-thumb{background:#1e293b;border-radius:3px;}
        ::-webkit-scrollbar-thumb:hover{background:#334155;}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ROOT
// ══════════════════════════════════════════════════════════════════════════════
export default function AppRoot() {
  const [session,      setSession]      = useState<Session|null>(null);
  const [authChecked,  setAuthChecked]  = useState(false);

  useEffect(() => {
    sb.auth.getSession().then(({data}) => { setSession(data.session); setAuthChecked(true); });
    const { data:l } = sb.auth.onAuthStateChange((_,s) => setSession(s));
    return () => l.subscription.unsubscribe();
  }, []);

  if (!authChecked) return (
    <div style={{minHeight:"100vh",background:"#020617",display:"flex",alignItems:"center",
      justifyContent:"center",color:"#334155",fontFamily:"'Segoe UI',system-ui,sans-serif",fontSize:14}}>
      ⏳ Laden...
    </div>
  );
  if (!session) return <LoginScreen/>;
  return <App session={session}/>;
}
