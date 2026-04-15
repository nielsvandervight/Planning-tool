/**
 * PERSONEELSPLANNING APP — Volledig Herschreven
 * ─────────────────────────────────────────────
 * Features:
 *  • Alle modals via uniforme Modal-component (geen focus-verlies)
 *  • One-page adaptieve PDF (jspdf + html2canvas) met preview modal
 *  • Dynamische schaling op basis van medewerkercount
 *  • Pauze presets (30m / 60m / 15-30-15) + exacte tijden
 *  • Break-cover logica + visualisatie (scherm + PDF)
 *  • Alle data via Supabase, geen hardcoded fallbacks
 *
 * INSTALLATIE (eenmalig):
 *   npm install jspdf html2canvas
 */

import React, {
  useState, useEffect, useCallback, useRef, useMemo
} from "react";
import { createClient, Session } from "@supabase/supabase-js";
import {
  Users, Calendar, Settings, Euro, LogOut,
  ChevronLeft, ChevronRight, Plus, Trash2, Printer, Zap,
  ToggleLeft, ToggleRight, AlertTriangle, Eye, EyeOff,
  TrendingUp, Building2, PieChart, Clock, Shield, Coffee,
  X, Check, Edit2, Download, FileText
} from "lucide-react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

// ─── Supabase ─────────────────────────────────────────────────────────────────
const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
  coverEmployeeId?: string; // vervanger tijdens pauze
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
  { label:"30 min",        breaks:[{ id:"p1", startHour:12, startMin:0, endHour:12, endMin:30, label:"Lunch" }] },
  { label:"60 min",        breaks:[{ id:"p2", startHour:12, startMin:0, endHour:13, endMin:0,  label:"Lunch" }] },
  { label:"15+30+15 min",  breaks:[
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
  const r = new Date(d); const day = r.getDay();
  r.setDate(r.getDate() - day + (day===0?-6:1));
  r.setHours(0,0,0,0); return r;
}
function datesInMonth(month: number, year: number): Date[] {
  const out: Date[] = []; const d = new Date(year, month, 1);
  while (d.getMonth()===month) { out.push(new Date(d)); d.setDate(d.getDate()+1); }
  return out;
}
const dayLabel    = (d: Date) => DAY_LABELS[d.getDay()===0?6:d.getDay()-1];
const isWeekend   = (d: Date) => d.getDay()===0||d.getDay()===6;
const getWeekKey  = (d: Date) => fmtDate(startOfWeek(d));
const fmtEuro     = (n: number) => new Intl.NumberFormat("nl-NL",{style:"currency",currency:"EUR"}).format(n);
const fmtTime     = (h: number, m: number) => `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
function contrastColor(hex: string): string {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return (r*299+g*587+b*114)/1000>128?"#000":"#fff";
}

function calcBreakMins(breaks: BreakSlot[], selectedHours: number[]): number {
  if (!breaks?.length) return (selectedHours?.length||0)>=9?60:0;
  let total=0;
  breaks.forEach(b=>{
    const bs=b.startHour+b.startMin/60, be=b.endHour+b.endMin/60;
    if (!selectedHours?.length) return;
    const ss=Math.min(...selectedHours), se=Math.max(...selectedHours)+1;
    total+=Math.max(0,Math.min(se,be)-Math.max(ss,bs))*60;
  });
  return total;
}
function nettoUrenEmp(emp: Employee, hours: number[]): number {
  return Math.max(0,(hours?.length||0)-calcBreakMins(emp.breaks,hours)/60);
}
function nettoUren(hours: number[]): number {
  const b=hours?.length||0; return b>=9?b-1:b;
}
function isBreakHour(emp: Employee, h: number): boolean {
  return emp.breaks.some(b=>h>=b.startHour+b.startMin/60&&h<b.endHour+b.endMin/60);
}
function shiftTimeStr(hours: number[]): string {
  if (!hours?.length) return "";
  return `${String(Math.min(...hours)).padStart(2,"0")}:00 – ${String(Math.max(...hours)+1).padStart(2,"0")}:00`;
}

function useDebounce<T extends (...args:any[])=>any>(fn:T, delay:number): T {
  const timer=useRef<ReturnType<typeof setTimeout>>();
  const ref=useRef(fn); ref.current=fn;
  return useCallback((...args:Parameters<T>)=>{
    clearTimeout(timer.current);
    timer.current=setTimeout(()=>ref.current(...args),delay);
  },[delay]) as T;
}

function genId(prefix:string) { return prefix+Date.now()+Math.random().toString(36).slice(2,6); }

// ─── Modal component (BUITEN alles, geen re-render focus-verlies) ─────────────
const Modal = React.memo(function Modal({
  title, onClose, children, width="520px", zIndex=2000
}:{title:string;onClose:()=>void;children:React.ReactNode;width?:string;zIndex?:number}) {
  // Trap focus inside modal
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const el=ref.current?.querySelector<HTMLElement>("input,select,textarea,button");
    el?.focus();
  },[]);
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex,
      display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
      onClick={onClose}>
      <div ref={ref} onClick={e=>e.stopPropagation()}
        style={{background:"#0f172a",borderRadius:16,padding:28,width,
          maxWidth:"95vw",maxHeight:"90vh",overflowY:"auto",
          border:"1px solid #1e293b",boxShadow:"0 25px 80px rgba(0,0,0,.7)"}}>
        <div style={{display:"flex",justifyContent:"space-between",
          alignItems:"center",marginBottom:20}}>
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

// ─── Field helper ─────────────────────────────────────────────────────────────
function ModalField({label,children}:{label:string;children:React.ReactNode}) {
  return (
    <div style={{marginBottom:14}}>
      <label style={{fontSize:11,fontWeight:600,color:"#64748B",
        display:"block",marginBottom:6,letterSpacing:"0.06em"}}>{label}</label>
      {children}
    </div>
  );
}
const inputSt:React.CSSProperties={
  width:"100%",padding:"10px 14px",background:"#1e293b",color:"white",
  border:"1px solid #334155",borderRadius:8,fontSize:13,
  boxSizing:"border-box",outline:"none"
};
const selectSt:React.CSSProperties={...inputSt,cursor:"pointer"};

// ─── ColorPicker ──────────────────────────────────────────────────────────────
const ColorPicker=React.memo(function ColorPicker(
  {value,onChange}:{value:string;onChange:(c:string)=>void}
){
  const [open,setOpen]=useState(false);
  return (
    <div style={{position:"relative",display:"inline-block"}}>
      <div onClick={()=>setOpen(v=>!v)} title="Kies kleur"
        style={{width:28,height:28,borderRadius:"50%",background:value,
          cursor:"pointer",border:"2px solid #475569",boxSizing:"border-box"}}/>
      {open&&(
        <div onClick={e=>e.stopPropagation()}
          style={{position:"absolute",top:34,left:0,background:"#1e293b",
            borderRadius:10,padding:10,border:"1px solid #334155",zIndex:200,
            display:"grid",gridTemplateColumns:"repeat(6,22px)",gap:4,
            boxShadow:"0 10px 30px rgba(0,0,0,.5)"}}>
          {COLORS.map(c=>(
            <div key={c} onClick={()=>{onChange(c);setOpen(false);}}
              style={{width:22,height:22,borderRadius:"50%",background:c,cursor:"pointer",
                border:c===value?"3px solid white":"2px solid transparent",
                boxSizing:"border-box"}}/>
          ))}
          <div style={{gridColumn:"1/-1",marginTop:4,borderTop:"1px solid #334155",paddingTop:6}}>
            <label style={{fontSize:9,color:"#64748B",display:"block",marginBottom:3}}>
              EIGEN KLEUR</label>
            <input type="color" value={value}
              onChange={e=>{onChange(e.target.value);setOpen(false);}}
              style={{width:"100%",height:24,cursor:"pointer",background:"none",
                border:"none",borderRadius:4}}/>
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
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  async function login() {
    setLoading(true);setError("");
    const {error}=await sb.auth.signInWithPassword({email,password});
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
          <div style={{fontSize:24,fontWeight:700,color:"white",letterSpacing:"-.5px"}}>
            Personeelsplanning</div>
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
        {error&&<div style={{background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.3)",
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
// PDF PREVIEW & EXPORT
// ══════════════════════════════════════════════════════════════════════════════
// We bouwen een HTML tabel die we via html2canvas → jsPDF exporteren.
// Volledig adaptief: schaal past zich aan op het aantal medewerkers.

interface PDFData {
  deptName: string;
  weekLabel: string;
  dates: Date[];
  employees: Employee[];
  clients: Client[];
  subcats: Subcategory[];
  schedule: Record<string,SlotEntry>;
  skills: Skill[];
}

function buildPDFHTML(data: PDFData, orientation: "landscape"|"portrait"): string {
  const { deptName, weekLabel, dates, employees, clients, subcats, schedule } = data;

  // Bereken welke medewerkers deze week ingepland staan
  const scheduledEmpIds = new Set<string>();
  dates.forEach(date=>{
    const ds=fmtDate(date);
    Object.entries(schedule).forEach(([slotId,entry])=>{
      if (slotId.startsWith(ds)) {
        entry.rows?.forEach(r=>{ if(r.employeeId) scheduledEmpIds.add(r.employeeId); });
      }
    });
  });
  const scheduledEmps = employees.filter(e=>scheduledEmpIds.has(e.id));
  const empCount = Math.max(scheduledEmps.length, 1);

  // Adaptieve schaling
  const maxRows = orientation==="landscape" ? 20 : 28;
  const scale   = Math.min(1, maxRows / empCount);
  const rowH    = Math.max(18, Math.round(32 * scale));
  const fs      = Math.max(7,  Math.round(11 * scale));
  const fsSmall = Math.max(6,  Math.round(9  * scale));
  const colW    = orientation==="landscape" ? "60px" : "42px";
  const labelW  = orientation==="landscape" ? "130px" : "100px";

  // Kleur als hex, inline style
  const hex2rgba=(hex:string,a:number)=>{
    const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
  };

  const workDays = dates.filter(d=>!isWeekend(d));

  let rows = "";
  scheduledEmps.forEach(emp=>{
    let cells = `<td style="padding:2px 6px;font-size:${fs}px;font-weight:700;
      color:${contrastColor(emp.color)};background:${emp.color};
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      border-right:2px solid #1e293b;max-width:${labelW};">${emp.name}</td>`;

    workDays.forEach(date=>{
      const ds=fmtDate(date);
      // Zoek alle sloten voor deze medewerker op deze dag
      let cellContent="";
      clients.forEach(client=>{
        const csubs=subcats.filter(s=>s.clientId===client.id);
        const slotGroups=csubs.length
          ? csubs.map(s=>[`${ds}-${s.id}`,s] as [string,Subcategory])
          : [[`${ds}-client-${client.id}`,null] as [string,null]];
        slotGroups.forEach(([slotId,sub])=>{
          const entry=schedule[slotId];
          entry?.rows?.forEach(row=>{
            if (row.employeeId!==emp.id) return;
            const timeStr=shiftTimeStr(row.selectedHours);
            const breakMins=calcBreakMins(emp.breaks,row.selectedHours);
            const breakStr=breakMins>0?`Pauze: ${breakMins}m`:"";
            const coverEmp=row.coverEmployeeId?employees.find(e=>e.id===row.coverEmployeeId):null;
            const coverStr=coverEmp?`V: ${coverEmp.name.split(" ")[0]}`:"";
            const subName=sub?.name||client.name;
            cellContent+=`
              <div style="margin-bottom:2px;padding:2px 3px;border-radius:3px;
                background:${hex2rgba(emp.color,.15)};border-left:3px solid ${emp.color};">
                <div style="font-size:${fs}px;font-weight:700;color:#0f172a;">${timeStr}</div>
                <div style="font-size:${fsSmall}px;color:#475569;">${subName}</div>
                ${breakStr?`<div style="font-size:${fsSmall}px;color:#b45309;">☕ ${breakStr}${coverStr?" ("+coverStr+")":""}</div>`:""}
              </div>`;
          });
        });
      });
      if (!cellContent) cellContent=`<div style="color:#d1d5db;font-size:${fsSmall}px;">—</div>`;
      cells+=`<td style="padding:3px;border:1px solid #e5e7eb;vertical-align:top;
        min-height:${rowH}px;background:#fff;">${cellContent}</td>`;
    });
    rows+=`<tr style="height:${rowH}px;">${cells}</tr>`;
  });

  const dayHeaders=workDays.map(d=>`
    <th style="padding:4px 2px;background:#1e293b;color:#f8fafc;font-size:${fs}px;
      font-weight:700;text-align:center;border:1px solid #334155;">
      ${dayLabel(d).slice(0,2)}<br/>
      <span style="font-size:${fsSmall}px;font-weight:400;">${d.getDate()}/${d.getMonth()+1}</span>
    </th>`).join("");

  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #fff; color: #111; padding: 16px; }
  table { border-collapse: collapse; width: 100%; }
  .header { display: flex; justify-content: space-between; align-items: flex-end;
    border-bottom: 3px solid #0f172a; padding-bottom: 8px; margin-bottom: 12px; }
  .title { font-size: 18px; font-weight: 900; color: #0f172a; }
  .subtitle { font-size: 11px; color: #64748b; margin-top: 3px; }
  .meta { font-size: 10px; color: #94a3b8; text-align: right; }
  .legend { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 8px; }
  .legend-item { display: flex; align-items: center; gap: 4px; font-size: 10px; color: #475569; }
</style>
</head><body>
<div class="header">
  <div>
    <div class="title">${deptName} — Weekplanning</div>
    <div class="subtitle">${weekLabel} · Gedrukt: ${new Date().toLocaleDateString("nl-NL")}</div>
  </div>
  <div class="meta">
    ${scheduledEmps.length} medewerkers<br/>
    ${workDays.length} werkdagen
  </div>
</div>
<table>
  <thead>
    <tr>
      <th style="padding:4px 6px;background:#0f172a;color:#f8fafc;font-size:${fs}px;
        font-weight:700;text-align:left;min-width:${labelW};border:1px solid #334155;">
        Medewerker</th>
      ${dayHeaders}
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
<div class="legend">
  <div class="legend-item">☕ = Pauze</div>
  <div class="legend-item">V: = Vervanger tijdens pauze</div>
  <div class="legend-item">— = Niet ingepland</div>
</div>
</body></html>`;
}

// PDF Preview Modal
const PDFPreviewModal = React.memo(function PDFPreviewModal({
  data, onClose
}:{data:PDFData;onClose:()=>void}) {
  const [orientation, setOrientation] = useState<"landscape"|"portrait">("landscape");
  const [generating, setGenerating]   = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const html = useMemo(()=>buildPDFHTML(data, orientation), [data, orientation]);

  useEffect(()=>{
    if (iframeRef.current) {
      const doc=iframeRef.current.contentDocument;
      if (doc) { doc.open(); doc.write(html); doc.close(); }
    }
  },[html]);

  async function downloadPDF() {
    setGenerating(true);
    try {
      // Render HTML in verborgen div (html2canvas werkt beter dan iframe cross-origin)
      const container = document.createElement("div");
      container.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1122px;background:#fff;padding:0;margin:0;";
      container.innerHTML = html;
      document.body.appendChild(container);
      // Wacht tot fonts/images geladen zijn
      await new Promise(r => setTimeout(r, 400));
      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
        width: container.scrollWidth,
        height: container.scrollHeight,
      });
      document.body.removeChild(container);
      const pdf = new jsPDF({ orientation, unit: "mm", format: "a4" });
      const pw  = pdf.internal.pageSize.getWidth();
      const ph  = pdf.internal.pageSize.getHeight();
      // Schaal canvas naar A4 met behoud van aspect ratio
      const imgW = canvas.width;
      const imgH = canvas.height;
      const scale = Math.min(pw / imgW, ph / imgH);
      const finalW = imgW * scale;
      const finalH = imgH * scale;
      const offsetX = (pw - finalW) / 2;
      const offsetY = (ph - finalH) / 2;
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", offsetX, offsetY, finalW, finalH);
      const weekStr = data.weekLabel.replace(/[\s·/–]/g, "_").replace(/_+/g, "_");
      pdf.save(`planning_${data.deptName}_${weekStr}.pdf`);
    } catch (e) {
      console.error("PDF generatie mislukt:", e);
      // Fallback: browser print
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); w.print(); }
    }
    setGenerating(false);
  }

  return (
    <Modal title="🖨️ PDF Preview & Download" onClose={onClose} width="900px" zIndex={3000}>
      <div style={{display:"flex",gap:10,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:11,color:"#64748B",fontWeight:700}}>FORMAAT:</span>
        {(["landscape","portrait"] as const).map(o=>(
          <button key={o} onClick={()=>setOrientation(o)}
            style={{padding:"6px 14px",borderRadius:8,border:"2px solid",
              borderColor:orientation===o?"#3B82F6":"#334155",
              background:orientation===o?"#1d4ed8":"#0f172a",
              color:"white",cursor:"pointer",fontWeight:700,fontSize:12}}>
            {o==="landscape"?"A4 Liggend":"A4 Staand"}
          </button>
        ))}
        <span style={{fontSize:10,color:"#475569",marginLeft:"auto"}}>
          {data.employees.filter(e=>Object.keys(data.schedule).some(k=>
            data.dates.some(d=>k.startsWith(fmtDate(d))) &&
            data.schedule[k]?.rows?.some(r=>r.employeeId===e.id)
          )).length} medewerkers ingepland
        </span>
      </div>

      {/* Preview iframe */}
      <div style={{border:"1px solid #334155",borderRadius:8,overflow:"hidden",
        marginBottom:16,background:"#fff",height:500}}>
        <iframe ref={iframeRef} title="PDF Preview"
          style={{width:"100%",height:"100%",border:"none"}}/>
      </div>

      <div style={{display:"flex",gap:10}}>
        <button onClick={onClose}
          style={{flex:1,padding:10,background:"#1e293b",border:"none",
            color:"white",borderRadius:8,cursor:"pointer"}}>
          Annuleer
        </button>
        <button onClick={downloadPDF} disabled={generating}
          style={{flex:2,padding:10,background:"#3B82F6",border:"none",
            color:"white",borderRadius:8,cursor:generating?"wait":"pointer",
            fontWeight:700,display:"flex",alignItems:"center",
            justifyContent:"center",gap:8,opacity:generating?.7:1}}>
          <Download size={15}/>
          {generating?"PDF genereren...":"PDF Downloaden"}
        </button>
        <button onClick={()=>{
          // Browser print fallback
          const w=window.open("","_blank");
          if(w){w.document.write(html);w.document.close();w.print();}
        }} style={{flex:1,padding:10,background:"#8B5CF6",border:"none",
          color:"white",borderRadius:8,cursor:"pointer",fontWeight:700,
          display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
          <Printer size={14}/> Print
        </button>
      </div>
    </Modal>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// PAUZE MANAGEMENT MODAL
// ══════════════════════════════════════════════════════════════════════════════
const BreakModal = React.memo(function BreakModal({
  empId, employees, onSave, onClose
}:{empId:string;employees:Employee[];onSave:(emp:Employee)=>void;onClose:()=>void}) {
  const emp=employees.find(e=>e.id===empId);
  if (!emp) return null;
  const [breaks,setBreaks]=useState<BreakSlot[]>(emp.breaks||[]);
  const MINS=[0,5,10,15,20,25,30,45];

  function applyPreset(preset: typeof BREAK_PRESETS[0]) {
    setBreaks(preset.breaks.map(b=>({...b,id:genId("br")})));
  }
  function addBreak() {
    setBreaks(prev=>[...prev,{id:genId("br"),startHour:12,startMin:0,endHour:12,endMin:30,label:"Pauze"}]);
  }
  function upd(id:string,field:keyof BreakSlot,val:any) {
    setBreaks(prev=>prev.map(b=>b.id===id?{...b,[field]:val}:b));
  }
  function save() { onSave({...emp,breaks}); onClose(); }

  return (
    <Modal title={`☕ Pauze Configuratie — ${emp.name}`} onClose={onClose} width="500px">
      <div style={{marginBottom:12}}>
        <div style={{fontSize:11,color:"#64748B",fontWeight:700,marginBottom:8,letterSpacing:"0.06em"}}>
          SNELLE PRESETS</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {BREAK_PRESETS.map(p=>(
            <button key={p.label} onClick={()=>applyPreset(p)}
              style={{padding:"5px 12px",background:"#1e293b",border:"1px solid #334155",
                color:"#F59E0B",borderRadius:8,cursor:"pointer",fontSize:11,fontWeight:700}}>
              {p.label}
            </button>
          ))}
          <button onClick={()=>setBreaks([])}
            style={{padding:"5px 12px",background:"#1e293b",border:"1px solid #EF4444",
              color:"#EF4444",borderRadius:8,cursor:"pointer",fontSize:11}}>
            Leeg
          </button>
        </div>
      </div>

      {breaks.map(b=>{
        const dur=(b.endHour*60+b.endMin)-(b.startHour*60+b.startMin);
        return (
          <div key={b.id} style={{background:"#1e293b",borderRadius:8,padding:12,marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <Coffee size={13} color="#F59E0B"/>
              <input value={b.label} onChange={e=>upd(b.id,"label",e.target.value)}
                style={{...inputSt,padding:"4px 8px",fontSize:12,fontWeight:700,
                  color:"#F59E0B",background:"#0f172a",flex:1}}/>
              <button onClick={()=>setBreaks(prev=>prev.filter(x=>x.id!==b.id))}
                style={{background:"none",border:"none",color:"#EF4444",cursor:"pointer"}}>
                <X size={14}/></button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",
              gap:8,alignItems:"end"}}>
              <div>
                <label style={{fontSize:9,color:"#64748B",display:"block",
                  marginBottom:4,fontWeight:700}}>BEGINTIJD</label>
                <div style={{display:"flex",gap:4}}>
                  <select value={b.startHour} onChange={e=>upd(b.id,"startHour",+e.target.value)}
                    style={{...selectSt,padding:"6px",flex:1}}>
                    {WORK_HOURS.map(h=><option key={h} value={h}>{String(h).padStart(2,"0")}</option>)}
                  </select>
                  <select value={b.startMin} onChange={e=>upd(b.id,"startMin",+e.target.value)}
                    style={{...selectSt,padding:"6px",flex:1}}>
                    {MINS.map(m=><option key={m} value={m}>{String(m).padStart(2,"0")}</option>)}
                  </select>
                </div>
              </div>
              <div style={{color:"#475569",textAlign:"center",paddingBottom:6}}>→</div>
              <div>
                <label style={{fontSize:9,color:"#64748B",display:"block",
                  marginBottom:4,fontWeight:700}}>EINDTIJD</label>
                <div style={{display:"flex",gap:4}}>
                  <select value={b.endHour} onChange={e=>upd(b.id,"endHour",+e.target.value)}
                    style={{...selectSt,padding:"6px",flex:1}}>
                    {WORK_HOURS.map(h=><option key={h} value={h}>{String(h).padStart(2,"0")}</option>)}
                  </select>
                  <select value={b.endMin} onChange={e=>upd(b.id,"endMin",+e.target.value)}
                    style={{...selectSt,padding:"6px",flex:1}}>
                    {MINS.map(m=><option key={m} value={m}>{String(m).padStart(2,"0")}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div style={{fontSize:10,color:"#64748B",marginTop:6,fontFamily:"monospace"}}>
              Duur: <span style={{color:"#F59E0B"}}>{dur} min</span>
              {" · "}{fmtTime(b.startHour,b.startMin)} – {fmtTime(b.endHour,b.endMin)}
            </div>
          </div>
        );
      })}

      <button onClick={addBreak}
        style={{width:"100%",padding:8,background:"#1e293b",
          border:"1px dashed #475569",color:"#F59E0B",borderRadius:8,
          cursor:"pointer",marginBottom:16,display:"flex",alignItems:"center",
          justifyContent:"center",gap:6,fontSize:12}}>
        <Plus size={13}/> Pauze toevoegen
      </button>

      <div style={{display:"flex",gap:8}}>
        <button onClick={onClose}
          style={{flex:1,padding:10,background:"#1e293b",border:"none",
            color:"white",borderRadius:8,cursor:"pointer"}}>
          Annuleer</button>
        <button onClick={save}
          style={{flex:2,padding:10,background:"#10B981",border:"none",
            color:"white",borderRadius:8,cursor:"pointer",fontWeight:700,
            display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
          <Check size={14}/> Opslaan</button>
      </div>
    </Modal>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// HOOFD APP
// ══════════════════════════════════════════════════════════════════════════════
function App({session}:{session:Session}) {
  const [activeTab,setActiveTab]=useState<"planning"|"medewerkers"|"beheer"|"financieel"|"admin">("planning");

  // ─ State ─
  const [depts,      setDeptsRaw]    = useState<Department[]>([]);
  const [skills,     setSkillsRaw]   = useState<Skill[]>([]);
  const [shiftDefs,  setShiftsRaw]   = useState<ShiftDef[]>([]);
  const [clients,    setClientsRaw]  = useState<Client[]>([]);
  const [subcats,    setSubcatsRaw]  = useState<Subcategory[]>([]);
  const [employees,  setEmployees]   = useState<Employee[]>([]);
  const [schedule,   setSchedule]    = useState<Record<string,SlotEntry>>({});

  const [activeDeptId, setActiveDeptId] = useState("");
  const [viewType,     setViewType]     = useState<"week"|"maand">("week");
  const [useFTE,       setUseFTE]       = useState(true);
  const [loading,      setLoading]      = useState(true);

  const today=new Date();
  const [weekStart,  setWeekStart]  = useState<Date>(()=>startOfWeek(today));
  const [viewMonth,  setViewMonth]  = useState(today.getMonth());
  const [viewYear,   setViewYear]   = useState(today.getFullYear());

  // Modal states
  const [vacModalEmpId,   setVacModalEmpId]   = useState<string|null>(null);
  const [vacModalMonth,   setVacModalMonth]   = useState(today.getMonth());
  const [vacModalYear,    setVacModalYear]    = useState(today.getFullYear());
  const [customShiftSlot, setCustomShiftSlot] = useState<{slotId:string;rowIdx:number}|null>(null);
  const [customStart,     setCustomStart]     = useState(8);
  const [customEnd,       setCustomEnd]       = useState(17);
  const [breakModalEmpId, setBreakModalEmpId] = useState<string|null>(null);
  const [showPDFModal,    setShowPDFModal]    = useState(false);
  const [showCalcFor,     setShowCalcFor]     = useState<string|null>(null);

  // Uniforme modal state voor alle "Toevoegen" acties
  const [addModal, setAddModal] = useState<{
    type: "dept"|"skill"|"client"|"subcat"|"shift"|"employee"|"editSkill"|"editSubcat"|null;
    data?: any;
  }>({type:null});

  const currentUserId = session.user.id;
  const currentEmp    = employees.find(e=>e.id===currentUserId)??employees.find(e=>e.isAdmin);
  const isAdmin       = currentEmp?.isAdmin??false;

  // ─ Data laden ─────────────────────────────────────────────────────────────
  useEffect(()=>{
    (async()=>{
      setLoading(true);
      try {
        const [dr,skr,shr,cr,scr,er,schr]=await Promise.all([
          sb.from("departments").select("*"),
          sb.from("skills").select("*"),
          sb.from("shift_defs").select("*"),
          sb.from("clients").select("*"),
          sb.from("subcategories").select("*"),
          sb.from("employees").select("*"),
          sb.from("schedule").select("*"),
        ]);
        if (dr.data?.length)  setDeptsRaw(dr.data.map((x:any)=>({id:x.id,name:x.name})));
        if (skr.data?.length) setSkillsRaw(skr.data.map((x:any)=>({id:x.id,name:x.name,criteria:x.criteria||""})));
        if (shr.data?.length) setShiftsRaw(shr.data.map((x:any)=>({id:x.id,label:x.label,hours:x.hours||[]})));
        if (cr.data?.length)  setClientsRaw(cr.data.map((x:any)=>({id:x.id,name:x.name,departmentId:x.department_id,fteNeeded:x.fte_needed||1,useFTE:x.use_fte!==false})));
        if (scr.data?.length) setSubcatsRaw(scr.data.map((x:any)=>({id:x.id,clientId:x.client_id,name:x.name,targetSkills:x.target_skills||[],requireBreakCover:x.require_break_cover||false})));
        if (er.data?.length)  setEmployees(er.data.map((x:any)=>({
          id:x.id,name:x.name,departmentId:x.department_id,
          hoursPerWeek:x.hours_per_week||40,mainClientId:x.main_client_id||"",
          subCatIds:x.sub_cat_ids||[],subCatSkills:x.sub_cat_skills||{},
          standardOffDays:x.standard_off_days||[],vacationDates:x.vacation_dates||[],
          defaultShiftId:x.default_shift_id||"",hourlyWage:x.hourly_wage||0,
          isAdmin:x.is_admin||false,color:x.color||COLORS[0],
          breaks:(x.pause_config||x.breaks||[]).map((b:any)=>({
            id:b.id||genId("br"),
            startHour:b.startHour??(b.start?parseInt(b.start.split(":")[0]):12),
            startMin :b.startMin ??(b.start?parseInt(b.start.split(":")[1]||"0"):0),
            endHour  :b.endHour  ??(b.end  ?parseInt(b.end.split(":")[0]):12),
            endMin   :b.endMin   ??(b.end  ?parseInt(b.end.split(":")[1]||"0"):30),
            label    :b.label||"Pauze",
          })),
        })));
        if (schr.data?.length) {
          const built:Record<string,SlotEntry>={};
          schr.data.forEach((x:any)=>{built[x.slot_id]={rows:x.rows||[]};});
          setSchedule(built);
        }
        if (dr.data?.length) setActiveDeptId(dr.data[0].id);
      } catch(e){console.error("DB laad-fout:",e);}
      setLoading(false);
    })();
  },[]);

  // ─ Sync helpers ────────────────────────────────────────────────────────────
  const _sCell=useCallback(async(sid:string,e:SlotEntry)=>{
    await sb.from("schedule").upsert({slot_id:sid,rows:e.rows,updated_at:new Date().toISOString()},{onConflict:"slot_id"});
  },[]);
  const syncCell=useDebounce(_sCell,500);

  const _sEmp=useCallback(async(emp:Employee)=>{
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
  },[]);
  const syncEmp=useDebounce(_sEmp,700);

  const syncDept   =useDebounce(useCallback(async(d:Department)=>{await sb.from("departments").upsert({id:d.id,name:d.name},{onConflict:"id"});},[]),700);
  const syncSkill  =useDebounce(useCallback(async(s:Skill)=>{await sb.from("skills").upsert({id:s.id,name:s.name,criteria:s.criteria},{onConflict:"id"});},[]),700);
  const syncClient =useDebounce(useCallback(async(c:Client)=>{await sb.from("clients").upsert({id:c.id,name:c.name,department_id:c.departmentId,fte_needed:c.fteNeeded,use_fte:c.useFTE},{onConflict:"id"});},[]),700);
  const syncSubcat =useDebounce(useCallback(async(s:Subcategory)=>{await sb.from("subcategories").upsert({id:s.id,client_id:s.clientId,name:s.name,target_skills:s.targetSkills,require_break_cover:s.requireBreakCover},{onConflict:"id"});},[]),700);
  const syncShift  =useDebounce(useCallback(async(s:ShiftDef)=>{await sb.from("shift_defs").upsert({id:s.id,label:s.label,hours:s.hours},{onConflict:"id"});},[]),700);

  // ─ Update functies ─────────────────────────────────────────────────────────
  function updSchedule(slotId:string,entry:SlotEntry) {
    setSchedule(prev=>({...prev,[slotId]:entry}));
    syncCell(slotId,entry);
  }
  function updEmployee(emp:Employee) {
    setEmployees(prev=>prev.map(e=>e.id===emp.id?emp:e));
    syncEmp(emp);
  }

  // Delete helpers
  async function delDept(id:string){setDeptsRaw(p=>p.filter(d=>d.id!==id));await sb.from("departments").delete().eq("id",id);}
  async function delSkill(id:string){setSkillsRaw(p=>p.filter(s=>s.id!==id));await sb.from("skills").delete().eq("id",id);}
  async function delClient(id:string){
    setClientsRaw(p=>p.filter(c=>c.id!==id));
    setSubcatsRaw(p=>p.filter(s=>s.clientId!==id));
    await sb.from("clients").delete().eq("id",id);
  }
  async function delSubcat(id:string){setSubcatsRaw(p=>p.filter(s=>s.id!==id));await sb.from("subcategories").delete().eq("id",id);}
  async function delShift(id:string){setShiftsRaw(p=>p.filter(s=>s.id!==id));await sb.from("shift_defs").delete().eq("id",id);}
  async function delEmployee(id:string){setEmployees(p=>p.filter(e=>e.id!==id));await sb.from("employees").delete().eq("id",id);}

  // ─ Navigatie ───────────────────────────────────────────────────────────────
  const displayDates=useCallback(():Date[]=>{
    if (viewType==="maand") return datesInMonth(viewMonth,viewYear);
    return Array.from({length:7},(_,i)=>{const d=new Date(weekStart);d.setDate(weekStart.getDate()+i);return d;});
  },[viewType,viewMonth,viewYear,weekStart]);

  function prevPeriod(){
    if (viewType==="week"){const d=new Date(weekStart);d.setDate(d.getDate()-7);setWeekStart(d);}
    else if (viewMonth===0){setViewMonth(11);setViewYear(y=>y-1);}
    else setViewMonth(m=>m-1);
  }
  function nextPeriod(){
    if (viewType==="week"){const d=new Date(weekStart);d.setDate(d.getDate()+7);setWeekStart(d);}
    else if (viewMonth===11){setViewMonth(0);setViewYear(y=>y+1);}
    else setViewMonth(m=>m+1);
  }
  function goToWeek(wn:number){
    const jan4=new Date(viewYear,0,4);
    const dow=jan4.getDay()||7;
    const w1=new Date(jan4);w1.setDate(jan4.getDate()-dow+1);
    const t=new Date(w1);t.setDate(w1.getDate()+(wn-1)*7);
    setWeekStart(startOfWeek(t));
  }

  // ─ Helpers ─────────────────────────────────────────────────────────────────
  const deptClients   = clients.filter(c=>c.departmentId===activeDeptId);
  const deptEmployees = employees.filter(e=>e.departmentId===activeDeptId);
  const activeDept    = depts.find(d=>d.id===activeDeptId);

  function isAvail(emp:Employee,date:Date):boolean{
    if (emp.standardOffDays.includes(dayLabel(date))) return false;
    if (emp.vacationDates.includes(fmtDate(date))) return false;
    return true;
  }
  function defaultHours(emp:Employee):number[]{
    const wd=7-emp.standardOffDays.length;
    const h=wd>0?Math.round(emp.hoursPerWeek/wd):8;
    return Array.from({length:Math.min(h,9)},(_,i)=>8+i);
  }
  function getShift(id:string){return shiftDefs.find(s=>s.id===id);}
  function calcScore(emp:Employee,sub:Subcategory):number{
    if (!sub.targetSkills.length) return 0;
    const mx=emp.subCatSkills[sub.id]||{};
    const vals=sub.targetSkills.map(sid=>{const v=mx[sid];return typeof v==="number"&&!isNaN(v)?v:0;});
    return Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
  }

  function geplandUrenWeek(empId:string,refDate:Date):number{
    const sw=startOfWeek(refDate);
    let total=0;
    for (let i=0;i<7;i++){
      const d=new Date(sw);d.setDate(sw.getDate()+i);
      const ds=fmtDate(d);
      const emp=employees.find(e=>e.id===empId);
      Object.entries(schedule).filter(([sid])=>sid.startsWith(ds)).forEach(([,entry])=>{
        entry.rows?.forEach(r=>{
          if (r.employeeId===empId)
            total+=emp?nettoUrenEmp(emp,r.selectedHours):nettoUren(r.selectedHours);
        });
      });
    }
    return total;
  }

  function fteForClient(clientId:string):number{
    const dates=displayDates();
    const csubs=subcats.filter(s=>s.clientId===clientId);
    let upd=0;
    dates.forEach(date=>{
      const ds=fmtDate(date);const seen=new Set<string>();
      if (!csubs.length){
        schedule[`${ds}-client-${clientId}`]?.rows?.forEach(r=>{if(r.employeeId)seen.add(r.employeeId);});
      } else {
        csubs.forEach(sub=>{schedule[`${ds}-${sub.id}`]?.rows?.forEach(r=>{if(r.employeeId)seen.add(r.employeeId);});});
      }
      upd+=seen.size;
    });
    return upd/(dates.filter(d=>!isWeekend(d)).length||5);
  }

  // ─ Cover logica ─────────────────────────────────────────────────────────────
  // Wijs automatisch een vervanger toe aan een subcategorie-slot als requireBreakCover=true
  function assignCoverForRow(slotId:string,rowIdx:number,emp:Employee,date:Date):string|undefined{
    if (!emp.breaks?.length) return undefined;
    const sub=subcats.find(s=>slotId.includes(s.id));
    if (!sub?.requireBreakCover) return undefined;
    // Zoek iemand anders die beschikbaar is en de subcategorie kan uitvoeren
    const existing=schedule[slotId]?.rows?.map(r=>r.employeeId).filter(Boolean)||[];
    const candidate=deptEmployees.find(e=>
      e.id!==emp.id &&
      !existing.includes(e.id) &&
      isAvail(e,date) &&
      (sub.targetSkills.length===0||e.subCatIds.includes(sub.id))
    );
    return candidate?.id;
  }

  // ─ Auto planner ────────────────────────────────────────────────────────────
  function runAutoPlanner(overwrite:boolean=true){
    const dates=displayDates();
    const dC=clients.filter(c=>c.departmentId===activeDeptId);
    const dE=employees.filter(e=>e.departmentId===activeDeptId);
    const ns={...schedule};
    const wht:Record<string,Record<string,number>>={};

    dates.forEach(date=>{
      if (isWeekend(date)) return;
      const ds=fmtDate(date);
      const wk=getWeekKey(date);
      if (!wht[wk]) wht[wk]={};
      const usedToday:string[]=[];

      dC.forEach(client=>{
        const csubs=subcats.filter(s=>s.clientId===client.id);
        const slots=csubs.length
          ?csubs.map(s=>[`${ds}-${s.id}`,s] as [string,Subcategory])
          :[[`${ds}-client-${client.id}`,null] as [string,null]];
        slots.forEach(([slotId,sub])=>{
          if (!overwrite&&ns[slotId]?.rows?.length) return;
          const cands=dE.filter(e=>{
            if (!isAvail(e,date)||usedToday.includes(e.id)) return false;
            if (sub&&!e.subCatIds.includes(sub.id)) return false;
            const planned=(wht[wk][e.id]||0)+geplandUrenWeek(e.id,date);
            return planned<e.hoursPerWeek;
          }).sort((a,b)=>{
            const as=sub?calcScore(a,sub):0,bs=sub?calcScore(b,sub):0;
            return (bs+(b.mainClientId===client.id?1000:0))-(as+(a.mainClientId===client.id?1000:0));
          });
          if (cands[0]){
            const emp=cands[0];
            usedToday.push(emp.id);
            const sh=(emp.defaultShiftId?getShift(emp.defaultShiftId):undefined)||shiftDefs[1]||shiftDefs[0];
            wht[wk][emp.id]=(wht[wk][emp.id]||0)+nettoUrenEmp(emp,sh?.hours||[]);
            const coverEmpId=assignCoverForRow(slotId,0,emp,date);
            ns[slotId]={rows:[{employeeId:emp.id,shiftId:sh?.id||"",selectedHours:sh?.hours||defaultHours(emp),coverEmployeeId:coverEmpId}]};
          }
        });
      });
    });
    setSchedule(ns);
    Object.entries(ns).forEach(([sid,e])=>syncCell(sid,e));
  }

  // ─ Vakantie Modal vacCells ──────────────────────────────────────────────────
  function vacCells():(Date|null)[]{
    const dates=datesInMonth(vacModalMonth,vacModalYear);
    const off=()=>{const fd=new Date(vacModalYear,vacModalMonth,1).getDay();return fd===0?6:fd-1;};
    const cells:(Date|null)[]=Array(off()).fill(null).concat(dates);
    while(cells.length%7!==0)cells.push(null);
    return cells;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // UNIFORME "TOEVOEGEN" MODALS
  // ══════════════════════════════════════════════════════════════════════════

  // Generieke AddModal component — altijd buiten render, geen re-render issues
  const AddDeptModal = React.memo(function AddDeptModal() {
    const [name,setName]=useState("");
    async function save(){
      if (!name.trim()) return;
      const nd:Department={id:genId("d"),name:name.trim()};
      const {error}=await sb.from("departments").insert({id:nd.id,name:nd.name});
      if (!error){setDeptsRaw(p=>[...p,nd]);if (!activeDeptId)setActiveDeptId(nd.id);}
      setAddModal({type:null});
    }
    return (
      <Modal title="➕ Nieuwe Afdeling" onClose={()=>setAddModal({type:null})}>
        <ModalField label="NAAM AFDELING">
          <input autoFocus value={name} onChange={e=>setName(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&save()} placeholder="Bijv. Zorg, Keuken..." style={inputSt}/>
        </ModalField>
        <div style={{display:"flex",gap:8,marginTop:16}}>
          <button onClick={()=>setAddModal({type:null})} style={{flex:1,padding:10,background:"#1e293b",border:"none",color:"white",borderRadius:8,cursor:"pointer"}}>Annuleer</button>
          <button onClick={save} style={{flex:2,padding:10,background:"#3B82F6",border:"none",color:"white",borderRadius:8,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><Check size={14}/>Opslaan</button>
        </div>
      </Modal>
    );
  });

  const AddSkillModal = React.memo(function AddSkillModal({editing}:{editing?:Skill}) {
    const [name,setName]=useState(editing?.name||"");
    const [criteria,setCriteria]=useState(editing?.criteria||"");
    async function save(){
      if (!name.trim()) return;
      if (editing){
        const upd={...editing,name:name.trim(),criteria};
        setSkillsRaw(p=>p.map(s=>s.id===editing.id?upd:s));
        syncSkill(upd);
      } else {
        const ns:Skill={id:genId("s"),name:name.trim(),criteria};
        const {error}=await sb.from("skills").insert({id:ns.id,name:ns.name,criteria:ns.criteria});
        if (!error) setSkillsRaw(p=>[...p,ns]);
      }
      setAddModal({type:null});
    }
    return (
      <Modal title={editing?"✏️ Skill Bewerken":"➕ Nieuwe Skill"} onClose={()=>setAddModal({type:null})}>
        <ModalField label="NAAM SKILL">
          <input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="Bijv. BHV, HACCP..." style={inputSt}/>
        </ModalField>
        <ModalField label="CRITERIA (vereisten voor 100%)">
          <textarea value={criteria} onChange={e=>setCriteria(e.target.value)}
            rows={3} placeholder="Beschrijf wanneer iemand 100% scoort..."
            style={{...inputSt,resize:"vertical"}}/>
        </ModalField>
        <div style={{display:"flex",gap:8,marginTop:8}}>
          <button onClick={()=>setAddModal({type:null})} style={{flex:1,padding:10,background:"#1e293b",border:"none",color:"white",borderRadius:8,cursor:"pointer"}}>Annuleer</button>
          <button onClick={save} style={{flex:2,padding:10,background:"#8B5CF6",border:"none",color:"white",borderRadius:8,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><Check size={14}/>Opslaan</button>
        </div>
      </Modal>
    );
  });

  const AddClientModal = React.memo(function AddClientModal() {
    const [name,setName]=useState("");
    const [fteNeeded,setFteNeeded]=useState(1);
    async function save(){
      if (!name.trim()) return;
      const nc:Client={id:genId("c"),name:name.trim(),departmentId:activeDeptId,fteNeeded,useFTE:true};
      const {error}=await sb.from("clients").insert({id:nc.id,name:nc.name,department_id:nc.departmentId,fte_needed:nc.fteNeeded,use_fte:true});
      if (!error) setClientsRaw(p=>[...p,nc]);
      setAddModal({type:null});
    }
    return (
      <Modal title="➕ Nieuwe Klant" onClose={()=>setAddModal({type:null})}>
        <ModalField label="NAAM KLANT">
          <input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="Bijv. Locatie Noord..." style={inputSt}/>
        </ModalField>
        <ModalField label="FTE DOEL">
          <input type="number" step="0.5" min="0.5" value={fteNeeded}
            onChange={e=>setFteNeeded(parseFloat(e.target.value)||1)} style={{...inputSt,width:120}}/>
        </ModalField>
        <ModalField label="AFDELING">
          <select value={activeDeptId} style={selectSt} disabled>
            {depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </ModalField>
        <div style={{display:"flex",gap:8,marginTop:8}}>
          <button onClick={()=>setAddModal({type:null})} style={{flex:1,padding:10,background:"#1e293b",border:"none",color:"white",borderRadius:8,cursor:"pointer"}}>Annuleer</button>
          <button onClick={save} style={{flex:2,padding:10,background:"#10B981",border:"none",color:"white",borderRadius:8,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><Check size={14}/>Opslaan</button>
        </div>
      </Modal>
    );
  });

  const AddSubcatModal = React.memo(function AddSubcatModal({clientId,editing}:{clientId:string;editing?:Subcategory}) {
    const client=clients.find(c=>c.id===clientId);
    const [name,setName]=useState(editing?.name||"");
    const [targetSkills,setTargetSkills]=useState<string[]>(editing?.targetSkills||[]);
    const [breakCover,setBreakCover]=useState(editing?.requireBreakCover||false);
    async function save(){
      if (!name.trim()) return;
      if (editing){
        const upd={...editing,name:name.trim(),targetSkills,requireBreakCover:breakCover};
        setSubcatsRaw(p=>p.map(s=>s.id===editing.id?upd:s));
        syncSubcat(upd);
      } else {
        const ns:Subcategory={id:genId("sub"),clientId,name:name.trim(),targetSkills,requireBreakCover:breakCover};
        const {error}=await sb.from("subcategories").insert({id:ns.id,client_id:ns.clientId,name:ns.name,target_skills:ns.targetSkills,require_break_cover:ns.requireBreakCover});
        if (!error) setSubcatsRaw(p=>[...p,ns]);
      }
      setAddModal({type:null});
    }
    function toggleSkill(sid:string){
      setTargetSkills(prev=>prev.includes(sid)?prev.filter(x=>x!==sid):[...prev,sid]);
    }
    return (
      <Modal title={editing?"✏️ Subcategorie Bewerken":"➕ Nieuwe Subcategorie"} onClose={()=>setAddModal({type:null})}>
        <div style={{fontSize:11,color:"#64748B",marginBottom:12}}>Klant: <strong style={{color:"#38BDF8"}}>{client?.name}</strong></div>
        <ModalField label="NAAM SUBCATEGORIE">
          <input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="Bijv. Receptie, Keuken..." style={inputSt}/>
        </ModalField>
        <ModalField label="VEREISTE SKILLS">
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {skills.map(s=>{
              const has=targetSkills.includes(s.id);
              return <button key={s.id} onClick={()=>toggleSkill(s.id)}
                style={{padding:"4px 10px",borderRadius:12,border:has?"1px solid #8B5CF6":"1px solid #334155",
                  background:has?"#8B5CF6":"transparent",color:has?"white":"#475569",cursor:"pointer",fontSize:11}}>
                {has?"✓ ":""}{s.name}</button>;
            })}
            {!skills.length&&<span style={{fontSize:11,color:"#334155"}}>Maak eerst skills aan</span>}
          </div>
        </ModalField>
        <ModalField label="PAUZE COVER VEREIST">
          <div style={{display:"flex",alignItems:"center",gap:10,background:"#1e293b",
            borderRadius:8,padding:"10px 14px"}}>
            <button onClick={()=>setBreakCover(v=>!v)} style={{background:"none",border:"none",cursor:"pointer",padding:0}}>
              {breakCover?<ToggleRight size={24} color="#F59E0B"/>:<ToggleLeft size={24} color="#475569"/>}
            </button>
            <span style={{fontSize:12,color:breakCover?"#F59E0B":"#94A3B8"}}>
              {breakCover?"Pauzes moeten gedekt worden":"Geen pauze-vervanging vereist"}
            </span>
          </div>
        </ModalField>
        <div style={{display:"flex",gap:8,marginTop:8}}>
          <button onClick={()=>setAddModal({type:null})} style={{flex:1,padding:10,background:"#1e293b",border:"none",color:"white",borderRadius:8,cursor:"pointer"}}>Annuleer</button>
          <button onClick={save} style={{flex:2,padding:10,background:"#10B981",border:"none",color:"white",borderRadius:8,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><Check size={14}/>Opslaan</button>
        </div>
      </Modal>
    );
  });

  const AddShiftModal = React.memo(function AddShiftModal() {
    const [label,setLabel]=useState("");
    const [hours,setHours]=useState<number[]>([]);
    async function save(){
      if (!label.trim()) return;
      const ns:ShiftDef={id:genId("sh"),label:label.trim(),hours};
      const {error}=await sb.from("shift_defs").insert({id:ns.id,label:ns.label,hours:ns.hours});
      if (!error) setShiftsRaw(p=>[...p,ns]);
      setAddModal({type:null});
    }
    function toggle(h:number){setHours(prev=>prev.includes(h)?prev.filter(x=>x!==h):[...prev,h].sort((a,b)=>a-b));}
    return (
      <Modal title="➕ Nieuwe Shift" onClose={()=>setAddModal({type:null})}>
        <ModalField label="NAAM SHIFT">
          <input autoFocus value={label} onChange={e=>setLabel(e.target.value)} placeholder="Bijv. 07–15, Avond..." style={inputSt}/>
        </ModalField>
        <ModalField label="UREN (klik om te selecteren)">
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {WORK_HOURS.map(h=>{
              const on=hours.includes(h);
              return <button key={h} onClick={()=>toggle(h)}
                style={{padding:"5px 8px",borderRadius:4,border:"none",fontSize:11,
                  cursor:"pointer",background:on?"#F59E0B":"#334155",
                  color:on?"black":"#475569",fontWeight:on?700:400}}>{h}</button>;
            })}
          </div>
          {hours.length>0&&<div style={{fontSize:11,color:"#64748B",marginTop:8,fontFamily:"monospace"}}>
            {String(Math.min(...hours)).padStart(2,"0")}:00 – {String(Math.max(...hours)+1).padStart(2,"0")}:00 · {hours.length}u → {nettoUren(hours)}u netto
          </div>}
        </ModalField>
        <div style={{display:"flex",gap:8,marginTop:8}}>
          <button onClick={()=>setAddModal({type:null})} style={{flex:1,padding:10,background:"#1e293b",border:"none",color:"white",borderRadius:8,cursor:"pointer"}}>Annuleer</button>
          <button onClick={save} style={{flex:2,padding:10,background:"#F59E0B",border:"none",color:"black",borderRadius:8,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><Check size={14}/>Opslaan</button>
        </div>
      </Modal>
    );
  });

  const AddEmployeeModal = React.memo(function AddEmployeeModal() {
    const [name,setName]=useState("");
    const [deptId,setDeptId]=useState(activeDeptId);
    const [hoursPerWeek,setHoursPerWeek]=useState(40);
    const [color,setColor]=useState(COLORS[employees.length%COLORS.length]);
    const defaultBreaks=BREAK_PRESETS[1].breaks.map(b=>({...b,id:genId("br")})); // 60 min standaard

    async function save(){
      if (!name.trim()) return;
      const newEmp:Employee={
        id:genId("e"),name:name.trim(),departmentId:deptId,
        hoursPerWeek,mainClientId:"",subCatIds:[],subCatSkills:{},
        standardOffDays:["Zaterdag","Zondag"],vacationDates:[],
        defaultShiftId:"",hourlyWage:0,isAdmin:false,
        color,breaks:defaultBreaks,
      };
      const {data,error}=await sb.from("employees").insert({
        id:newEmp.id,name:newEmp.name,department_id:newEmp.departmentId,
        hours_per_week:newEmp.hoursPerWeek,main_client_id:null,
        sub_cat_ids:[],sub_cat_skills:{},
        standard_off_days:newEmp.standardOffDays,vacation_dates:[],
        default_shift_id:null,hourly_wage:0,is_admin:false,
        color:newEmp.color,breaks:newEmp.breaks,pause_config:newEmp.breaks,
      }).select();
      if (!error) setEmployees(p=>[...p,newEmp]);
      setAddModal({type:null});
    }
    return (
      <Modal title="➕ Nieuwe Medewerker" onClose={()=>setAddModal({type:null})}>
        <ModalField label="NAAM">
          <input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="Voor- en achternaam" style={inputSt}/>
        </ModalField>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <ModalField label="AFDELING">
            <select value={deptId} onChange={e=>setDeptId(e.target.value)} style={selectSt}>
              {depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </ModalField>
          <ModalField label="UREN PER WEEK">
            <input type="number" min={1} max={80} value={hoursPerWeek}
              onChange={e=>setHoursPerWeek(+e.target.value)} style={{...inputSt}}/>
          </ModalField>
        </div>
        <ModalField label="KLEUR">
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <ColorPicker value={color} onChange={setColor}/>
            <span style={{fontSize:11,color:"#64748B"}}>Klik om kleur te kiezen</span>
          </div>
        </ModalField>
        <div style={{background:"#1e293b",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:11,color:"#64748B"}}>
          <span style={{color:"#F59E0B"}}>☕ Standaard pauze: 60 min (12:00–13:00)</span> — aanpasbaar na aanmaken
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setAddModal({type:null})} style={{flex:1,padding:10,background:"#1e293b",border:"none",color:"white",borderRadius:8,cursor:"pointer"}}>Annuleer</button>
          <button onClick={save} style={{flex:2,padding:10,background:"#3B82F6",border:"none",color:"white",borderRadius:8,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><Check size={14}/>Aanmaken</button>
        </div>
      </Modal>
    );
  });

  // ─ Render active add-modal ─────────────────────────────────────────────────
  function renderAddModal() {
    if (!addModal.type) return null;
    if (addModal.type==="dept")    return <AddDeptModal/>;
    if (addModal.type==="skill")   return <AddSkillModal/>;
    if (addModal.type==="editSkill") return <AddSkillModal editing={addModal.data}/>;
    if (addModal.type==="client")  return <AddClientModal/>;
    if (addModal.type==="subcat")  return <AddSubcatModal clientId={addModal.data?.clientId} editing={addModal.data?.editing}/>;
    if (addModal.type==="editSubcat") return <AddSubcatModal clientId={addModal.data?.clientId} editing={addModal.data?.editing}/>;
    if (addModal.type==="shift")   return <AddShiftModal/>;
    if (addModal.type==="employee") return <AddEmployeeModal/>;
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PLANNING CEL
  // ══════════════════════════════════════════════════════════════════════════
  const PlanningCell=useMemo(()=>React.memo(function PlanningCell(
    {slotId,date,avail}:{slotId:string;date:Date;avail:Employee[]}
  ){
    const entry=schedule[slotId]||{rows:[]};
    const emp_list=employees;
    const sub=subcats.find(s=>slotId.includes(s.id));

    function availForRow(ri:number):Employee[]{
      const used=entry.rows.filter((_,i)=>i!==ri).map(r=>r.employeeId).filter(Boolean);
      return avail.filter(e=>!used.includes(e.id));
    }
    function isOverLimit(emp:Employee):boolean{return geplandUrenWeek(emp.id,date)>=emp.hoursPerWeek;}
    function addRow(){
      if (entry.rows.length>=3) return;
      const used=entry.rows.map(r=>r.employeeId);
      const next=avail.find(e=>!used.includes(e.id));
      const sh=(next?.defaultShiftId?getShift(next.defaultShiftId):undefined)||shiftDefs[1]||shiftDefs[0];
      updSchedule(slotId,{rows:[...entry.rows,{employeeId:next?.id||"",shiftId:sh?.id||"",selectedHours:next?(sh?.hours||defaultHours(next)):[]}]});
    }
    function removeRow(i:number){updSchedule(slotId,{rows:entry.rows.filter((_,ri)=>ri!==i)});}
    function setEmp(i:number,empId:string){
      const emp=emp_list.find(e=>e.id===empId);
      const sh=(emp?.defaultShiftId?getShift(emp.defaultShiftId):undefined)||shiftDefs[1]||shiftDefs[0];
      const rows=[...entry.rows];
      const coverEmpId=emp?assignCoverForRow(slotId,i,emp,date):undefined;
      rows[i]={employeeId:empId,shiftId:sh?.id||"",selectedHours:emp?(sh?.hours||defaultHours(emp)):[],coverEmployeeId:coverEmpId};
      updSchedule(slotId,{rows});
    }
    function applyShift(i:number,shiftId:string){
      if (shiftId==="custom"){setCustomShiftSlot({slotId,rowIdx:i});return;}
      const sh=getShift(shiftId);
      const rows=[...entry.rows];
      rows[i]={...rows[i],shiftId,selectedHours:sh?sh.hours:rows[i].selectedHours};
      updSchedule(slotId,{rows});
    }
    function toggleHour(i:number,h:number){
      const rows=[...entry.rows];const hrs=rows[i].selectedHours;
      rows[i]={...rows[i],shiftId:"custom",selectedHours:hrs.includes(h)?hrs.filter(x=>x!==h):[...hrs,h].sort((a,b)=>a-b)};
      updSchedule(slotId,{rows});
    }
    function setCover(rowIdx:number,coverId:string){
      const rows=[...entry.rows];
      rows[rowIdx]={...rows[rowIdx],coverEmployeeId:coverId||undefined};
      updSchedule(slotId,{rows});
    }

    return (
      <td style={{padding:3,verticalAlign:"top",minWidth:180,borderBottom:"1px solid #1e293b"}}>
        {entry.rows.map((row,ri)=>{
          const emp=emp_list.find(e=>e.id===row.employeeId);
          const empColor=emp?.color||(ri===0?"#3B82F6":"#7C3AED");
          const textCol=emp?contrastColor(empColor):"white";
          const over=emp?isOverLimit(emp):false;
          const netto=emp?nettoUrenEmp(emp,row.selectedHours):nettoUren(row.selectedHours);
          const breakMins=emp?calcBreakMins(emp.breaks,row.selectedHours):(row.selectedHours?.length>=9?60:0);
          const coverEmp=row.coverEmployeeId?emp_list.find(e=>e.id===row.coverEmployeeId):null;
          return (
            <div key={ri} style={{marginBottom:ri<entry.rows.length-1?4:0,
              borderBottom:ri<entry.rows.length-1?"1px dashed #1e293b":"none",
              paddingBottom:ri<entry.rows.length-1?4:0}}>
              <div style={{display:"flex",gap:2,marginBottom:2}}>
                <select value={row.employeeId} onChange={e=>setEmp(ri,e.target.value)}
                  style={{flex:1,padding:"4px 3px",borderRadius:4,
                    background:row.employeeId?empColor:"#0f172a",
                    color:row.employeeId?textCol:"white",
                    border:over?"2px solid #EF4444":"1px solid #1e293b",
                    fontSize:11,cursor:"pointer",fontWeight:row.employeeId?700:400}}>
                  <option value="">—</option>
                  {availForRow(ri).map(e=>{
                    const ol=isOverLimit(e);
                    return <option key={e.id} value={e.id}
                      style={{color:ol?"#EF4444":"white",background:"#1e293b"}}>
                      {e.name}{ol?" ⚠":""}</option>;
                  })}
                </select>
                <button onClick={()=>removeRow(ri)} style={{background:"#1e293b",border:"none",
                  color:"#475569",borderRadius:3,width:18,cursor:"pointer",fontSize:10}}>✕</button>
              </div>
              {over&&row.employeeId&&(
                <div style={{fontSize:9,color:"#EF4444",marginBottom:2,
                  display:"flex",alignItems:"center",gap:3}}>
                  <AlertTriangle size={9}/> Weekuren overschreden
                </div>
              )}
              {row.employeeId&&(
                <div style={{display:"flex",gap:2,marginBottom:2}}>
                  {shiftDefs.map(sh=>(
                    <button key={sh.id} onClick={()=>applyShift(ri,sh.id)}
                      style={{flex:1,padding:"2px 0",fontSize:8,border:"none",
                        borderRadius:3,cursor:"pointer",
                        background:row.shiftId===sh.id?"#F59E0B":"#1e293b",
                        color:row.shiftId===sh.id?"#000":"#64748B",
                        fontWeight:row.shiftId===sh.id?"bold":"normal"}}>
                      {sh.label}
                    </button>
                  ))}
                  <button onClick={()=>applyShift(ri,"custom")}
                    style={{flex:1,padding:"2px 0",fontSize:8,border:"none",
                      borderRadius:3,cursor:"pointer",
                      background:row.shiftId==="custom"?"#F59E0B":"#1e293b",
                      color:row.shiftId==="custom"?"#000":"#64748B"}}>✏️</button>
                </div>
              )}
              {/* Uurblokjes */}
              <div style={{display:"flex",gap:1,opacity:row.employeeId?1:0.25}}>
                {WORK_HOURS.map(h=>{
                  const on=row.selectedHours?.includes(h);
                  const brk=emp?isBreakHour(emp,h):false;
                  return (
                    <div key={h} onClick={()=>row.employeeId&&toggleHour(ri,h)}
                      title={`${String(h).padStart(2,"0")}:00${brk?" ☕ pauze":""}`}
                      style={{flex:1,height:11,borderRadius:1,cursor:row.employeeId?"pointer":"default",
                        background:on?(brk?`repeating-linear-gradient(45deg,${empColor} 0,${empColor} 2px,#0f172a 2px,#0f172a 4px)`:empColor):"#1e293b"}}/>
                  );
                })}
              </div>
              {row.employeeId&&(
                <div style={{fontSize:9,color:"#475569",marginTop:2,
                  display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:2}}>
                  <span>{shiftTimeStr(row.selectedHours)} · {netto.toFixed(1)}u</span>
                  {breakMins>0&&<span style={{color:"#F59E0B"}}>☕ {breakMins}min</span>}
                </div>
              )}
              {/* Pauze cover weergave */}
              {emp&&breakMins>0&&sub?.requireBreakCover&&(
                <div style={{background:"rgba(245,158,11,.1)",border:"1px solid rgba(245,158,11,.2)",
                  borderRadius:4,padding:"3px 5px",marginTop:3}}>
                  <div style={{fontSize:8,color:"#F59E0B",fontWeight:700,marginBottom:2}}>
                    ☕ PAUZE COVER VEREIST
                  </div>
                  <select value={row.coverEmployeeId||""}
                    onChange={e=>setCover(ri,e.target.value)}
                    style={{width:"100%",background:"#1e293b",color:coverEmp?"#10B981":"#F59E0B",
                      border:"1px solid #F59E0B",borderRadius:3,padding:"2px 4px",fontSize:9}}>
                    <option value="">— Vervanger toewijzen —</option>
                    {avail.filter(e=>e.id!==row.employeeId).map(e=>(
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                  {coverEmp&&(
                    <div style={{fontSize:9,color:"#10B981",marginTop:2}}>
                      ✓ Vervanging door: <strong>{coverEmp.name}</strong>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {entry.rows.length<3&&(
          <button onClick={addRow} style={{width:"100%",marginTop:3,padding:2,
            background:"none",border:"1px dashed #1e293b",color:"#475569",
            borderRadius:3,fontSize:9,cursor:"pointer"}}>
            + persoon
          </button>
        )}
      </td>
    );
  }),[schedule,employees,shiftDefs]);

  // ─ Vakantie Modal ──────────────────────────────────────────────────────────
  const VacationModal=React.memo(function VacationModal(){
    const emp=employees.find(e=>e.id===vacModalEmpId);
    if (!emp) return null;
    const cells=vacCells();
    function toggleOff(day:string){
      const has=emp.standardOffDays.includes(day);
      updEmployee({...emp,standardOffDays:has?emp.standardOffDays.filter(d=>d!==day):[...emp.standardOffDays,day]});
    }
    function toggleVac(ds:string){
      const has=emp.vacationDates.includes(ds);
      updEmployee({...emp,vacationDates:has?emp.vacationDates.filter(d=>d!==ds):[...emp.vacationDates,ds]});
    }
    return (
      <Modal title={`🌴 Vakantie & Vrije Dagen — ${emp.name}`} onClose={()=>setVacModalEmpId(null)} width="560px">
        <div style={{marginBottom:16,background:"#1e293b",borderRadius:10,padding:14}}>
          <div style={{fontSize:11,color:"#F59E0B",fontWeight:"bold",marginBottom:8}}>VASTE VRIJE DAGEN (WEKELIJKS)</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {DAY_LABELS.map(day=>{
              const isOff=emp.standardOffDays.includes(day);
              return <button key={day} onClick={()=>toggleOff(day)}
                style={{padding:"5px 12px",borderRadius:20,border:"none",fontSize:12,cursor:"pointer",
                  background:isOff?"#EF4444":"#334155",color:isOff?"white":"#94A3B8",fontWeight:isOff?"bold":"normal"}}>
                {day.slice(0,2)}</button>;
            })}
          </div>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <button onClick={()=>{if(vacModalMonth===0){setVacModalMonth(11);setVacModalYear(y=>y-1);}else setVacModalMonth(m=>m-1);}}
            style={{background:"#1e293b",border:"none",color:"white",borderRadius:6,padding:"5px 14px",cursor:"pointer"}}>‹</button>
          <span style={{fontWeight:"bold",color:"white"}}>{MONTH_LABELS[vacModalMonth]} {vacModalYear}</span>
          <button onClick={()=>{if(vacModalMonth===11){setVacModalMonth(0);setVacModalYear(y=>y+1);}else setVacModalMonth(m=>m+1);}}
            style={{background:"#1e293b",border:"none",color:"white",borderRadius:6,padding:"5px 14px",cursor:"pointer"}}>›</button>
        </div>
        <div style={{background:"#1e293b",borderRadius:10,padding:12}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:6}}>
            {["Ma","Di","Wo","Do","Vr","Za","Zo"].map(d=><div key={d} style={{textAlign:"center",fontSize:10,color:"#64748B",fontWeight:"bold",padding:"4px 0"}}>{d}</div>)}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
            {cells.map((date,i)=>{
              if (!date) return <div key={i}/>;
              const ds=fmtDate(date);const dl=dayLabel(date);
              const isStd=emp.standardOffDays.includes(dl);
              const isVac=emp.vacationDates.includes(ds);
              let bg="#1e293b",col="#94A3B8",lbl="";
              if (isStd){bg="#7C3AED22";col="#7C3AED";lbl="V";}
              if (isVac){bg="#F59E0B";col="white";lbl="🌴";}
              return <div key={ds} onClick={()=>!isStd&&toggleVac(ds)}
                style={{textAlign:"center",padding:"6px 2px",borderRadius:6,fontSize:12,
                  cursor:isStd?"not-allowed":"pointer",background:bg,color:col,
                  fontWeight:isVac?"bold":"normal",userSelect:"none"}}>
                <div>{date.getDate()}</div>
                {lbl&&<div style={{fontSize:9}}>{lbl}</div>}
              </div>;
            })}
          </div>
        </div>
        <div style={{display:"flex",gap:16,marginTop:12,fontSize:10,color:"#64748B"}}>
          <span><span style={{color:"#7C3AED"}}>■</span> Vaste vrije dag</span>
          <span><span style={{color:"#F59E0B"}}>■</span> Vakantie</span>
          <span style={{marginLeft:"auto"}}>Totaal: <strong style={{color:"white"}}>{emp.vacationDates.length} dagen</strong></span>
        </div>
      </Modal>
    );
  });

  // ─ Custom Shift Modal ──────────────────────────────────────────────────────
  const CustomShiftModal=React.memo(function CustomShiftModal(){
    if (!customShiftSlot) return null;
    const {slotId,rowIdx}=customShiftSlot;
    function apply(){
      const hours:number[]=[];
      for (let h=customStart;h<customEnd;h++) if (WORK_HOURS.includes(h)) hours.push(h);
      const entry=schedule[slotId]||{rows:[]};
      const rows=[...entry.rows];
      if (rows[rowIdx]) rows[rowIdx]={...rows[rowIdx],shiftId:"custom",selectedHours:hours};
      updSchedule(slotId,{rows});setCustomShiftSlot(null);
    }
    const bruto=customEnd-customStart;
    const netto=bruto>=9?bruto-1:bruto;
    return (
      <Modal title="✏️ Custom Shift" onClose={()=>setCustomShiftSlot(null)} width="300px">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
          <ModalField label="BEGINTIJD">
            <select value={customStart} onChange={e=>setCustomStart(+e.target.value)} style={selectSt}>
              {WORK_HOURS.map(h=><option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}
            </select>
          </ModalField>
          <ModalField label="EINDTIJD">
            <select value={customEnd} onChange={e=>setCustomEnd(+e.target.value)} style={selectSt}>
              {WORK_HOURS.filter(h=>h>customStart).map(h=><option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}
            </select>
          </ModalField>
        </div>
        <div style={{background:"#1e293b",borderRadius:6,padding:10,marginBottom:16,fontSize:11,color:"#64748B",fontFamily:"monospace"}}>
          {bruto>=9?<>{bruto}u − 1u pauze = <span style={{color:"#10B981"}}>{netto}u netto</span></>:<span style={{color:"#10B981"}}>{netto}u</span>}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setCustomShiftSlot(null)} style={{flex:1,padding:9,background:"#1e293b",border:"none",color:"white",borderRadius:8,cursor:"pointer"}}>Annuleer</button>
          <button onClick={apply} style={{flex:1,padding:9,background:"#F59E0B",border:"none",color:"black",borderRadius:8,cursor:"pointer",fontWeight:"bold"}}>✓ Toepassen</button>
        </div>
      </Modal>
    );
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TAB: PLANNING
  // ══════════════════════════════════════════════════════════════════════════
  function TabPlanning(){
    const dates=displayDates();
    return (
      <div style={{borderRadius:12,overflowX:"auto",padding:16}}>
        {/* Navigatie */}
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:14}}>
          <button onClick={prevPeriod} style={{background:"#1e293b",border:"none",color:"white",borderRadius:8,padding:"7px 12px",cursor:"pointer",display:"flex",alignItems:"center"}}><ChevronLeft size={16}/></button>
          <div style={{fontWeight:700,color:"white",minWidth:200,textAlign:"center",fontSize:14}}>
            {viewType==="week"
              ?`Week ${weekNum(weekStart)} · ${weekStart.toLocaleDateString("nl-NL",{day:"numeric",month:"short"})} – ${new Date(weekStart.getTime()+6*86400000).toLocaleDateString("nl-NL",{day:"numeric",month:"short",year:"numeric"})}`
              :`${MONTH_LABELS[viewMonth]} ${viewYear}`}
          </div>
          <button onClick={nextPeriod} style={{background:"#1e293b",border:"none",color:"white",borderRadius:8,padding:"7px 12px",cursor:"pointer",display:"flex",alignItems:"center"}}><ChevronRight size={16}/></button>

          {viewType==="week"&&(
            <select value={weekNum(weekStart)} onChange={e=>goToWeek(+e.target.value)}
              style={{background:"#1e293b",color:"white",padding:"7px 10px",borderRadius:8,border:"none",fontSize:12}}>
              {Array.from({length:53},(_,i)=>i+1).map(wn=>(
                <option key={wn} value={wn}>Week {wn}</option>
              ))}
            </select>
          )}
          {viewType==="maand"&&(
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
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
            {deptEmployees.slice(0,10).map(e=>(
              <span key={e.id} style={{display:"flex",alignItems:"center",gap:3}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:e.color,display:"inline-block"}}/>
                <span style={{fontSize:9,color:"#475569"}}>{e.name.split(" ")[0]}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Onderbezetting waarschuwing */}
        {useFTE&&deptClients.some(c=>c.useFTE&&fteForClient(c.id)<c.fteNeeded)&&(
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

        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr>
              <th style={{textAlign:"left",padding:"8px 10px",color:"#475569",minWidth:180,
                position:"sticky",left:0,background:"#020617",zIndex:2,
                fontSize:11,fontWeight:700,letterSpacing:"0.06em"}}>KLANT / TAAK</th>
              {dates.map(date=>{
                const dl=dayLabel(date);const we=isWeekend(date);
                return (
                  <th key={fmtDate(date)} style={{padding:"6px 3px",fontSize:10,minWidth:180,color:we?"#EF4444":"#64748B"}}>
                    <div style={{fontSize:8,color:"#334155"}}>Wk {weekNum(date)}</div>
                    <div style={{fontWeight:700}}>{dl.slice(0,2)} {date.getDate()}</div>
                    <div style={{fontSize:8}}>{MONTH_LABELS[date.getMonth()].slice(0,3)}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {deptClients.length===0&&(
              <tr><td colSpan={dates.length+1} style={{padding:40,textAlign:"center",color:"#334155"}}>
                Geen klanten. Voeg ze toe via Klanten & Shifts.
              </td></tr>
            )}
            {deptClients.map(client=>{
              const csubs=subcats.filter(s=>s.clientId===client.id);
              const fte=fteForClient(client.id);
              const fteDiff=fte-client.fteNeeded;
              return (
                <React.Fragment key={client.id}>
                  <tr style={{background:"#0f172a"}}>
                    <td colSpan={dates.length+1} style={{padding:"8px 14px",color:"#38BDF8",fontWeight:700,borderTop:"1px solid #1e293b"}}>
                      <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                        <span style={{fontSize:14}}>{client.name}</span>
                        <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"#475569"}}>
                          <span>FTE</span>
                          <button onClick={()=>{const upd={...client,useFTE:!client.useFTE};setClientsRaw(p=>p.map(c=>c.id===client.id?upd:c));syncClient(upd);}}
                            style={{background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center"}}>
                            {client.useFTE?<ToggleRight size={18} color="#10B981"/>:<ToggleLeft size={18} color="#334155"/>}
                          </button>
                        </div>
                        {client.useFTE&&(
                          <div style={{display:"flex",alignItems:"center",gap:8,fontSize:11}}>
                            <span style={{color:"#475569"}}>Doel:
                              <input type="number" step="0.5" min="0.5" value={client.fteNeeded}
                                onChange={e=>{const upd={...client,fteNeeded:parseFloat(e.target.value)||0};setClientsRaw(p=>p.map(c=>c.id===client.id?upd:c));syncClient(upd);}}
                                style={{width:45,background:"#1e293b",color:"white",border:"1px solid #334155",borderRadius:4,padding:"1px 4px",marginLeft:4}}/>
                              <span style={{marginLeft:3}}>FTE</span>
                            </span>
                            <span style={{color:"#64748B"}}>Ingepland: <strong style={{color:"white"}}>{fte.toFixed(2)}</strong></span>
                            <span style={{padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:700,
                              background:fteDiff>=0?"rgba(16,185,129,.15)":"rgba(239,68,68,.15)",
                              color:fteDiff>=0?"#10B981":"#EF4444"}}>
                              {fteDiff>=0?"+":""}{fteDiff.toFixed(2)} FTE
                            </span>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                  {(csubs.length?csubs:[{id:`client-${client.id}`,clientId:client.id,name:"Algemeen",targetSkills:[],requireBreakCover:false}]).map(sub=>(
                    <tr key={sub.id}>
                      <td style={{padding:"8px 12px 8px 26px",fontSize:12,color:"#64748B",
                        position:"sticky",left:0,background:"#020617",
                        verticalAlign:"top",borderBottom:"1px solid #0a0f1a"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                          <span>↳ {sub.name}</span>
                          {(sub as Subcategory).requireBreakCover&&(
                            <span style={{fontSize:9,background:"rgba(245,158,11,.15)",
                              color:"#F59E0B",padding:"1px 5px",borderRadius:8,
                              border:"1px solid rgba(245,158,11,.3)"}}>☕ cover</span>
                          )}
                        </div>
                        {(sub as any).targetSkills?.length>0&&(
                          <div style={{fontSize:9,color:"#334155",marginTop:2}}>
                            {(sub as any).targetSkills.map((sid:string)=>skills.find(s=>s.id===sid)?.name).filter(Boolean).join(", ")}
                          </div>
                        )}
                      </td>
                      {dates.map(date=>{
                        const slotId=`${fmtDate(date)}-${sub.id}`;
                        const avail=deptEmployees.filter(e=>isAvail(e,date)&&((sub as any).targetSkills?.length===0||e.subCatIds.includes(sub.id)));
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

  // ══════════════════════════════════════════════════════════════════════════
  // TAB: MEDEWERKERS
  // ══════════════════════════════════════════════════════════════════════════
  function TabMedewerkers(){
    return (
      <div style={{background:"#0f172a",borderRadius:12,padding:20,border:"1px solid #1e293b"}}>
        {breakModalEmpId&&(
          <BreakModal empId={breakModalEmpId} employees={employees}
            onSave={updEmployee} onClose={()=>setBreakModalEmpId(null)}/>
        )}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <h3 style={{margin:0,color:"white",fontWeight:700}}>Medewerkers — {activeDept?.name}</h3>
          <button onClick={()=>setAddModal({type:"employee"})}
            style={{background:"#3B82F6",border:"none",color:"white",padding:"8px 16px",borderRadius:8,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",gap:6}}>
            <Plus size={14}/> Toevoegen
          </button>
        </div>
        {deptEmployees.length===0&&<div style={{color:"#334155",textAlign:"center",padding:40}}>Geen medewerkers. Klik op + Toevoegen.</div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(380px,1fr))",gap:20}}>
          {deptEmployees.map(emp=>{
            const gepland=geplandUrenWeek(emp.id,weekStart);
            const pct=Math.min(100,Math.round(gepland/emp.hoursPerWeek*100));
            const over=gepland>emp.hoursPerWeek;
            const totalBreakMins=emp.breaks.reduce((s,b)=>s+((b.endHour*60+b.endMin)-(b.startHour*60+b.startMin)),0);
            return (
              <div key={emp.id} style={{background:"#1e293b",borderRadius:12,padding:18,border:"1px solid #334155",borderTop:`3px solid ${emp.color}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,flex:1}}>
                    <ColorPicker value={emp.color} onChange={c=>updEmployee({...emp,color:c})}/>
                    <input value={emp.name} onChange={e=>updEmployee({...emp,name:e.target.value})}
                      style={{background:"none",border:"none",color:"white",fontSize:16,fontWeight:700,flex:1,outline:"none"}}/>
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <button onClick={()=>{setVacModalMonth(viewMonth);setVacModalYear(viewYear);setVacModalEmpId(emp.id);}}
                      style={{background:"#F59E0B",color:"white",border:"none",padding:"5px 10px",borderRadius:6,fontSize:11,cursor:"pointer"}}>🌴</button>
                    <button onClick={async()=>{if(window.confirm("Medewerker verwijderen?"))await delEmployee(emp.id);}}
                      style={{background:"none",border:"none",color:"#EF4444",cursor:"pointer"}}><Trash2 size={16}/></button>
                  </div>
                </div>

                {/* Urenbalk */}
                <div style={{background:"#0f172a",borderRadius:6,padding:8,marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:4}}>
                    <span style={{color:"#64748B"}}>Ingepland deze week</span>
                    <span style={{color:over?"#EF4444":"#10B981",fontWeight:700}}>{gepland.toFixed(1)}u / {emp.hoursPerWeek}u</span>
                  </div>
                  <div style={{height:4,background:"#334155",borderRadius:2,overflow:"hidden"}}>
                    <div style={{width:`${pct}%`,height:"100%",background:over?"#EF4444":emp.color,transition:"width .3s"}}/>
                  </div>
                </div>

                {/* Velden */}
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

                {/* Pauze */}
                <div style={{background:"#0f172a",borderRadius:8,padding:10,marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <Coffee size={12} color="#F59E0B"/>
                      <span style={{fontSize:9,color:"#F59E0B",fontWeight:700,letterSpacing:"0.06em"}}>PAUZE</span>
                    </div>
                    <button onClick={()=>setBreakModalEmpId(emp.id)}
                      style={{background:"#F59E0B",border:"none",color:"black",padding:"3px 10px",borderRadius:4,fontSize:9,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",gap:3}}>
                      <Edit2 size={9}/> Bewerken
                    </button>
                  </div>
                  {emp.breaks.length===0
                    ?<div style={{fontSize:10,color:"#334155",marginTop:6}}>Geen pauzes. Standaard: 60 min bij ≥9u.</div>
                    :<div style={{marginTop:6,display:"flex",flexWrap:"wrap",gap:4}}>
                      {emp.breaks.map(b=>(
                        <span key={b.id} style={{background:"rgba(245,158,11,.12)",color:"#F59E0B",
                          border:"1px solid rgba(245,158,11,.2)",borderRadius:10,padding:"2px 8px",fontSize:10}}>
                          {fmtTime(b.startHour,b.startMin)}–{fmtTime(b.endHour,b.endMin)}
                        </span>
                      ))}
                      <span style={{fontSize:10,color:"#64748B",marginLeft:4}}>= {totalBreakMins}min</span>
                    </div>
                  }
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
                            const sk=skills.find(s=>s.id===skillId);if (!sk) return null;
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
  function TabBeheer(){
    return (
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))",gap:20}}>
        {/* Afdelingen */}
        <section style={{background:"#0f172a",borderRadius:12,padding:20,border:"1px solid #1e293b"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><Building2 size={15} color="#3B82F6"/><h3 style={{margin:0,color:"white",fontSize:14,fontWeight:700}}>Afdelingen</h3></div>
            <button onClick={()=>setAddModal({type:"dept"})} style={{background:"#3B82F6",border:"none",color:"white",padding:"5px 10px",borderRadius:6,cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",gap:4}}><Plus size={11}/>Nieuw</button>
          </div>
          {depts.length===0&&<div style={{color:"#334155",fontSize:12,textAlign:"center",padding:20}}>Geen afdelingen.</div>}
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

        {/* Klanten & Subcategorieën */}
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
                      <label style={{fontSize:9,color:"#64748B",display:"block",marginBottom:3,fontWeight:700,letterSpacing:"0.06em"}}>FTE DOEL</label>
                      <input type="number" step="0.5" min="0.5" value={client.fteNeeded}
                        onChange={e=>{const upd={...client,fteNeeded:parseFloat(e.target.value)||0};setClientsRaw(p=>p.map(c=>c.id===client.id?upd:c));syncClient(upd);}}
                        style={{width:70,background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:4,padding:"4px 6px"}}/>
                    </div>
                    <div>
                      <label style={{fontSize:9,color:"#64748B",display:"block",marginBottom:3,fontWeight:700,letterSpacing:"0.06em"}}>FTE AAN</label>
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
                          {sub.requireBreakCover&&<span style={{fontSize:9,color:"#F59E0B",border:"1px solid rgba(245,158,11,.3)",borderRadius:8,padding:"1px 5px"}}>☕ cover</span>}
                        </div>
                        <div style={{display:"flex",gap:4}}>
                          <button onClick={()=>setAddModal({type:"editSubcat",data:{clientId:client.id,editing:sub}})}
                            style={{background:"#1e293b",border:"1px solid #334155",color:"#64748B",borderRadius:4,padding:"2px 6px",cursor:"pointer",fontSize:9}}><Edit2 size={9}/></button>
                          <button onClick={async()=>await delSubcat(sub.id)} style={{background:"none",border:"none",color:"#EF4444",cursor:"pointer",fontSize:11}}>✕</button>
                        </div>
                      </div>
                      {sub.targetSkills.length>0&&(
                        <div style={{fontSize:9,color:"#475569"}}>
                          Skills: {sub.targetSkills.map(sid=>skills.find(s=>s.id===sid)?.name).filter(Boolean).join(", ")}
                        </div>
                      )}
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
  function TabFinancieel(){
    const [filterDeptId,setFilterDeptId]=useState("all");
    const [filterClientId,setFilterClientId]=useState("all");
    const allDates=displayDates();

    const kostenPerKlant:Record<string,any>={};
    const kostenPerDept:Record<string,any>={};
    depts.forEach(d=>{kostenPerDept[d.id]={naam:d.name,kosten:0,uren:0};});

    clients.forEach(client=>{
      const csubs=subcats.filter(s=>s.clientId===client.id);
      kostenPerKlant[client.id]={naam:client.name,kosten:0,uren:0,deptId:client.departmentId,subcats:{}};
      (csubs.length?csubs:[{id:`client-${client.id}`,clientId:client.id,name:"Algemeen",targetSkills:[],requireBreakCover:false}]).forEach(sub=>{
        kostenPerKlant[client.id].subcats[sub.id]={naam:sub.name,kosten:0,uren:0,details:[]};
        allDates.forEach(date=>{
          const entry=schedule[`${fmtDate(date)}-${sub.id}`];
          if (!entry?.rows) return;
          entry.rows.forEach(row=>{
            const emp=employees.find(e=>e.id===row.employeeId);
            if (!emp||!emp.hourlyWage) return;
            const netto=nettoUrenEmp(emp,row.selectedHours);
            const kosten=netto*emp.hourlyWage;
            kostenPerKlant[client.id].kosten+=kosten;kostenPerKlant[client.id].uren+=netto;
            kostenPerKlant[client.id].subcats[sub.id].kosten+=kosten;
            kostenPerKlant[client.id].subcats[sub.id].uren+=netto;
            kostenPerKlant[client.id].subcats[sub.id].details.push({empNaam:emp.name,empColor:emp.color,netto,loon:emp.hourlyWage,kosten});
            if (kostenPerDept[client.departmentId]){kostenPerDept[client.departmentId].kosten+=kosten;kostenPerDept[client.departmentId].uren+=netto;}
          });
        });
      });
    });

    const fc=Object.entries(kostenPerKlant).filter(([cid,c]:any)=>{
      if (filterDeptId!=="all"&&c.deptId!==filterDeptId) return false;
      if (filterClientId!=="all"&&cid!==filterClientId) return false;
      return true;
    });
    const totalKosten=fc.reduce((a,[,c]:any)=>a+c.kosten,0);
    const totalUren=fc.reduce((a,[,c]:any)=>a+c.uren,0);
    const wf=viewType==="week"?1:allDates.length/7;
    const maandSchat=(totalKosten/wf)*(52/12);
    const jaarSchat=(totalKosten/wf)*52;

    return (
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))",gap:20}}>
        {/* Filters */}
        <div style={{gridColumn:"1/-1",background:"#0f172a",borderRadius:12,padding:16,border:"1px solid #1e293b",display:"flex",gap:16,flexWrap:"wrap",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <Building2 size={14} color="#64748B"/>
            <span style={{fontSize:11,color:"#64748B",fontWeight:700}}>AFDELING:</span>
            <select value={filterDeptId} onChange={e=>{setFilterDeptId(e.target.value);setFilterClientId("all");}}
              style={{background:"#1e293b",color:"white",border:"1px solid #334155",borderRadius:6,padding:"5px 10px",fontSize:12}}>
              <option value="all">Alle</option>
              {depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <Users size={14} color="#64748B"/>
            <span style={{fontSize:11,color:"#64748B",fontWeight:700}}>KLANT:</span>
            <select value={filterClientId} onChange={e=>setFilterClientId(e.target.value)}
              style={{background:"#1e293b",color:"white",border:"1px solid #334155",borderRadius:6,padding:"5px 10px",fontSize:12}}>
              <option value="all">Alle</option>
              {clients.filter(c=>filterDeptId==="all"||c.departmentId===filterDeptId).map(c=>(
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* KPI */}
        <div style={{gridColumn:"1/-1",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:14}}>
          {[
            {label:"Loonkosten periode",value:fmtEuro(totalKosten),sub:`${totalUren.toFixed(1)} uur`,icon:<Euro size={18}/>,color:"#3B82F6"},
            {label:"Schatting per maand",value:fmtEuro(maandSchat),sub:"Geëxtrapoleerd",icon:<TrendingUp size={18}/>,color:"#10B981"},
            {label:"Schatting per jaar",value:fmtEuro(jaarSchat),sub:"Geëxtrapoleerd",icon:<PieChart size={18}/>,color:"#8B5CF6"},
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
            <h3 style={{margin:0,color:"white",fontSize:14,fontWeight:700}}>Uurlonen beheren</h3>
          </div>
          {employees.map(emp=>(
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
                  style={{width:70,background:"#0f172a",color:"white",border:"1px solid #334155",borderRadius:6,padding:"5px 8px",textAlign:"right",fontSize:13,fontWeight:600}}/>
                <span style={{color:"#64748B",fontSize:11}}>/uur</span>
              </div>
            </div>
          ))}
        </section>

        {/* Kosten per klant */}
        <section style={{background:"#0f172a",borderRadius:14,padding:22,border:"1px solid #1e293b",gridColumn:"span 2"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:18}}>
            <Building2 size={17} color="#38BDF8"/>
            <h3 style={{margin:0,color:"white",fontSize:14,fontWeight:700}}>Kosten per klant</h3>
          </div>
          {fc.map(([clientId,clientData]:any)=>(
            <div key={clientId} style={{marginBottom:20,background:"#1e293b",borderRadius:10,overflow:"hidden"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 16px",background:"#172033"}}>
                <span style={{fontWeight:700,color:"#38BDF8",fontSize:14}}>{clientData.naam}</span>
                <div style={{textAlign:"right"}}>
                  <div style={{fontWeight:700,color:"white"}}>{fmtEuro(clientData.kosten)}</div>
                  <div style={{fontSize:10,color:"#64748B"}}>{clientData.uren.toFixed(1)} uur</div>
                </div>
              </div>
              {Object.entries(clientData.subcats).map(([subId,subData]:any)=>(
                <div key={subId}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 16px 10px 28px",borderBottom:"1px solid #0f172a"}}>
                    <span style={{color:"#94A3B8",fontSize:13}}>↳ {subData.naam}</span>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{textAlign:"right"}}>
                        <div style={{color:"#94A3B8",fontSize:13,fontWeight:600}}>{fmtEuro(subData.kosten)}</div>
                        <div style={{fontSize:9,color:"#475569"}}>{subData.uren.toFixed(1)} uur</div>
                      </div>
                      <button onClick={()=>setShowCalcFor(p=>p===subId?null:subId)}
                        style={{background:"#0f172a",border:"1px solid #334155",color:"#64748B",borderRadius:5,padding:"3px 8px",fontSize:10,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
                        {showCalcFor===subId?<EyeOff size={11}/>:<Eye size={11}/>} Detail
                      </button>
                    </div>
                  </div>
                  {showCalcFor===subId&&subData.details.length>0&&(
                    <div style={{padding:"12px 28px",background:"rgba(0,0,0,.2)"}}>
                      {subData.details.map((d:any,i:number)=>(
                        <div key={i} style={{fontSize:11,color:"#64748B",marginBottom:5,fontFamily:"monospace",display:"flex",alignItems:"center",gap:8}}>
                          <span style={{width:8,height:8,borderRadius:"50%",background:d.empColor,display:"inline-block",flexShrink:0}}/>
                          <span style={{color:"#94A3B8"}}>{d.empNaam}</span>:
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
          {fc.length===0&&<div style={{color:"#334155",textAlign:"center",padding:40}}>Geen data voor deze filter.</div>}
        </section>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TAB: ADMIN
  // ══════════════════════════════════════════════════════════════════════════
  const AdminPanel=React.memo(function AdminPanel(){
    const [naam,setNaam]=useState("");
    const [email,setEmail]=useState("");
    const [password,setPassword]=useState("");
    const [isAdminNew,setIsAdminNew]=useState(false);
    const [loading,setLoading]=useState(false);
    const [status,setStatus]=useState<{type:"ok"|"err";msg:string}|null>(null);
    const [allUsers,setAllUsers]=useState<any[]>([]);

    useEffect(()=>{
      sb.from("employees").select("id,name,email,is_admin,department_id,color").then(({data})=>{if(data)setAllUsers(data);});
    },[]);

    async function addUser(){
      if (!naam.trim()||!email.trim()||!password.trim()){setStatus({type:"err",msg:"Vul alle velden in."});return;}
      setLoading(true);setStatus(null);
      try {
        const {data:sd,error:se}=await sb.auth.signUp({email,password});
        if (se) throw se;
        const uid=sd.user?.id;if (!uid) throw new Error("Geen user-ID van Supabase Auth.");
        const col=COLORS[employees.length%COLORS.length];
        const defaultBreaks=BREAK_PRESETS[1].breaks.map(b=>({...b,id:genId("br")}));
        const {data,error}=await sb.from("employees").insert({
          id:uid,name:naam,email,is_admin:isAdminNew,department_id:activeDeptId,
          hours_per_week:40,main_client_id:null,sub_cat_ids:[],sub_cat_skills:{},
          standard_off_days:["Zaterdag","Zondag"],vacation_dates:[],
          default_shift_id:null,hourly_wage:0,color:col,
          breaks:defaultBreaks,pause_config:defaultBreaks,
        }).select();
        if (error) throw error;
        if (data){
          setAllUsers(p=>[...p,data[0]]);
          setEmployees(p=>[...p,{id:uid,name:naam,departmentId:activeDeptId,hoursPerWeek:40,mainClientId:"",subCatIds:[],subCatSkills:{},standardOffDays:["Zaterdag","Zondag"],vacationDates:[],defaultShiftId:"",hourlyWage:0,isAdmin:isAdminNew,color:col,breaks:defaultBreaks}]);
        }
        setStatus({type:"ok",msg:`✅ ${naam} aangemaakt. Verificatiemail verstuurd naar ${email}.`});
        setNaam("");setEmail("");setPassword("");
      } catch(e:any){setStatus({type:"err",msg:"Fout: "+(e.message||"Onbekend")});}
      setLoading(false);
    }
    async function toggleAdmin(uid:string,cur:boolean){
      const {error}=await sb.from("employees").update({is_admin:!cur}).eq("id",uid);
      if (!error){setAllUsers(p=>p.map(u=>u.id===uid?{...u,is_admin:!cur}:u));setEmployees(p=>p.map(e=>e.id===uid?{...e,isAdmin:!cur}:e));}
    }
    async function removeUser(uid:string){
      if (!window.confirm("Verwijderen?")) return;
      const {error}=await sb.from("employees").delete().eq("id",uid);
      if (!error){setAllUsers(p=>p.filter(u=>u.id!==uid));setEmployees(p=>p.filter(e=>e.id!==uid));}
    }

    return (
      <div style={{display:"grid",gap:20,maxWidth:700}}>
        <div style={{background:"#0f172a",borderRadius:16,padding:28,border:"1px solid #1e293b"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:24}}>
            <Shield size={20} color="#8B5CF6"/>
            <h3 style={{margin:0,color:"white",fontSize:16,fontWeight:700}}>Nieuwe gebruiker aanmaken</h3>
          </div>
          <ModalField label="NAAM"><input type="text" value={naam} onChange={e=>setNaam(e.target.value)} placeholder="Jan de Vries" style={inputSt}/></ModalField>
          <ModalField label="E-MAILADRES"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="jan@bedrijf.nl" style={inputSt}/></ModalField>
          <ModalField label="TIJDELIJK WACHTWOORD"><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" style={inputSt}/></ModalField>
          <div style={{display:"flex",alignItems:"center",gap:10,background:"#1e293b",borderRadius:8,padding:"12px 14px",marginBottom:14}}>
            <button onClick={()=>setIsAdminNew(v=>!v)} style={{background:"none",border:"none",cursor:"pointer",padding:0}}>
              {isAdminNew?<ToggleRight size={28} color="#8B5CF6"/>:<ToggleLeft size={28} color="#475569"/>}
            </button>
            <div>
              <div style={{fontSize:13,color:isAdminNew?"#C4B5FD":"#94A3B8",fontWeight:600}}>{isAdminNew?"Beheerder":"Medewerker"}</div>
              <div style={{fontSize:11,color:"#475569"}}>{isAdminNew?"Financieel & gebruikersbeheer":"Alleen planning"}</div>
            </div>
          </div>
          {status&&<div style={{background:status.type==="ok"?"rgba(16,185,129,.1)":"rgba(239,68,68,.1)",border:`1px solid ${status.type==="ok"?"rgba(16,185,129,.3)":"rgba(239,68,68,.3)"}`,color:status.type==="ok"?"#6EE7B7":"#FCA5A5",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:13}}>{status.msg}</div>}
          <button onClick={addUser} disabled={loading}
            style={{width:"100%",padding:11,background:"#8B5CF6",border:"none",color:"white",borderRadius:8,fontWeight:700,cursor:loading?"wait":"pointer",opacity:loading?.7:1}}>
            {loading?"Aanmaken...":"➕ Gebruiker aanmaken"}
          </button>
        </div>
        <div style={{background:"#0f172a",borderRadius:16,padding:28,border:"1px solid #1e293b"}}>
          <h3 style={{margin:"0 0 18px 0",color:"white",fontSize:15,fontWeight:700}}>Alle gebruikers ({allUsers.length})</h3>
          {allUsers.map(u=>(
            <div key={u.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#1e293b",borderRadius:8,padding:"12px 14px",marginBottom:8,borderLeft:`3px solid ${u.color||"#3B82F6"}`}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:10,height:10,borderRadius:"50%",background:u.color||"#3B82F6"}}/>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:"white"}}>{u.name}</div>
                  <div style={{fontSize:10,color:"#64748B",marginTop:2}}>{u.email||"Geen e-mail"}</div>
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <button onClick={()=>toggleAdmin(u.id,u.is_admin)}
                  style={{background:u.is_admin?"rgba(139,92,246,.15)":"#0f172a",border:`1px solid ${u.is_admin?"#8B5CF6":"#334155"}`,color:u.is_admin?"#8B5CF6":"#475569",borderRadius:6,padding:"4px 10px",fontSize:11,cursor:"pointer",fontWeight:600}}>
                  {u.is_admin?"⭐ Admin":"👤 Mw."}
                </button>
                {u.id!==currentUserId&&(
                  <button onClick={()=>removeUser(u.id)} style={{background:"none",border:"none",color:"#EF4444",cursor:"pointer"}}><Trash2 size={14}/></button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  const tabs=[
    {id:"planning",label:"Planning",icon:<Calendar size={14}/>},
    {id:"medewerkers",label:"Medewerkers",icon:<Users size={14}/>},
    {id:"beheer",label:"Klanten & Shifts",icon:<Settings size={14}/>},
    ...(isAdmin?[
      {id:"financieel",label:"Financieel",icon:<Euro size={14}/>},
      {id:"admin",label:"Gebruikers",icon:<Shield size={14}/>},
    ]:[]),
  ];

  if (loading) return (
    <div style={{minHeight:"100vh",background:"#020617",display:"flex",alignItems:"center",justifyContent:"center",color:"#475569",fontFamily:"'Segoe UI',system-ui,sans-serif",flexDirection:"column",gap:12}}>
      <div style={{width:40,height:40,border:"3px solid #1e293b",borderTop:"3px solid #3B82F6",borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
      <span>Data laden uit database...</span>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#020617",color:"#F8FAFC",fontFamily:"'Segoe UI',system-ui,sans-serif",padding:16}}>

      {/* Active Modals */}
      {renderAddModal()}
      {vacModalEmpId   && <VacationModal/>}
      {customShiftSlot && <CustomShiftModal/>}
      {showPDFModal    && (
        <PDFPreviewModal
          data={{
            deptName: activeDept?.name||"",
            weekLabel: viewType==="week"
              ?`Week ${weekNum(weekStart)} · ${weekStart.toLocaleDateString("nl-NL",{day:"numeric",month:"short"})} – ${new Date(weekStart.getTime()+6*86400000).toLocaleDateString("nl-NL",{day:"numeric",month:"short",year:"numeric"})}`
              :`${MONTH_LABELS[viewMonth]} ${viewYear}`,
            dates: displayDates(),
            employees, clients: deptClients, subcats, schedule, skills,
          }}
          onClose={()=>setShowPDFModal(false)}
        />
      )}

      {/* Nav */}
      <nav style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18,borderBottom:"1px solid #0f172a",paddingBottom:14,flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          {depts.length===0
            ?<div style={{color:"#475569",fontSize:12,padding:8}}>Geen afdelingen — voeg toe via Klanten & Shifts</div>
            :<select value={activeDeptId} onChange={e=>setActiveDeptId(e.target.value)}
              style={{background:"#3B82F6",color:"white",padding:"8px 12px",borderRadius:8,border:"none",fontWeight:700,cursor:"pointer"}}>
              {depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          }
          {tabs.map(tab=>(
            <button key={tab.id} onClick={()=>setActiveTab(tab.id as any)}
              style={{background:activeTab===tab.id?"#0f172a":"transparent",color:activeTab===tab.id?"white":"#64748B",border:activeTab===tab.id?"1px solid #1e293b":"1px solid transparent",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontWeight:activeTab===tab.id?700:400,fontSize:13,display:"flex",alignItems:"center",gap:6}}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,background:"#0f172a",padding:"6px 12px",borderRadius:8,border:"1px solid #1e293b"}}>
            <span style={{fontSize:11,color:"#64748B"}}>FTE</span>
            <button onClick={()=>setUseFTE(v=>!v)} style={{background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center"}}>
              {useFTE?<ToggleRight size={22} color="#10B981"/>:<ToggleLeft size={22} color="#334155"/>}
            </button>
          </div>
          <div style={{display:"flex",gap:0}}>
            <button onClick={()=>runAutoPlanner(true)} style={{background:"#10B981",color:"white",border:"none",padding:"8px 12px",borderRadius:"8px 0 0 8px",cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",gap:4,fontSize:12}}>
              <Zap size={13}/>Auto
            </button>
            <button onClick={()=>runAutoPlanner(false)} title="Behoud handmatig" style={{background:"#059669",color:"white",border:"none",padding:"8px 10px",borderRadius:"0 8px 8px 0",cursor:"pointer",fontWeight:700,fontSize:11}}>
              +
            </button>
          </div>
          <button onClick={()=>{if(window.confirm("Planning leegmaken?")){setSchedule({});sb.from("schedule").delete().neq("slot_id","__never__");}}}
            style={{background:"rgba(239,68,68,.1)",color:"#EF4444",border:"1px solid rgba(239,68,68,.2)",padding:"8px 12px",borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",gap:6,fontSize:12}}>
            <Trash2 size={13}/>Leeg
          </button>
          <button onClick={()=>setShowPDFModal(true)}
            style={{background:"#8B5CF6",color:"white",border:"none",padding:"8px 12px",borderRadius:8,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",gap:6,fontSize:12}}>
            <FileText size={13}/>PDF
          </button>
          <button onClick={()=>sb.auth.signOut()} style={{background:"transparent",color:"#475569",border:"1px solid #1e293b",padding:"8px 12px",borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",gap:6,fontSize:12}}>
            <LogOut size={13}/>Uit
          </button>
        </div>
      </nav>

      <main>
        {activeTab==="planning"    && <TabPlanning/>}
        {activeTab==="medewerkers" && <TabMedewerkers/>}
        {activeTab==="beheer"      && <TabBeheer/>}
        {activeTab==="financieel"  && isAdmin&&<TabFinancieel/>}
        {activeTab==="admin"       && isAdmin&&<AdminPanel/>}
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

// ─── Root ──────────────────────────────────────────────────────────────────────
export default function AppRoot() {
  const [session,setSession]=useState<Session|null>(null);
  const [authChecked,setAuthChecked]=useState(false);
  useEffect(()=>{
    sb.auth.getSession().then(({data})=>{setSession(data.session);setAuthChecked(true);});
    const {data:l}=sb.auth.onAuthStateChange((_,s)=>setSession(s));
    return ()=>l.subscription.unsubscribe();
  },[]);
  if (!authChecked) return (
    <div style={{minHeight:"100vh",background:"#020617",display:"flex",alignItems:"center",justifyContent:"center",color:"#334155",fontFamily:"'Segoe UI',system-ui,sans-serif",fontSize:14}}>
      ⏳ Laden...
    </div>
  );
  if (!session) return <LoginScreen/>;
  return <App session={session}/>;
}
