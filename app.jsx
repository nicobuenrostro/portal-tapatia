import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  initializeApp
} from "firebase/app";
import {
  getFirestore, collection, getDocs, doc, setDoc,
  deleteDoc, writeBatch, getDoc
} from "firebase/firestore";
import jsPDF from "jspdf";
import "jspdf-autotable";

// ── Firebase config ───────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDb5e9x1c73eFxOp4hd2BjEsqmYL2_JTvY",
  authDomain: "portal-tapatia.firebaseapp.com",
  projectId: "portal-tapatia",
  storageBucket: "portal-tapatia.firebasestorage.app",
  messagingSenderId: "252152037275",
  appId: "1:252152037275:web:99356044c89eff2203ab3e"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// ── Brand ─────────────────────────────────────────────────────
const OR  = "#FF6B06";
const GRL = "#6b6b6b";
const DK  = "#f4f4f4";
const CD  = "#ffffff";
const BD  = "#e0e0e0";
const ALMS   = ["gdl1","gdl3","ags","col","len","cul"];
const ALMS_L = ["GDL1","GDL3","AGS","COL","LEN","CUL"];

// ── Helpers ───────────────────────────────────────────────────
const money   = n => (!n||isNaN(n)||Number(n)===0)?"—":new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN",minimumFractionDigits:2}).format(n);
const calcTotal= p => ALMS.reduce((t,a)=>t+(Number(p[a])||0),0);
const stockVis = t => t>=30?"+30":t;
const nColor   = t => t===0?"#dc2626":t<=5?"#ea580c":t<=20?"#d97706":"#16a34a";
const nLabel   = t => t===0?"Sin stock":t<=5?"Bajo":t<=20?"Medio":"Alto";
const almPpal  = p => { const i=ALMS.findIndex(a=>(Number(p[a])||0)>0); return i>=0?ALMS_L[i]:"—"; };
const almsDisp = p => ALMS.map((a,i)=>(Number(p[a])||0)>0?ALMS_L[i]:null).filter(Boolean).join(", ")||"—";
const getPrecio= (p,l) => l==="PUBLICO"||l==="PÚBLICO"?Number(p.publico)||0:l==="DISTRIBUIDOR"?Number(p.distribuidor)||0:l==="ASOCIADO"?Number(p.asociado)||0:0;

// ── Hash SHA-256 ──────────────────────────────────────────────
async function hashPassword(pwd){
  const enc=new TextEncoder().encode(pwd);
  const buf=await crypto.subtle.digest("SHA-256",enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function checkPassword(pwd,hash){ return await hashPassword(pwd)===hash; }

// ── Firebase — lectura segura ─────────────────────────────────
async function fbGetUsuarios(){
  try {
    const snap=await getDocs(collection(db,"usuarios"));
    if(snap.empty) return [];
    const data=snap.docs.map(d=>({id:d.id,...d.data()}));
    return data.sort((a,b)=>(a.nombre||"").localeCompare(b.nombre||""));
  } catch(e){
    console.error("Error leyendo usuarios:",e);
    return null;
  }
}

async function fbGetProductos(){
  try {
    const snap=await getDocs(collection(db,"productos"));
    if(snap.empty) return [];
    const data=snap.docs.map(d=>({id:d.id,...d.data()}));
    return data.sort((a,b)=>(a.codigo||"").localeCompare(b.codigo||""));
  } catch(e){
    console.error("Error leyendo productos:",e);
    return null;
  }
}

// ── Búsqueda inteligente ──────────────────────────────────────
function cIn(s){return String(s).toUpperCase().trim().replace(/\s+/g," ");}
function strp(s){return String(s).toUpperCase().replace(/[^0-9XR\.]/g,"");}
function getVariants(s){
  if(!s)return[];
  const c=String(s).toUpperCase().trim(),b=strp(c);
  const vars=[c,b,c.replace(/[\.\-\/\s]/g,""),c.replace(/[\.\-\/\sX]/g,"").replace("R","")];
  const nums=c.replace(/[XR]/g," ").replace(/[\.\-\/]/g," ").replace(/\s+/g," ").trim().split(" ").filter(x=>x.length>0);
  if(nums.length===3){vars.push(nums.join(""),nums[0]+"."+nums[1]+"-"+nums[2],nums[0]+nums[1]+"-"+nums[2],nums[0]+"."+nums[1]+"R"+nums[2],nums[0]+"-"+nums[1]+"-"+nums[2],nums[0]+" "+nums[1]+" "+nums[2]);}
  if(nums.length===2){vars.push(nums.join(""),nums[0]+"."+nums[1],nums[0]+"-"+nums[1]);}
  if(/^\d{5,6}$/.test(b)){
    [[2,1,2],[2,2,2],[3,2,2],[2,2,3]].forEach(([a,bv,cv])=>{
      if(b.length===a+bv+cv){
        const p1=b.slice(0,a),p2=b.slice(a,a+bv),p3=b.slice(a+bv);
        vars.push(p1+"."+p2+"-"+p3,p1+p2+"-"+p3,p1+"."+p2+"R"+p3,p1+" "+p2+" "+p3,p1+p2+p3);
      }
    });
  }
  const seen={};return vars.filter(v=>{const t=String(v).trim();return t&&!seen[t]&&(seen[t]=true);});
}
function exMedidas(desc){
  if(!desc)return[];
  const s=String(desc).toUpperCase(),found=[];
  [/\d{3}\/\d{2}[R]\d{2,3}(?:\.\d)?/g,/\d{2,3}[X]\d{2,3}(?:\.\d{2})?[-R]\d{2,3}/g,
   /\d{1,3}\.\d{2,3}[-\/R]\d{2,3}/g,/\d{2}\.?\d{1,2}[-\/R]\d{2,3}/g,/\d{2,3}\s\d{1,3}\s\d{2,3}/g]
    .forEach(p=>(s.match(p)||[]).forEach(m=>found.push(m)));
  found.push(s);return found;
}
function smartMatch(q,p){
  if(!q||q.trim().length<2)return true;
  const desc=String(p.descripcion||"").toUpperCase(),cod=String(p.codigo||"").toUpperCase();
  const qc=cIn(q),qs=strp(qc);
  if(desc.includes(qc)||cod.includes(qc))return true;
  if(qs.length>=3&&(strp(desc).includes(qs)||strp(cod).includes(qs)))return true;
  const qV=getVariants(qc),pVA=[];
  exMedidas(desc).forEach(m=>getVariants(m).forEach(v=>pVA.push(v)));
  return qV.some(qv=>qv&&qv.length>=2&&pVA.some(pv=>pv&&pv.length>=2&&(qv===pv||(qs.length>=3&&strp(pv).includes(qs)))));
}
function detectTipo(s){
  const u=cIn(s);
  if(/\d{3}\/\d{2}R\d/.test(u))return"Radial métrica";
  if(/\d+X[\d\.]+R\d/.test(u))return"Flotación radial";
  if(/\d+X[\d\.]+[-]\d/.test(u))return"Flotación";
  if(/\d+[\.\-]\d+[-\/R]\d/.test(u))return"Convencional";
  if(/^\d{4,8}$/.test(strp(u)))return"Numérica";
  return"";
}

// ── Permisos por rol ──────────────────────────────────────────
function canDo(session, accion){
  const rol = session?.rol;
  if(rol==="superadmin") return true;
  if(rol==="admin"){
    const permitido=["productos","clientes","subir_csv","crear_cliente","editar_cliente","toggle_estatus","eliminar_cliente"];
    return permitido.includes(accion);
  }
  return false;
}
function parseCsv(text){
  const lines=text.trim().split("\n"),first=lines[0];
  const delim=first.includes("\t")?"\t":first.includes(";")?";":","
  const headers=first.split(delim).map(h=>h.trim().replace(/"/g,""));
  return lines.slice(1).map(line=>{
    const vals=line.split(delim),obj={};
    headers.forEach((h,i)=>{const v=(vals[i]||"").trim().replace(/"/g,"");obj[h]=(!isNaN(v)&&v!=="")?parseFloat(v):v;});
    return obj;
  }).filter(r=>r.CODIGO||r["CÓDIGO"]);
}

// ── UI Components ─────────────────────────────────────────────
function Badge({val}){
  const map={
    PUBLICO:{bg:"#dcfce7",c:"#16a34a"},PÚBLICO:{bg:"#dcfce7",c:"#16a34a"},
    DISTRIBUIDOR:{bg:"#dbeafe",c:"#2563eb"},ASOCIADO:{bg:"#fff7ed",c:"#ea580c"},
    VENDEDOR:{bg:"#f3e8ff",c:"#9333ea"},
    superadmin:{bg:"#fef3c7",c:"#d97706"},
    admin:{bg:"#dbeafe",c:"#2563eb"},
    client:{bg:"#f3f4f6",c:"#6b7280"},
    activo:{bg:"#dcfce7",c:"#16a34a"},
    inactivo:{bg:"#fee2e2",c:"#dc2626"}
  };
  const s=map[val]||{bg:"#f3f4f6",c:GRL};
  return <span style={{background:s.bg,color:s.c,padding:"2px 8px",borderRadius:3,fontSize:10,fontWeight:700,letterSpacing:1}}>{val}</span>;
}

function Inp({label,value,onChange,type="text",mb=12,placeholder=""}){
  return <div style={{marginBottom:mb}}>
    {label&&<div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>{label}</div>}
    <input type={type} value={value} onChange={onChange} placeholder={placeholder}
      style={{width:"100%",padding:"9px 11px",background:"#f7f7f7",border:"1px solid "+BD,
        color:"#1a1a1a",fontSize:13,borderRadius:4,boxSizing:"border-box",outline:"none"}}/>
  </div>;
}

function Btn({onClick,children,danger,ghost,sm,disabled}){
  const bg=disabled?"#e5e7eb":danger?"#fee2e2":ghost?"transparent":OR;
  const cl=disabled?"#9ca3af":danger?"#dc2626":ghost?GRL:"#fff";
  const br=danger?"1px solid #fca5a5":ghost?"1px solid "+BD:"none";
  return <button onClick={disabled?undefined:onClick} disabled={disabled}
    style={{background:bg,color:cl,border:br,padding:sm?"4px 10px":"9px 16px",
      borderRadius:4,cursor:disabled?"not-allowed":"pointer",fontWeight:700,
      fontSize:sm?10:12,letterSpacing:1,whiteSpace:"nowrap",opacity:disabled?0.6:1}}>
    {children}
  </button>;
}

function Logo({h=36}){
  return <img
    src="https://raw.githubusercontent.com/nicobuenrostro/portal-tapatia/main/logo.png"
    alt="Grupo Tapatía"
    style={{height:h,objectFit:"contain",maxWidth:280}}
  />;
}

// Buscador — fuera de App para no perder foco
function Buscador({search,ds,onChange,count,mob}){
  const tipo=ds.trim().length>=2?detectTipo(ds.trim()):"";
  const norm=ds.trim().length>=2?(getVariants(ds.trim())[0]||""):"";
  return <div style={{marginBottom:14}}>
    <input value={search} onChange={e=>onChange(e.target.value)}
      placeholder={mob?"Buscar medida o código...":"Buscar: código, descripción o medida (ej: 15538, 315/80R22.5, 10.00-20)..."}
      style={{width:"100%",padding:"10px 13px",background:"#f7f7f7",border:"1.5px solid "+OR,
        color:"#1a1a1a",fontSize:13,borderRadius:4,boxSizing:"border-box",outline:"none"}}/>
    {ds.trim().length>=2&&<div style={{display:"flex",gap:8,marginTop:5,flexWrap:"wrap",alignItems:"center"}}>
      {tipo&&<span style={{background:"#fff7ed",color:OR,padding:"2px 8px",borderRadius:3,fontSize:10,fontWeight:700}}>{tipo}</span>}
      {norm&&norm!==ds.trim().toUpperCase()&&<span style={{color:GRL,fontSize:10}}>→ <strong style={{color:"#1a1a1a"}}>{norm}</strong></span>}
      <span style={{color:"#bbb",fontSize:10}}>{count} resultado{count!==1?"s":""}</span>
    </div>}
  </div>;
}

function Pager({total,pg,setPg,ps=50}){
  const pages=Math.max(1,Math.ceil(total/ps));
  return <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:10,flexWrap:"wrap",gap:8}}>
    <span style={{color:GRL,fontSize:11}}>{total} productos · precios antes de IVA</span>
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      <button onClick={()=>{setPg(p=>Math.max(0,p-1));window.scrollTo(0,0);}} disabled={pg===0}
        style={{padding:"6px 12px",background:pg===0?BD:OR,color:pg===0?GRL:"#fff",border:"none",borderRadius:4,cursor:pg===0?"default":"pointer",fontSize:11,fontWeight:700}}>← ANT</button>
      <span style={{color:GRL,fontSize:11}}>{pg+1}/{pages}</span>
      <button onClick={()=>{setPg(p=>Math.min(pages-1,p+1));window.scrollTo(0,0);}} disabled={pg+1>=pages}
        style={{padding:"6px 12px",background:pg+1>=pages?BD:OR,color:pg+1>=pages?GRL:"#fff",border:"none",borderRadius:4,cursor:pg+1>=pages?"default":"pointer",fontSize:11,fontWeight:700}}>SIG →</button>
    </div>
  </div>;
}

// ── Cargar imagen como base64 para PDF ───────────────────────
async function loadImageBase64(url){
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve)=>{
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror  = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch(e){ return null; }
}

// ── Generador de PDF de cotización ───────────────────────────
async function generarPDF({folio, session, items, nota, vigencia, clienteLabel}){
  const doc2  = new jsPDF({orientation:"portrait", unit:"mm", format:"a4"});
  const W     = 210;
  const ML    = 14;   // margen izquierdo
  const MR    = 14;   // margen derecho
  const CW    = W - ML - MR; // ancho útil = 182mm
  const fecha = new Date().toLocaleDateString("es-MX",{day:"2-digit",month:"long",year:"numeric"});

  // ════════════════════════════════════════════════════════════
  // HEADER — fondo naranja
  // ════════════════════════════════════════════════════════════
  const HDR = 38;
  doc2.setFillColor(255, 107, 6);
  doc2.rect(0, 0, W, HDR, "F");

  // Logo
  const logoUrl  = "https://raw.githubusercontent.com/nicobuenrostro/portal-tapatia/main/logo.png";
  const logoData = await loadImageBase64(logoUrl);
  if(logoData){
    try { doc2.addImage(logoData, "PNG", ML, 4, 46, 15); } catch(e){}
  } else {
    doc2.setTextColor(255,255,255); doc2.setFontSize(15); doc2.setFont("helvetica","bold");
    doc2.text("GRUPO TAPATIA", ML, 13);
  }

  // Datos empresa bajo logo
  doc2.setTextColor(255,255,255); doc2.setFont("helvetica","normal"); doc2.setFontSize(6.5);
  doc2.text("Importadores de llantas agricolas, industriales, jardineria y remolques", ML, 23);
  doc2.text("Tlaquepaque, Jalisco, Mexico  |  ventas@llanteratapatia.com  |  www.tapatia.app", ML, 28);

  // Bloque COTIZACION (columna derecha) — sin roundedRect, rect simple
  const BX = W - MR - 50;
  doc2.setFillColor(200, 70, 0);
  doc2.rect(BX, 4, 50, 30, "F");
  doc2.setTextColor(255,255,255);
  doc2.setFont("helvetica","bold"); doc2.setFontSize(12);
  doc2.text("COTIZACION", BX + 25, 14, {align:"center"});
  doc2.setFont("helvetica","normal"); doc2.setFontSize(9);
  doc2.text(folio, BX + 25, 22, {align:"center"});
  doc2.setFontSize(7);
  doc2.text(fecha, BX + 25, 28, {align:"center"});

  // ════════════════════════════════════════════════════════════
  // BLOQUE DATOS DE COTIZACION
  // ════════════════════════════════════════════════════════════
  let y = HDR + 6;
  doc2.setFillColor(248, 248, 248);
  doc2.setDrawColor(220, 220, 220); doc2.setLineWidth(0.2);
  doc2.roundedRect(ML, y, CW, 26, 2, 2, "FD");

  // Título
  doc2.setFont("helvetica","bold"); doc2.setFontSize(7.5); doc2.setTextColor(255,107,6);
  doc2.text("DATOS DE COTIZACION", ML + 4, y + 5);
  doc2.setDrawColor(255,107,6); doc2.setLineWidth(0.3);
  doc2.line(ML + 4, y + 6.5, ML + CW - 4, y + 6.5);

  // Cuadrícula 2 columnas × 3 filas
  const c1 = ML + 4, c2 = ML + 24, c3 = ML + CW/2 + 4, c4 = ML + CW/2 + 22;
  const lh = 5.2;
  let dy = y + 11;

  const field = (label, value, x1, x2, yy) => {
    doc2.setFont("helvetica","bold"); doc2.setFontSize(7); doc2.setTextColor(120,120,120);
    doc2.text(label, x1, yy);
    doc2.setFont("helvetica","normal"); doc2.setTextColor(30,30,30);
    doc2.text(String(value||"—"), x2, yy);
  };

  field("Folio:",    folio,           c1, c2, dy);
  field("Fecha:",    fecha,           c3, c4, dy); dy += lh;
  field("Elaboro:",  session.nombre,  c1, c2, dy);
  field("Vigencia:", vigencia||"15 dias naturales", c3, c4, dy); dy += lh;
  // Cliente — ancho completo
  doc2.setFont("helvetica","bold"); doc2.setFontSize(7); doc2.setTextColor(120,120,120);
  doc2.text("Cliente:", c1, dy);
  doc2.setFont("helvetica","bold"); doc2.setTextColor(30,30,30); doc2.setFontSize(7.5);
  const clienteTxt = doc2.splitTextToSize(clienteLabel||"Publico en general", CW - 25)[0];
  doc2.text(clienteTxt, c2, dy);

  // ════════════════════════════════════════════════════════════
  // TABLA DE PRODUCTOS
  // ════════════════════════════════════════════════════════════
  y = HDR + 6 + 26 + 8;

  // Separar productos con y sin IVA
  const conIva  = items.filter(it => String(it.iva||"NO").toUpperCase()==="SI");
  const sinIva  = items.filter(it => String(it.iva||"NO").toUpperCase()!=="SI");

  const fmt = n => new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(n);

  const tableStyles = {
    styles: {
      font:"helvetica", fontSize:8,
      cellPadding:{top:3.5,bottom:3.5,left:3,right:3},
      overflow:"linebreak", textColor:[40,40,40], lineWidth:0,
    },
    headStyles: {
      fillColor:[255,107,6], textColor:[255,255,255],
      fontStyle:"bold", fontSize:7.5, halign:"center",
      cellPadding:{top:4,bottom:4,left:3,right:3}, lineWidth:0,
    },
    alternateRowStyles:{fillColor:[248,248,248]},
    margin:{left:ML, right:MR},
  };

  const colStyles6 = {
    0:{halign:"center",cellWidth:10},
    1:{halign:"left",  cellWidth:32},
    2:{halign:"left",  cellWidth:"auto"},
    3:{halign:"center",cellWidth:13},
    4:{halign:"right", cellWidth:24},
    5:{halign:"right", cellWidth:24},
  };

  // ── Tabla productos SIN IVA ──────────────────────────────
  if(sinIva.length > 0){
    // Subtítulo
    doc2.setFont("helvetica","bold"); doc2.setFontSize(8); doc2.setTextColor(80,80,80);
    doc2.text("Productos sin IVA", ML, y);
    y += 3;
    const rowsSin = sinIva.map((it,i)=>[
      i+1, it.codigo, it.descripcion, it.cantidad,
      fmt(it.precio),
      fmt(it.precio * it.cantidad),
    ]);
    doc2.autoTable({
      startY: y,
      head:   [["No.","CODIGO","DESCRIPCION","CANT.","P. UNIT.","IMPORTE"]],
      body:   rowsSin,
      columnStyles: colStyles6,
      ...tableStyles,
    });
    y = doc2.lastAutoTable.finalY + 4;
  }

  // ── Tabla productos CON IVA ──────────────────────────────
  if(conIva.length > 0){
    doc2.setFont("helvetica","bold"); doc2.setFontSize(8); doc2.setTextColor(80,80,80);
    doc2.text("Productos con IVA (16%)", ML, y);
    y += 3;
    const rowsCon = conIva.map((it,i)=>{
      const imp    = it.precio * it.cantidad;
      const ivaP   = imp * 0.16;
      const totP   = imp + ivaP;
      return [
        i+1, it.codigo, it.descripcion, it.cantidad,
        fmt(it.precio), fmt(imp), fmt(ivaP), fmt(totP),
      ];
    });
    doc2.autoTable({
      startY: y,
      head:   [["No.","CODIGO","DESCRIPCION","CANT.","P. UNIT.","IMPORTE","IVA 16%","TOTAL"]],
      body:   rowsCon,
      columnStyles: {
        0:{halign:"center",cellWidth:10},
        1:{halign:"left",  cellWidth:28},
        2:{halign:"left",  cellWidth:"auto"},
        3:{halign:"center",cellWidth:11},
        4:{halign:"right", cellWidth:20},
        5:{halign:"right", cellWidth:20},
        6:{halign:"right", cellWidth:18},
        7:{halign:"right", cellWidth:20},
      },
      ...tableStyles,
    });
    y = doc2.lastAutoTable.finalY + 4;
  }

  // ════════════════════════════════════════════════════════════
  // TOTALES — calculados por partida
  // ════════════════════════════════════════════════════════════
  const subtSin  = sinIva.reduce((s,it)=>s + it.precio*it.cantidad, 0);
  const subtCon  = conIva.reduce((s,it)=>s + it.precio*it.cantidad, 0);
  const ivaTotal = conIva.reduce((s,it)=>s + it.precio*it.cantidad*0.16, 0);
  const granTotal= subtSin + subtCon + ivaTotal;

  const hayMixto = sinIva.length > 0 && conIva.length > 0;

  let ty = y + 2;
  const TW = 82;
  const TX = W - MR - TW;

  // Calcular altura del bloque según filas necesarias
  const filas = hayMixto ? 5 : (conIva.length>0 ? 4 : 2);
  const boxH  = 8 + filas * 7 + 10; // padding + filas + barra total

  doc2.setFillColor(248,248,248);
  doc2.setDrawColor(220,220,220); doc2.setLineWidth(0.15);
  doc2.rect(TX, ty, TW, boxH, "FD");

  const tLX = TX + 4;
  const tVX = TX + TW - 4;
  const tLH = 7;
  let   tY  = ty + 7;

  if(hayMixto){
    // Subtotal sin IVA
    doc2.setFont("helvetica","normal"); doc2.setFontSize(7.5); doc2.setTextColor(80,80,80);
    doc2.text("Subtotal sin IVA:", tLX, tY);
    doc2.setTextColor(30,30,30);
    doc2.text(fmt(subtSin), tVX, tY, {align:"right"}); tY += tLH;
    // Subtotal con IVA
    doc2.setFont("helvetica","normal"); doc2.setTextColor(80,80,80);
    doc2.text("Subtotal con IVA:", tLX, tY);
    doc2.setTextColor(30,30,30);
    doc2.text(fmt(subtCon), tVX, tY, {align:"right"}); tY += tLH;
  } else if(sinIva.length > 0){
    doc2.setFont("helvetica","normal"); doc2.setFontSize(7.5); doc2.setTextColor(80,80,80);
    doc2.text("Subtotal:", tLX, tY);
    doc2.setTextColor(30,30,30);
    doc2.text(fmt(subtSin), tVX, tY, {align:"right"}); tY += tLH;
  } else {
    doc2.setFont("helvetica","normal"); doc2.setFontSize(7.5); doc2.setTextColor(80,80,80);
    doc2.text("Subtotal:", tLX, tY);
    doc2.setTextColor(30,30,30);
    doc2.text(fmt(subtCon), tVX, tY, {align:"right"}); tY += tLH;
  }

  // IVA total (solo si hay productos con IVA)
  if(conIva.length > 0){
    doc2.setFont("helvetica","normal"); doc2.setFontSize(7.5); doc2.setTextColor(80,80,80);
    doc2.text("IVA (16%):", tLX, tY);
    doc2.setTextColor(30,30,30);
    doc2.text(fmt(ivaTotal), tVX, tY, {align:"right"}); tY += tLH;
  } else {
    doc2.setFont("helvetica","normal"); doc2.setFontSize(7.5); doc2.setTextColor(80,80,80);
    doc2.text("IVA:", tLX, tY);
    doc2.setFont("helvetica","italic"); doc2.setTextColor(160,160,160);
    doc2.text("$0.00 (productos agricolas no causan IVA)", tVX, tY, {align:"right"}); tY += tLH;
  }

  // Línea divisora
  doc2.setDrawColor(255,107,6); doc2.setLineWidth(0.4);
  doc2.line(TX + 2, tY, TX + TW - 2, tY); tY += 2;

  // Gran total naranja
  doc2.setFillColor(255,107,6);
  doc2.rect(TX, tY, TW, 10, "F");
  doc2.setFont("helvetica","bold"); doc2.setFontSize(11); doc2.setTextColor(255,255,255);
  doc2.text("TOTAL:", tLX + 1, tY + 7);
  doc2.text(fmt(granTotal), tVX - 1, tY + 7, {align:"right"});

  // ════════════════════════════════════════════════════════════
  // OBSERVACIONES
  // ════════════════════════════════════════════════════════════
  if(nota && nota.trim()){
    let ny = ty + 38;
    doc2.setFillColor(255,251,235);
    doc2.setDrawColor(253,211,77); doc2.setLineWidth(0.2);
    const notaLines = doc2.splitTextToSize(nota.trim(), CW - 8);
    const notaH = 8 + notaLines.length * 4.5;
    doc2.roundedRect(ML, ny, CW, notaH, 2, 2, "FD");
    doc2.setFont("helvetica","bold"); doc2.setFontSize(7.5); doc2.setTextColor(180,120,0);
    doc2.text("OBSERVACIONES:", ML + 4, ny + 5);
    doc2.setFont("helvetica","normal"); doc2.setTextColor(60,60,60);
    doc2.text(notaLines, ML + 4, ny + 10);
  }

  // ════════════════════════════════════════════════════════════
  // DATOS BANCARIOS
  // ════════════════════════════════════════════════════════════
  let by2 = doc2.lastAutoTable.finalY + (nota&&nota.trim() ? 48 : 42);
  // Si se sale de la página, nueva página
  if(by2 + 30 > 270){ doc2.addPage(); by2 = 15; }

  // Bloque bancario — ancho completo, 2 columnas
  doc2.setFillColor(235,244,255);
  doc2.setDrawColor(180,210,240); doc2.setLineWidth(0.15);
  doc2.rect(ML, by2, CW, 24, "FD");

  doc2.setFont("helvetica","bold"); doc2.setFontSize(7.5); doc2.setTextColor(0,80,180);
  doc2.text("DATOS PARA DEPOSITO / TRANSFERENCIA", ML + 4, by2 + 5);
  doc2.setDrawColor(180,210,240); doc2.setLineWidth(0.15);
  doc2.line(ML + 3, by2 + 6.5, ML + CW - 3, by2 + 6.5);

  const bC1 = ML + 4, bC2 = ML + 20, bC3 = ML + CW/2 + 4, bC4 = ML + CW/2 + 18;

  // Fila 1: Banco | Titular
  doc2.setFont("helvetica","bold"); doc2.setFontSize(7); doc2.setTextColor(100,100,100);
  doc2.text("Banco:", bC1, by2 + 12);
  doc2.setFont("helvetica","normal"); doc2.setFontSize(7.5); doc2.setTextColor(20,20,20);
  doc2.text("BBVA", bC2, by2 + 12);

  doc2.setFont("helvetica","bold"); doc2.setFontSize(7); doc2.setTextColor(100,100,100);
  doc2.text("Titular:", bC3, by2 + 12);
  doc2.setFont("helvetica","normal"); doc2.setFontSize(7.5); doc2.setTextColor(20,20,20);
  doc2.text("Comercial Llantera Tapatia SA de CV", bC4, by2 + 12);

  // Fila 2: Cuenta | CLABE — ambas en negritas
  doc2.setFont("helvetica","bold"); doc2.setFontSize(7); doc2.setTextColor(100,100,100);
  doc2.text("No. Cuenta:", bC1, by2 + 19);
  doc2.setFont("helvetica","bold"); doc2.setFontSize(8); doc2.setTextColor(20,20,20);
  doc2.text("0154483138", bC2, by2 + 19);

  doc2.setFont("helvetica","bold"); doc2.setFontSize(7); doc2.setTextColor(100,100,100);
  doc2.text("CLABE:", bC3, by2 + 19);
  doc2.setFont("helvetica","bold"); doc2.setFontSize(8); doc2.setTextColor(20,20,20);
  doc2.text("012320001544831389", bC4, by2 + 19);

  // ════════════════════════════════════════════════════════════
  // FOOTER
  // ════════════════════════════════════════════════════════════
  const FY = 282;
  doc2.setFillColor(255,107,6);
  doc2.rect(0, FY, W, 15, "F");
  doc2.setFont("helvetica","bold"); doc2.setFontSize(7); doc2.setTextColor(255,255,255);
  doc2.text("Precios sujetos a cambio sin previo aviso. Sujeto a disponibilidad.", W/2, FY + 4.5, {align:"center"});
  doc2.setFont("helvetica","normal"); doc2.setFontSize(6.5);
  doc2.text("Esta cotizacion es informativa y no constituye un pedido, factura ni compromiso de entrega.", W/2, FY + 9, {align:"center"});
  doc2.text("Grupo Tapatia  |  tapatia.app  |  " + fecha, W/2, FY + 13, {align:"center"});

  doc2.save("Cotizacion_" + folio + ".pdf");
}
// ── Carrito de cotización ─────────────────────────────────────
function CartPanel({cart, setCart, session, db, onClose, mob}){
  const isVend = session?.lista==="VENDEDOR" || session?.rol==="admin" || session?.rol==="superadmin";
  const [nota, setNota] = useState("");
  const [vigencia, setVigencia] = useState("7 días naturales");
  const [generating, setGenerating] = useState(false);
  const [folioMsg, setFolioMsg] = useState("");

  // ── Campo cliente dinámico ─────────────────────────────────
  // Cliente: si es vendedor/admin → editable con opción "Público en general"
  //          si es cliente → automático, no editable
  const clienteAuto = session?.empresa?.trim() || session?.nombre?.trim() || "Público en general";
  const [clienteManual, setClienteManual]   = useState("");
  const [esPublico,     setEsPublico]       = useState(false);
  // Valor final que va al PDF
  const clienteLabel = isVend
    ? (esPublico ? "Público en general" : (clienteManual.trim() || "Público en general"))
    : clienteAuto;

  const subtotal = cart.reduce((s,it)=>s+it.precio*it.cantidad, 0);
  const money2 = n => new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(n);

  function updCantidad(idx,val){
    const n=Math.max(1,parseInt(val)||1);
    setCart(prev=>prev.map((it,i)=>i===idx?{...it,cantidad:n}:it));
  }
  function updPrecio(idx,tipo){
    setCart(prev=>prev.map((it,i)=>{
      if(i!==idx)return it;
      const p=tipo==="publico"?it._publico:tipo==="distribuidor"?it._distribuidor:it._asociado;
      return{...it,precio:p,tipoPrecio:tipo};
    }));
  }
  function remove(idx){setCart(prev=>prev.filter((_,i)=>i!==idx));}

  async function getNextFolio(){
    const uid=session.id||session.usuario;
    const ref=doc(db,"folios",uid);
    const snap=await getDoc(ref);
    const current=snap.exists()?(snap.data().ultimo||0):0;
    const next=current+1;
    await setDoc(ref,{ultimo:next,usuario:session.usuario,actualizado:new Date().toISOString()},{merge:true});
    const prefix=session.usuario.substring(0,3).toUpperCase();
    return`COT-${prefix}-${String(next).padStart(4,"0")}`;
  }

  async function generarCotizacion(){
    if(cart.length===0){setFolioMsg("❌ Agrega al menos un producto.");return;}
    setGenerating(true);setFolioMsg("Generando folio...");
    try{
      const folio=await getNextFolio();
      setFolioMsg(`📄 ${folio} — generando PDF...`);
      await generarPDF({folio,session,items:cart,nota,vigencia,clienteLabel});
      const subtotalGuardar = cart.reduce((s,it)=>s+it.precio*it.cantidad,0);
      const ivaGuardar      = cart.filter(it=>String(it.iva||"NO").toUpperCase()==="SI").reduce((s,it)=>s+it.precio*it.cantidad*0.16,0);
      await setDoc(doc(db,"cotizaciones",folio),{
        folio,usuario:session.usuario,nombre:session.nombre,
        empresa:session.empresa||"",cliente:clienteLabel,
        items:cart,subtotal:subtotalGuardar+ivaGuardar,
        iva:ivaGuardar,nota,vigencia,fecha:new Date().toISOString(),
      });
      setFolioMsg(`✅ ${folio} generada y guardada.`);
      setTimeout(()=>{setCart([]);onClose();},2000);
    }catch(e){setFolioMsg("❌ Error: "+e.message);}
    setGenerating(false);
  }

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:2000,display:"flex",justifyContent:"flex-end",fontFamily:"Arial,sans-serif"}}>
      <div style={{width:"100%",maxWidth:mob?480:560,background:"#fff",height:"100%",display:"flex",flexDirection:"column",boxShadow:"-4px 0 32px rgba(0,0,0,0.2)"}}>

        {/* ── Header ── */}
        <div style={{background:OR,padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div>
            <div style={{color:"#fff",fontWeight:700,fontSize:16,letterSpacing:1}}>🧾 CARRITO DE COTIZACIÓN</div>
            <div style={{color:"rgba(255,255,255,0.85)",fontSize:12,marginTop:2}}>
              {cart.length} producto{cart.length!==1?"s":""} · <strong>{money2(subtotal)}</strong>
            </div>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.25)",border:"none",color:"#fff",width:34,height:34,borderRadius:"50%",cursor:"pointer",fontSize:18,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>

        {/* ── Lista de productos ── */}
        <div style={{flex:1,overflowY:"auto",padding:"14px 16px",background:"#f9f9f9"}}>
          {cart.length===0&&(
            <div style={{textAlign:"center",padding:"50px 20px",color:GRL}}>
              <div style={{fontSize:40,marginBottom:12}}>🛒</div>
              <div style={{fontSize:14,fontWeight:600,marginBottom:6}}>Tu carrito está vacío</div>
              <div style={{fontSize:12}}>Agrega productos con el botón <strong style={{color:OR}}>＋</strong> en el catálogo</div>
            </div>
          )}
          {cart.map((it,i)=>(
            <div key={i} style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:8,padding:"12px 14px",marginBottom:10,boxShadow:"0 1px 4px rgba(0,0,0,0.05)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div style={{flex:1,marginRight:8}}>
                  <div style={{fontFamily:"monospace",color:GRL,fontSize:10,marginBottom:2}}>{it.codigo}</div>
                  <div style={{fontSize:12,fontWeight:600,color:"#1a1a1a",lineHeight:1.4}}>{it.descripcion}</div>
                </div>
                <button onClick={()=>remove(i)} style={{background:"#fee2e2",border:"none",color:"#dc2626",width:26,height:26,borderRadius:"50%",cursor:"pointer",fontSize:13,fontWeight:700,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
              </div>

              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <span style={{fontSize:11,color:GRL,marginRight:2}}>Cant:</span>
                  <div style={{display:"flex",alignItems:"center",border:"1px solid #d1d5db",borderRadius:6,overflow:"hidden"}}>
                    <button onClick={()=>updCantidad(i,it.cantidad-1)}
                      style={{background:"#f3f4f6",border:"none",padding:"5px 10px",cursor:"pointer",fontSize:15,fontWeight:700,color:"#374151",lineHeight:1}}>−</button>
                    <input type="number" min="1" value={it.cantidad} onChange={e=>updCantidad(i,e.target.value)}
                      style={{width:42,textAlign:"center",border:"none",borderLeft:"1px solid #d1d5db",borderRight:"1px solid #d1d5db",padding:"5px 4px",fontSize:13,fontWeight:700,outline:"none"}}/>
                    <button onClick={()=>updCantidad(i,it.cantidad+1)}
                      style={{background:"#f3f4f6",border:"none",padding:"5px 10px",cursor:"pointer",fontSize:15,fontWeight:700,color:"#374151",lineHeight:1}}>＋</button>
                  </div>
                </div>

                {isVend&&(
                  <select value={it.tipoPrecio} onChange={e=>updPrecio(i,e.target.value)}
                    style={{padding:"5px 8px",border:"1px solid #d1d5db",borderRadius:6,fontSize:11,color:"#374151",outline:"none",background:"#fff",cursor:"pointer"}}>
                    <option value="publico">Público</option>
                    <option value="distribuidor">Distribuidor</option>
                    <option value="asociado">Asociado</option>
                  </select>
                )}

                <div style={{marginLeft:"auto",textAlign:"right"}}>
                  <div style={{fontSize:11,color:GRL}}>P. Unit: <strong style={{color:"#374151"}}>{money2(it.precio)}</strong></div>
                  <div style={{fontSize:14,fontWeight:700,color:OR}}>{money2(it.precio*it.cantidad)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Footer ── */}
        {cart.length>0&&(
          <div style={{borderTop:"2px solid #e5e7eb",padding:"14px 16px",background:"#fff",flexShrink:0}}>

            {/* ── Campo CLIENTE ── */}
            <div style={{marginBottom:12,background:"#f9f9f9",border:"1px solid #e5e7eb",borderRadius:8,padding:"10px 12px"}}>
              <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:6,fontWeight:700}}>CLIENTE EN LA COTIZACIÓN</div>
              {isVend ? (
                /* Vendedor / Admin: editable */
                <div>
                  <input
                    value={esPublico?"Público en general":clienteManual}
                    onChange={e=>{ setClienteManual(e.target.value); setEsPublico(false); }}
                    disabled={esPublico}
                    placeholder="Nombre o razón social del cliente..."
                    style={{width:"100%",padding:"7px 10px",border:"1px solid #d1d5db",borderRadius:6,
                      fontSize:12,outline:"none",boxSizing:"border-box",marginBottom:6,
                      background:esPublico?"#f3f4f6":"#fff",color:esPublico?GRL:"#1a1a1a"}}/>
                  <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:11,color:GRL}}>
                    <input type="checkbox" checked={esPublico} onChange={e=>{setEsPublico(e.target.checked);if(e.target.checked)setClienteManual("");}}
                      style={{width:14,height:14,accentColor:OR,cursor:"pointer"}}/>
                    Público en general
                  </label>
                </div>
              ):(
                /* Cliente: solo lectura */
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:13,fontWeight:600,color:"#1a1a1a"}}>{clienteAuto}</span>
                  <span style={{fontSize:10,color:GRL,background:"#f3f4f6",padding:"2px 7px",borderRadius:3}}>automático</span>
                </div>
              )}
            </div>

            {/* Vigencia y observaciones */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 10px",marginBottom:10}}>
              <div>
                <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>VIGENCIA</div>
                <select value={vigencia} onChange={e=>setVigencia(e.target.value)}
                  style={{width:"100%",padding:"7px 9px",border:"1px solid #d1d5db",borderRadius:6,fontSize:12,outline:"none",background:"#fff"}}>
                  <option>7 días naturales</option>
                  <option>15 días naturales</option>
                  <option>30 días naturales</option>
                  <option>Sujeto a disponibilidad</option>
                </select>
              </div>
              <div>
                <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>OBSERVACIONES</div>
                <input value={nota} onChange={e=>setNota(e.target.value)}
                  placeholder="Notas adicionales..."
                  style={{width:"100%",padding:"7px 9px",border:"1px solid #d1d5db",borderRadius:6,fontSize:12,outline:"none",boxSizing:"border-box"}}/>
              </div>
            </div>

            <div style={{background:"#f9f9f9",border:"1px solid #e5e7eb",borderRadius:8,padding:"10px 14px",marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:12,color:GRL}}>{cart.length} producto{cart.length!==1?"s":""}</span>
                <span style={{fontSize:12,color:GRL}}>{cart.reduce((s,it)=>s+it.cantidad,0)} piezas total</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderTop:"1px solid #e5e7eb",paddingTop:8,marginTop:4}}>
                <span style={{fontSize:14,fontWeight:700,color:"#1a1a1a"}}>SUBTOTAL ANTES DE IVA:</span>
                <span style={{fontSize:20,fontWeight:800,color:OR}}>{money2(subtotal)}</span>
              </div>
            </div>

            {folioMsg&&<div style={{fontSize:11,marginBottom:10,padding:"8px 12px",borderRadius:6,
              background:folioMsg.startsWith("✅")?"#f0fdf4":folioMsg.startsWith("❌")?"#fef2f2":"#fffbeb",
              color:folioMsg.startsWith("✅")?"#16a34a":folioMsg.startsWith("❌")?"#dc2626":"#d97706",
              border:`1px solid ${folioMsg.startsWith("✅")?"#bbf7d0":folioMsg.startsWith("❌")?"#fecaca":"#fde68a"}`}}>{folioMsg}</div>}

            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>{if(window.confirm("¿Limpiar el carrito?"))setCart([]);}}
                style={{flex:1,padding:"11px",background:"#f3f4f6",color:"#374151",border:"1px solid #d1d5db",borderRadius:6,cursor:"pointer",fontWeight:600,fontSize:12}}>
                🗑 Limpiar
              </button>
              <button onClick={generarCotizacion} disabled={generating}
                style={{flex:3,padding:"11px",background:OR,color:"#fff",border:"none",borderRadius:6,
                  cursor:generating?"wait":"pointer",fontWeight:700,fontSize:13,letterSpacing:0.5,
                  opacity:generating?0.7:1,boxShadow:"0 2px 8px rgba(255,107,6,0.35)"}}>
                {generating?"⏳ GENERANDO...":"📄 GENERAR COTIZACIÓN PDF"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Botón flotante del carrito — siempre visible ──────────────
function CartFAB({cart, onClick, mob}){
  const count = cart.length;
  const subtotal = cart.reduce((s,it)=>s+it.precio*it.cantidad,0);
  const money2 = n => new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN",minimumFractionDigits:0}).format(n);

  return (
    <button
      onClick={onClick}
      title="Ver carrito de cotización"
      style={{
        position:"fixed",
        bottom: mob ? 16 : 24,
        right:  mob ? 16 : 24,
        zIndex: 1500,
        background: count > 0 ? OR : "#fff",
        color: count > 0 ? "#fff" : GRL,
        border: count > 0 ? "none" : "2px solid "+BD,
        borderRadius: mob ? "50%" : "50px",
        width:  count === 0 || mob ? (mob ? 52 : 52) : "auto",
        height: count === 0 || mob ? (mob ? 52 : 52) : "auto",
        padding: count > 0 && !mob ? "12px 20px" : 0,
        cursor: "pointer",
        fontWeight: 700,
        fontSize: 13,
        boxShadow: count > 0
          ? "0 4px 20px rgba(255,107,6,0.45)"
          : "0 2px 12px rgba(0,0,0,0.12)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        transition: "all 0.2s ease",
      }}
    >
      {/* Ícono carrito */}
      <span style={{fontSize: mob ? 22 : (count > 0 ? 18 : 22), lineHeight:1}}>🛒</span>

      {/* Texto solo en desktop cuando hay items */}
      {count > 0 && !mob && (
        <span style={{fontSize:13}}>
          Cotización · {money2(subtotal)}
        </span>
      )}

      {/* Burbuja contador — siempre que haya items */}
      {count > 0 && (
        <span style={{
          background:"#fff",
          color: OR,
          borderRadius:"50%",
          width: mob ? 20 : 22,
          height: mob ? 20 : 22,
          display:"flex",
          alignItems:"center",
          justifyContent:"center",
          fontSize: mob ? 10 : 11,
          fontWeight: 800,
          position: mob ? "absolute" : "relative",
          top: mob ? -6 : "auto",
          right: mob ? -6 : "auto",
          boxShadow: mob ? "0 1px 4px rgba(0,0,0,0.2)" : "none",
          border: mob ? "2px solid "+OR : "none",
          flexShrink: 0,
        }}>{count}</span>
      )}
    </button>
  );
}

// ── Celda de contraseña con ver/editar ───────────────────────
function PassCell({uid, db, hashPassword}){
  const [show,   setShow]   = useState(false);
  const [editing,setEditing]= useState(false);
  const [newPass,setNewPass] = useState("");
  const [saving, setSaving]  = useState(false);
  const [msg,    setMsg]     = useState("");
  const [plain,  setPlain]   = useState("");

  async function guardar(){
    if(!newPass.trim()){ setMsg("❌ Escribe una contraseña"); return; }
    if(newPass.trim().length<3){ setMsg("❌ Mínimo 3 caracteres"); return; }
    setSaving(true); setMsg("");
    try {
      const hash = await hashPassword(newPass.trim());
      await setDoc(doc(db,"usuarios",uid),{password:hash, actualizado:new Date().toISOString()},{merge:true});
      setPlain(newPass.trim());
      setNewPass(""); setEditing(false);
      setMsg("✅ Guardada");
      setTimeout(()=>setMsg(""),3000);
    } catch(e){ setMsg("❌ "+e.message); }
    setSaving(false);
  }

  if(editing) return(
    <div style={{display:"flex",gap:4,alignItems:"center",minWidth:200}}>
      <input autoFocus value={newPass} onChange={e=>setNewPass(e.target.value)}
        onKeyDown={e=>{if(e.key==="Enter")guardar();if(e.key==="Escape"){setEditing(false);setNewPass("");}}}
        placeholder="Nueva contraseña"
        style={{padding:"4px 8px",border:"1px solid "+OR,borderRadius:3,fontSize:12,width:130,outline:"none"}}/>
      <button onClick={guardar} disabled={saving}
        style={{background:OR,color:"#fff",border:"none",padding:"4px 8px",borderRadius:3,cursor:"pointer",fontSize:10,fontWeight:700}}>
        {saving?"...":"OK"}
      </button>
      <button onClick={()=>{setEditing(false);setNewPass("");}}
        style={{background:"#f3f4f6",color:GRL,border:"1px solid "+BD,padding:"4px 8px",borderRadius:3,cursor:"pointer",fontSize:10}}>✕</button>
      {msg&&<span style={{fontSize:10,color:msg.startsWith("✅")?"#16a34a":"#dc2626"}}>{msg}</span>}
    </div>
  );

  return(
    <div style={{display:"flex",gap:4,alignItems:"center"}}>
      <span style={{fontFamily:"monospace",fontSize:11,color:show?"#1a1a1a":GRL,background:show?"#f0fdf4":"#f3f4f6",padding:"3px 8px",borderRadius:3,minWidth:80}}>
        {show ? (plain||"(hash)") : "••••••"}
      </span>
      <button onClick={()=>setShow(s=>!s)}
        style={{background:"none",border:"none",cursor:"pointer",fontSize:13,padding:"2px 4px",color:GRL}}
        title={show?"Ocultar":"Mostrar"}>{show?"🙈":"👁"}</button>
      <button onClick={()=>{setEditing(true);setShow(false);}}
        style={{background:"none",border:"none",cursor:"pointer",fontSize:12,padding:"2px 4px",color:OR}}
        title="Cambiar contraseña">✏️</button>
      {msg&&<span style={{fontSize:10,color:"#16a34a"}}>{msg}</span>}
    </div>
  );
}

// ── Cambiar contraseña ────────────────────────────────────────
function ChangePassword({session,db,hashPassword,checkPassword}){
  const [actual,setActual]=useState("");
  const [nueva,setNueva]=useState("");
  const [confirmar,setConfirmar]=useState("");
  const [msg,setMsg]=useState("");
  const [loading,setLoading]=useState(false);

  async function cambiar(){
    if(!actual||!nueva||!confirmar){setMsg("❌ Completa todos los campos.");return;}
    if(nueva!==confirmar){setMsg("❌ Las contraseñas nuevas no coinciden.");return;}
    if(nueva.length<4){setMsg("❌ La contraseña debe tener al menos 4 caracteres.");return;}
    setLoading(true);setMsg("");
    try {
      const snap=await getDocs(collection(db,"usuarios"));
      const adminDoc=snap.docs.find(d=>d.data().usuario===session.usuario);
      if(!adminDoc){setMsg("❌ No se encontró tu usuario.");setLoading(false);return;}
      const ok=await checkPassword(actual,adminDoc.data().password);
      if(!ok){setMsg("❌ La contraseña actual es incorrecta.");setLoading(false);return;}
      const hash=await hashPassword(nueva);
      await setDoc(doc(db,"usuarios",adminDoc.id),{password:hash,actualizado:new Date().toISOString()},{merge:true});
      const updated={...session,password:hash};
      localStorage.setItem("gt_session",JSON.stringify(updated));
      setMsg("✅ Contraseña cambiada exitosamente.");
      setActual("");setNueva("");setConfirmar("");
    } catch(e){setMsg("❌ Error: "+e.message);}
    setLoading(false);
  }

  return <div>
    <div style={{display:"grid",gap:10}}>
      <div>
        <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>CONTRASEÑA ACTUAL</div>
        <input type="password" value={actual} onChange={e=>setActual(e.target.value)}
          style={{width:"100%",padding:"9px 11px",background:"#f7f7f7",border:"1px solid "+BD,color:"#1a1a1a",fontSize:13,borderRadius:4,boxSizing:"border-box",outline:"none"}}/>
      </div>
      <div>
        <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>CONTRASEÑA NUEVA</div>
        <input type="password" value={nueva} onChange={e=>setNueva(e.target.value)}
          style={{width:"100%",padding:"9px 11px",background:"#f7f7f7",border:"1px solid "+BD,color:"#1a1a1a",fontSize:13,borderRadius:4,boxSizing:"border-box",outline:"none"}}/>
      </div>
      <div>
        <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>CONFIRMAR CONTRASEÑA NUEVA</div>
        <input type="password" value={confirmar} onChange={e=>setConfirmar(e.target.value)}
          style={{width:"100%",padding:"9px 11px",background:"#f7f7f7",border:"1px solid "+BD,color:"#1a1a1a",fontSize:13,borderRadius:4,boxSizing:"border-box",outline:"none"}}/>
      </div>
    </div>
    {msg&&<div style={{marginTop:10,fontSize:12,color:msg.startsWith("✅")?"#16a34a":"#dc2626",fontWeight:600}}>{msg}</div>}
    <button onClick={cambiar} disabled={loading}
      style={{marginTop:14,background:OR,color:"#fff",border:"none",padding:"10px 20px",borderRadius:4,cursor:loading?"wait":"pointer",fontWeight:700,fontSize:12,letterSpacing:1,opacity:loading?0.7:1}}>
      {loading?"GUARDANDO...":"CAMBIAR CONTRASEÑA"}
    </button>
  </div>;
}

// ── Crear admin ───────────────────────────────────────────────
function CreateAdmin({session,db,hashPassword}){
  const [form,setForm]=useState({nombre:"",usuario:"",password:"",confirmar:""});
  const [msg,setMsg]=useState("");
  const [loading,setLoading]=useState(false);
  const upd=(k,v)=>setForm(p=>({...p,[k]:v}));

  async function crear(){
    if(!form.nombre||!form.usuario||!form.password){setMsg("❌ Completa todos los campos.");return;}
    if(form.password!==form.confirmar){setMsg("❌ Las contraseñas no coinciden.");return;}
    if(form.password.length<4){setMsg("❌ Contraseña muy corta (mínimo 4 caracteres).");return;}
    setLoading(true);setMsg("");
    try {
      const snap=await getDocs(collection(db,"usuarios"));
      const existe=snap.docs.find(d=>d.data().usuario===form.usuario.trim());
      if(existe){setMsg("❌ Ya existe un usuario con ese nombre. Elige otro.");setLoading(false);return;}
      const id="admin_"+Date.now();
      const hash=await hashPassword(form.password);
      await setDoc(doc(db,"usuarios",id),{
        nombre:  form.nombre.trim(),
        usuario: form.usuario.trim(),
        password:hash,
        rol:     "admin",
        lista:   "PUBLICO",
        estatus: "activo",
        empresa: "Grupo Tapatía",
        creado_por: session.nombre,
        creado_en:  new Date().toISOString(),
        actualizado:new Date().toISOString(),
      });
      setMsg("✅ Administrador '"+form.usuario+"' creado exitosamente.");
      setForm({nombre:"",usuario:"",password:"",confirmar:""});
    } catch(e){setMsg("❌ Error: "+e.message);}
    setLoading(false);
  }

  return <div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 14px"}}>
      <div style={{marginBottom:12}}>
        <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>NOMBRE</div>
        <input value={form.nombre} onChange={e=>upd("nombre",e.target.value)}
          style={{width:"100%",padding:"9px 11px",background:"#f7f7f7",border:"1px solid "+BD,color:"#1a1a1a",fontSize:13,borderRadius:4,boxSizing:"border-box",outline:"none"}}/>
      </div>
      <div style={{marginBottom:12}}>
        <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>USUARIO</div>
        <input value={form.usuario} onChange={e=>upd("usuario",e.target.value)}
          style={{width:"100%",padding:"9px 11px",background:"#f7f7f7",border:"1px solid "+BD,color:"#1a1a1a",fontSize:13,borderRadius:4,boxSizing:"border-box",outline:"none"}}/>
      </div>
      <div style={{marginBottom:12}}>
        <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>CONTRASEÑA</div>
        <input type="password" value={form.password} onChange={e=>upd("password",e.target.value)}
          style={{width:"100%",padding:"9px 11px",background:"#f7f7f7",border:"1px solid "+BD,color:"#1a1a1a",fontSize:13,borderRadius:4,boxSizing:"border-box",outline:"none"}}/>
      </div>
      <div style={{marginBottom:12}}>
        <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>CONFIRMAR</div>
        <input type="password" value={form.confirmar} onChange={e=>upd("confirmar",e.target.value)}
          style={{width:"100%",padding:"9px 11px",background:"#f7f7f7",border:"1px solid "+BD,color:"#1a1a1a",fontSize:13,borderRadius:4,boxSizing:"border-box",outline:"none"}}/>
      </div>
    </div>
    {msg&&<div style={{fontSize:12,color:msg.startsWith("✅")?"#16a34a":"#dc2626",fontWeight:600,marginBottom:10}}>{msg}</div>}
    <button onClick={crear} disabled={loading}
      style={{background:OR,color:"#fff",border:"none",padding:"10px 20px",borderRadius:4,cursor:loading?"wait":"pointer",fontWeight:700,fontSize:12,letterSpacing:1,opacity:loading?0.7:1}}>
      {loading?"CREANDO...":"CREAR ADMINISTRADOR"}
    </button>
  </div>;
}

// ════════════════════════════════════════════════════════════
// APP PRINCIPAL
// ════════════════════════════════════════════════════════════
export default function App(){
  const [session,  setSession]  = useState(()=>{ try{const s=localStorage.getItem("gt_session");return s?JSON.parse(s):null;}catch(e){return null;} });
  const [view,     setView]     = useState(()=>{ try{const s=localStorage.getItem("gt_session");if(s){const u=JSON.parse(s);return u.rol==="admin"||u.rol==="superadmin"?"admin":"client";}}catch(e){}return "login"; });
  const [tab,      setTab]      = useState("products");
  const [users,    setUsers]    = useState([]);
  const [products, setProducts] = useState([]);
  const [prodLoad, setProdLoad] = useState(false);
  const [userLoad, setUserLoad] = useState(false);
  const [search,   setSearch]   = useState("");
  const [ds,       setDs]       = useState("");
  const [page,     setPage]     = useState(0);
  const [cart,     setCart]     = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [quotes,   setQuotes]   = useState([]);
  const [quotesLoad,setQuotesLoad]=useState(false);
  const [quoteDetail,setQuoteDetail]=useState(null);
  const PS = 50;
  const [lu,setLu]=useState(""); const [lp,setLp]=useState(""); const [lerr,setLerr]=useState("");
  const [loginLoad,setLoginLoad]=useState(false);
  const [msg,setMsg]=useState("");
  const [modal,setModal]=useState(null);
  const [saving,setSaving]=useState(false);
  const [mob,setMob]=useState(window.innerWidth<768);
  const fref=useRef(); const dbRef=useRef(null);
  const emptyC={nombre:"",empresa:"",usuario:"",password:"",lista:"DISTRIBUIDOR",estatus:"activo"};

  useEffect(()=>{const h=()=>setMob(window.innerWidth<768);window.addEventListener("resize",h);return()=>window.removeEventListener("resize",h);},[]);

  useEffect(()=>{
    if(dbRef.current)clearTimeout(dbRef.current);
    dbRef.current=setTimeout(()=>{setDs(search);setPage(0);},300);
    return()=>{if(dbRef.current)clearTimeout(dbRef.current);};
  },[search]);

  useEffect(()=>{
    if(session) loadProducts();
    if(session?.rol==="admin"||session?.rol==="superadmin") loadUsers();
  },[session]);

  async function loadProducts(){
    setProdLoad(true);
    const data = await fbGetProductos();
    if(data !== null) setProducts(data);
    else console.warn("No se pudieron cargar productos — manteniendo estado anterior");
    setProdLoad(false);
  }

  async function loadUsers(){
    setUserLoad(true);
    const data = await fbGetUsuarios();
    if(data !== null){ setUsers(data); }
    else { console.warn("No se pudieron cargar usuarios — manteniendo estado anterior"); }
    setUserLoad(false);
  }

  // ── Cargar cotizaciones ────────────────────────────────────
  async function loadQuotes(){
    setQuotesLoad(true);
    try {
      const snap = await getDocs(collection(db,"cotizaciones"));
      const isAdmin = session?.rol==="admin"||session?.rol==="superadmin";
      let qdata = snap.docs.map(d=>({id:d.id,...d.data()}));
      if(!isAdmin) qdata = qdata.filter(q=>q.usuario===session?.usuario);
      qdata.sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));
      setQuotes(qdata);
    } catch(e){ console.error("Error cotizaciones:",e); }
    setQuotesLoad(false);
  }

  async function doLogin(){
    setLerr(""); setLoginLoad(true);
    try {
      const data = await fbGetUsuarios();
      if(data===null){ setLerr("Error de conexión con Firebase. Intenta de nuevo."); setLoginLoad(false); return; }
      const u=data.find(u=>u.usuario===lu.trim());
      if(!u){ setLerr("Usuario o contraseña incorrectos"); setLoginLoad(false); return; }
      const ok=await checkPassword(lp.trim(),u.password);
      if(!ok){ setLerr("Usuario o contraseña incorrectos"); setLoginLoad(false); return; }
      if(u.estatus==="inactivo"){ setLerr("Cuenta inactiva. Contacta al administrador."); setLoginLoad(false); return; }
      setSession(u);
      localStorage.setItem("gt_session",JSON.stringify(u));
      setView(u.rol==="admin"||u.rol==="superadmin"?"admin":"client");
      setLu(""); setLp("");
    } catch(e){ setLerr("Error: "+e.message); }
    setLoginLoad(false);
  }

  function doLogout(){
    setSession(null); setView("login");
    setSearch(""); setDs(""); setPage(0);
    setProducts([]); setUsers([]);
    localStorage.removeItem("gt_session");
  }

  async function handleFile(e){
    const file=e.target.files[0]; if(!file)return; e.target.value="";
    if(file.name.endsWith(".xlsx")||file.name.endsWith(".xls")){setMsg("⚠️ Guarda como CSV UTF-8 desde Excel.");return;}
    setMsg("📂 Leyendo archivo...");
    const reader=new FileReader();
    reader.onload=async ev=>{
      try {
        const rows=parseCsv(ev.target.result);
        if(rows.length===0){setMsg("❌ No se encontró columna CÓDIGO.");return;}

        const mapped=rows.map(r=>({
          codigo:      String(r.CODIGO||r["CÓDIGO"]||"").trim(),
          descripcion: String(r.DESCRIPCION||r["DESCRIPCIÓN"]||"").trim(),
          gdl1:Number(r.GDL1||0),gdl3:Number(r.GDL3||0),
          ags:Number(r.AGS||0),col:Number(r.COL||0),
          len:Number(r.LEN||0),cul:Number(r.CUL||0),
          publico:     Number(r.PUBLICO||r["PÚBLICO"]||0),
          distribuidor:Number(r.DISTRIBUIDOR||0),
          asociado:    Number(r.ASOCIADO||0),
          iva:         String(r.IVA||"NO").trim().toUpperCase()==="SI"?"SI":"NO",
          actualizado: new Date().toISOString(),
        })).filter(p=>p.codigo);

        if(mapped.length===0){setMsg("❌ No hay productos válidos en el archivo.");return;}

        setMsg("💾 Respaldando versión anterior...");
        const oldSnap=await getDocs(collection(db,"productos"));
        if(oldSnap.docs.length>0){
          const ts=new Date().toISOString().replace(/[:.]/g,"-").slice(0,19);
          const bkBatch=writeBatch(db);
          oldSnap.docs.forEach(d=>bkBatch.set(doc(db,`respaldo_${ts}`,d.id),d.data()));
          await bkBatch.commit();
        }

        setMsg("🗑️ Eliminando versión anterior...");
        if(oldSnap.docs.length>0){
          const delBatch=writeBatch(db);
          oldSnap.docs.forEach(d=>delBatch.delete(d.ref));
          await delBatch.commit();
        }

        const chunk=400;
        for(let i=0;i<mapped.length;i+=chunk){
          const batch=writeBatch(db);
          mapped.slice(i,i+chunk).forEach((p,j)=>{
            batch.set(doc(collection(db,"productos"),`p_${String(i+j).padStart(6,"0")}`),p);
          });
          await batch.commit();
          setMsg(`⏳ ${Math.min(i+chunk,mapped.length)} / ${mapped.length} productos guardados...`);
        }

        const verify=await getDocs(collection(db,"productos"));
        if(verify.size===0){
          setMsg("❌ ERROR CRÍTICO: Los productos no se guardaron correctamente. Revisa Firebase.");
          return;
        }

        await setDoc(doc(db,"bitacora",`carga_${Date.now()}`),{
          tipo:"carga_productos",
          por:session.nombre,
          cantidad:mapped.length,
          fecha:new Date().toISOString(),
        });

        // ── Limpiar respaldos viejos — mantener solo los 3 más recientes ────────────
        try {
          const MAX_RESPALDOS = 3;
          const bkIndexRef = doc(db,"_meta","respaldos_index");
          const bkIndexSnap = await getDoc(bkIndexRef);
          let bkList = bkIndexSnap.exists() ? (bkIndexSnap.data().lista||[]) : [];

          // Registrar el respaldo recién creado
          if(oldSnap.docs.length > 0) bkList.push(`respaldo_${ts}`);

          // Si hay más de 3, borrar los más viejos
          if(bkList.length > MAX_RESPALDOS){
            const aEliminar = bkList.slice(0, bkList.length - MAX_RESPALDOS);
            for(const colName of aEliminar){
              try {
                const oldBkSnap = await getDocs(collection(db, colName));
                if(!oldBkSnap.empty){
                  const docs = oldBkSnap.docs;
                  for(let ci=0; ci<docs.length; ci+=400){
                    const delB = writeBatch(db);
                    docs.slice(ci,ci+400).forEach(d=>delB.delete(d.ref));
                    await delB.commit();
                  }
                }
              } catch(bkErr){ console.warn("No se pudo borrar:",colName,bkErr); }
            }
            bkList = bkList.slice(bkList.length - MAX_RESPALDOS);
          }

          await setDoc(bkIndexRef,{lista:bkList,actualizado:new Date().toISOString()});
        } catch(bkErr){ console.warn("Error respaldos:",bkErr); }

        await loadProducts();
        setMsg(`✅ ${mapped.length} productos guardados. Se conservan los últimos 3 respaldos.`);
      } catch(err){
        setMsg("❌ ERROR: "+err.message);
        console.error("Error al subir CSV:",err);
      }
    };
    reader.readAsText(file,"UTF-8");
  }

  async function saveClient(form){
    setSaving(true);
    try {
      if(!form.nombre?.trim()||!form.usuario?.trim()){
        alert("Nombre y usuario son obligatorios.");setSaving(false);return;
      }
      if(!form.id&&!form.password?.trim()){
        alert("La contraseña es obligatoria para usuarios nuevos.");setSaving(false);return;
      }

      if(!form.id){
        const existe=users.find(u=>u.usuario.trim()===form.usuario.trim());
        if(existe){alert("Ya existe un usuario con ese nombre. Elige otro.");setSaving(false);return;}
      }

      const id=form.id||"u_"+Date.now();
      const data={
        nombre:  form.nombre.trim(),
        empresa: (form.empresa||"").trim(),
        usuario: form.usuario.trim(),
        lista:   form.lista,
        estatus: form.estatus,
        rol:     "client",
        actualizado: new Date().toISOString(),
      };
      if(!form.id) data.creado_en=new Date().toISOString();
      if(form.password?.trim()) data.password=await hashPassword(form.password.trim());

      await setDoc(doc(db,"usuarios",id),data,{merge:true});

      const verify=await getDoc(doc(db,"usuarios",id));
      if(!verify.exists()){
        alert("❌ ERROR: El usuario no se guardó. Intenta de nuevo.");setSaving(false);return;
      }

      await setDoc(doc(db,"bitacora",`u_${Date.now()}`),{
        tipo:form.id?"edicion_usuario":"nuevo_usuario",
        usuario:form.usuario.trim(),
        por:session.nombre,
        fecha:new Date().toISOString(),
      });

      await loadUsers();
      setModal(null);
    } catch(err){
      alert("❌ Error al guardar: "+err.message);
      console.error("Error saveClient:",err);
    }
    setSaving(false);
  }

  async function toggleEstatus(id,est){
    try {
      await setDoc(doc(db,"usuarios",id),{
        estatus: est==="activo"?"inactivo":"activo",
        actualizado: new Date().toISOString()
      },{merge:true});
      setUsers(prev=>prev.map(u=>u.id===id?{...u,estatus:est==="activo"?"inactivo":"activo"}:u));
    } catch(err){
      alert("❌ Error al cambiar estatus: "+err.message);
    }
  }

  async function deleteClient(id,nombre,rol){
    if(rol==="admin"||rol==="superadmin"){
      const admins=users.filter(u=>u.rol==="admin"||u.rol==="superadmin");
      if(admins.length<=1){
        alert("❌ No puedes eliminar el único administrador del sistema.");
        return;
      }
    }
    if(!window.confirm(`¿Eliminar a ${nombre}? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteDoc(doc(db,"usuarios",id));
      await setDoc(doc(db,"bitacora",`del_${Date.now()}`),{
        tipo:"eliminacion_usuario",
        usuario_id:id,
        usuario_nombre:nombre,
        por:session.nombre,
        fecha:new Date().toISOString(),
      });
      setUsers(prev=>prev.filter(u=>u.id!==id));
    } catch(err){
      alert("❌ Error al eliminar: "+err.message);
    }
  }

  // ── Agregar al carrito ─────────────────────────────────────
  function addToCart(p){
    const rol2   = session?.rol||"client";
    const lista2 = session?.lista||"PUBLICO";
    const isVend2 = lista2==="VENDEDOR"||rol2==="admin"||rol2==="superadmin";
    const precioVal = isVend2 ? (Number(p.publico)||0) : getPrecio(p,lista2);
    const tipoPrecio = isVend2 ? "publico" : lista2.toLowerCase();

    setCart(prev=>{
      const idx=prev.findIndex(it=>it.codigo===String(p.codigo));
      if(idx>=0){
        return prev.map((it,i)=>i===idx?{...it,cantidad:it.cantidad+1}:it);
      }
      return [...prev,{
        codigo:      String(p.codigo||""),
        descripcion: String(p.descripcion||""),
        precio:      precioVal,
        tipoPrecio,
        cantidad:    1,
        iva:         String(p.iva||"NO").trim().toUpperCase()==="SI"?"SI":"NO",
        _publico:     Number(p.publico)||0,
        _distribuidor:Number(p.distribuidor)||0,
        _asociado:    Number(p.asociado)||0,
      }];
    });
  }

  // ── Filtrado ───────────────────────────────────────────────
  const filtered=useMemo(()=>{
    const q=ds.trim();
    const results = q ? products.filter(p=>smartMatch(q,p)) : [...products];
    return results.sort((a,b)=>{
      const ta=calcTotal(a), tb=calcTotal(b);
      if(ta===0 && tb===0) return 0;
      if(ta===0) return 1;
      if(tb===0) return -1;
      return tb-ta;
    });
  },[products,ds]);

  // ── Modal cliente ──────────────────────────────────────────
  function ClientModal(){
    const isEdit=modal.mode==="edit";
    const [form,setForm]=useState(isEdit?{...modal.data,password:""}:{...emptyC});
    const upd=(k,v)=>setForm(p=>({...p,[k]:v}));
    return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
      <div style={{background:CD,border:"1px solid "+BD,borderRadius:8,padding:24,width:"100%",maxWidth:460,boxShadow:"0 8px 40px rgba(0,0,0,0.15)",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{fontWeight:700,fontSize:14,color:OR,marginBottom:18}}>{isEdit?"EDITAR CLIENTE":"NUEVO CLIENTE"}</div>
        <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:"0 14px"}}>
          <Inp label="NOMBRE *"   value={form.nombre}      onChange={e=>upd("nombre",e.target.value)}/>
          <Inp label="EMPRESA"    value={form.empresa||""}  onChange={e=>upd("empresa",e.target.value)}/>
          <Inp label="USUARIO *"  value={form.usuario}     onChange={e=>upd("usuario",e.target.value)}/>
          <Inp label={isEdit?"NUEVA CONTRASEÑA (vacío = no cambia)":"CONTRASEÑA *"}
            value={form.password} onChange={e=>upd("password",e.target.value)} type="password"/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:"0 14px"}}>
          <div style={{marginBottom:12}}>
            <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>TIPO *</div>
            <select value={form.lista} onChange={e=>upd("lista",e.target.value)}
              style={{width:"100%",padding:"9px 11px",background:"#f7f7f7",border:"1px solid "+BD,color:"#1a1a1a",fontSize:13,borderRadius:4,outline:"none"}}>
              <option value="PUBLICO">PÚBLICO</option>
              <option value="DISTRIBUIDOR">DISTRIBUIDOR</option>
              <option value="ASOCIADO">ASOCIADO</option>
              <option value="VENDEDOR">VENDEDOR (todos los precios)</option>
            </select>
          </div>
          <div style={{marginBottom:12}}>
            <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>ESTATUS</div>
            <select value={form.estatus} onChange={e=>upd("estatus",e.target.value)}
              style={{width:"100%",padding:"9px 11px",background:"#f7f7f7",border:"1px solid "+BD,color:"#1a1a1a",fontSize:13,borderRadius:4,outline:"none"}}>
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
            </select>
          </div>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}>
          <Btn ghost onClick={()=>setModal(null)}>CANCELAR</Btn>
          <Btn onClick={()=>saveClient(form)} disabled={saving}>{saving?"GUARDANDO...":"GUARDAR"}</Btn>
        </div>
      </div>
    </div>;
  }

  // ── Header ─────────────────────────────────────────────────
  const Hdr=session&&<div style={{background:OR,borderBottom:"2px solid #e05500",padding:mob?"10px 14px":"11px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",boxShadow:"0 2px 8px rgba(0,0,0,0.15)"}}>
    <div style={{display:"flex",alignItems:"center",gap:12}}>
      <Logo h={mob?32:44}/>
      {!mob&&<><div style={{width:1,height:24,background:"rgba(255,255,255,0.3)"}}/><span style={{color:"rgba(255,255,255,0.9)",fontSize:10,letterSpacing:2}}>{session.rol==="admin"||session.rol==="superadmin"?"PANEL ADMINISTRADOR":"PORTAL DE PRECIOS"}</span></>}
    </div>
    <div style={{display:"flex",alignItems:"center",gap:10}}>
      {!mob&&<div style={{textAlign:"right"}}><div style={{color:"#fff",fontSize:12,fontWeight:600}}>{session.nombre}</div>{session.empresa&&<div style={{color:"rgba(255,255,255,0.75)",fontSize:10}}>{session.empresa}</div>}</div>}
      <button onClick={doLogout} style={{background:"rgba(255,255,255,0.2)",color:"#fff",border:"1px solid rgba(255,255,255,0.4)",padding:"7px 16px",borderRadius:4,cursor:"pointer",fontWeight:700,fontSize:11,letterSpacing:1}}>SALIR</button>
    </div>
  </div>;

  // ════ LOGIN ════════════════════════════════════════════════
  if(view==="login") return <div style={{minHeight:"100vh",background:DK,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Arial,sans-serif",padding:16}}>
    <div style={{width:"100%",maxWidth:360,background:CD,borderRadius:8,overflow:"hidden",boxShadow:"0 8px 40px rgba(0,0,0,0.12)"}}>
      <div style={{background:OR,padding:"20px 28px",display:"flex",justifyContent:"center"}}><Logo h={48}/></div>
      <div style={{padding:"26px 28px 24px"}}>
        <div style={{color:GRL,fontSize:11,letterSpacing:3,textAlign:"center",marginBottom:20}}>PORTAL DE PRECIOS</div>
        <Inp label="USUARIO"    value={lu} onChange={e=>setLu(e.target.value)}/>
        <Inp label="CONTRASEÑA" value={lp} onChange={e=>setLp(e.target.value)} type="password" mb={20}/>
        {lerr&&<div style={{color:"#dc2626",fontSize:12,textAlign:"center",marginBottom:12,fontWeight:600}}>{lerr}</div>}
        <button onClick={doLogin} disabled={loginLoad}
          style={{width:"100%",padding:"12px",background:OR,color:"#fff",border:"none",borderRadius:4,
            fontSize:13,fontWeight:700,cursor:loginLoad?"wait":"pointer",letterSpacing:2,opacity:loginLoad?0.7:1}}>
          {loginLoad?"VERIFICANDO...":"INGRESAR"}
        </button>
      </div>
    </div>
  </div>;

  // ════ ADMIN ════════════════════════════════════════════════
  if(view==="admin") return <div style={{minHeight:"100vh",background:DK,fontFamily:"Arial,sans-serif",color:"#1a1a1a"}}>
    {Hdr}{modal&&<ClientModal/>}
    {cartOpen&&<CartPanel cart={cart} setCart={setCart} session={session} db={db} onClose={()=>setCartOpen(false)} mob={mob}/>}
    {/* FAB carrito — siempre visible en admin */}
    {!cartOpen&&<CartFAB cart={cart} onClick={()=>setCartOpen(true)} mob={mob}/>}

    <div style={{background:CD,display:"flex",borderBottom:"1px solid "+BD,padding:mob?"0 8px":"0 24px",overflowX:"auto",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
      {[["products","📦 PRODUCTOS"],["clients","👥 CLIENTES"],
        ["quotes","📋 COTIZACIONES"],
        ...(canDo(session,"config")?[["settings","⚙️ CONFIG"]]:[])]
        .map(([k,l])=>(
        <button key={k} onClick={()=>{setTab(k);if(k==="quotes")loadQuotes();}} style={{padding:mob?"10px 12px":"11px 18px",background:"none",border:"none",
          color:tab===k?OR:GRL,borderBottom:tab===k?"2px solid "+OR:"2px solid transparent",
          cursor:"pointer",fontSize:mob?11:12,fontWeight:700,letterSpacing:1,marginBottom:-1,whiteSpace:"nowrap"}}>{l}</button>
      ))}
    </div>
    <div style={{padding:mob?12:24,maxWidth:1400,margin:"0 auto"}}>

      {tab==="products"&&<div>
        <div style={{background:CD,border:"1px solid "+BD,borderRadius:6,padding:14,marginBottom:14,
          display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
          <div style={{flex:1,minWidth:180}}>
            <div style={{fontWeight:700,fontSize:12,marginBottom:3}}>ACTUALIZAR CATÁLOGO</div>
            <div style={{color:GRL,fontSize:11}}>CSV — Excel: Archivo → Guardar como → CSV UTF-8</div>
            <div style={{color:"#bbb",fontSize:10,marginTop:2}}>Columnas: CODIGO, DESCRIPCION, GDL1, GDL3, AGS, COL, LEN, CUL, PUBLICO, DISTRIBUIDOR, ASOCIADO</div>
          </div>
          <input type="file" accept=".csv,.tsv,.txt" ref={fref} onChange={handleFile} style={{display:"none"}}/>
          <Btn onClick={()=>{setMsg("");fref.current.click();}}>SUBIR CSV</Btn>
          <button onClick={loadProducts} style={{background:"#f0f0f0",color:GRL,border:"1px solid "+BD,padding:"9px 14px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:700}}>↻ RECARGAR</button>
          {msg&&<div style={{fontSize:11,width:"100%",padding:"8px 12px",borderRadius:4,
            background:msg.startsWith("✅")?"#f0fdf4":msg.startsWith("❌")?"#fef2f2":"#fffbeb",
            color:msg.startsWith("✅")?"#16a34a":msg.startsWith("❌")?"#dc2626":"#d97706",
            border:`1px solid ${msg.startsWith("✅")?"#bbf7d0":msg.startsWith("❌")?"#fecaca":"#fde68a"}`}}>{msg}</div>}
        </div>
        <Buscador search={search} ds={ds} onChange={setSearch} count={filtered.length} mob={mob}/>
        {prodLoad&&<div style={{textAlign:"center",padding:20,color:GRL}}>Cargando productos...</div>}
        {!prodLoad&&<div style={{overflowX:"auto",border:"1px solid "+BD,borderRadius:6,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead><tr style={{background:"#f0f0f0"}}>
              <th style={{padding:"8px 10px",textAlign:"left",color:OR,fontWeight:700,whiteSpace:"nowrap"}}>CÓDIGO</th>
              <th style={{padding:"8px 10px",textAlign:"left",color:OR,fontWeight:700}}>DESCRIPCIÓN</th>
              <th style={{padding:"8px 6px",textAlign:"right",color:OR,fontWeight:700}}>STOCK</th>
              {!mob&&ALMS_L.map(a=><th key={a} style={{padding:"8px 5px",textAlign:"right",color:GRL,whiteSpace:"nowrap"}}>{a}</th>)}
              <th style={{padding:"8px 6px",textAlign:"center",color:GRL}}>DISP</th>
              <th style={{padding:"8px 6px",textAlign:"right",color:"#16a34a",fontWeight:700}}>PÚB</th>
              <th style={{padding:"8px 6px",textAlign:"right",color:"#2563eb",fontWeight:700}}>DIST</th>
              <th style={{padding:"8px 6px",textAlign:"right",color:"#ea580c",fontWeight:700}}>ASOC</th>
              <th style={{padding:"8px 6px",width:34}}></th>
            </tr></thead>
            <tbody>{filtered.slice(page*PS,(page+1)*PS).map((p,i)=>{
              const tot=calcTotal(p),disp=tot>0;
              return <tr key={i} style={{borderTop:"1px solid "+BD,background:i%2===0?CD:"#fafafa"}}>
                <td style={{padding:"6px 10px",fontFamily:"monospace",color:GRL,whiteSpace:"nowrap"}}>{p.codigo}</td>
                <td style={{padding:"6px 10px",minWidth:mob?140:300}}>{p.descripcion}</td>
                <td style={{padding:"6px 6px",textAlign:"right",fontWeight:700,color:nColor(tot)}}>{stockVis(tot)}</td>
                {!mob&&ALMS.map(a=>{const v=Number(p[a])||0;return<td key={a} style={{padding:"6px 5px",textAlign:"right",color:v>0?"#5a5a5a":"#ddd"}}>{v>0?(v>=30?"+30":v):"—"}</td>;})}
                <td style={{padding:"6px 6px",textAlign:"center"}}><span style={{color:disp?"#16a34a":"#dc2626",fontWeight:700,fontSize:10}}>{disp?"SÍ":"NO"}</span></td>
                <td style={{padding:"6px 6px",textAlign:"right",color:"#16a34a"}}>{money(p.publico)}</td>
                <td style={{padding:"6px 6px",textAlign:"right",color:"#2563eb"}}>{money(p.distribuidor)}</td>
                <td style={{padding:"6px 6px",textAlign:"right",color:"#ea580c"}}>{money(p.asociado)}</td>
                <td style={{padding:"6px 6px"}}>
                  <button onClick={()=>addToCart(p)} title="Agregar a cotización"
                    style={{background:OR,color:"#fff",border:"none",borderRadius:4,width:26,height:26,cursor:"pointer",fontSize:14,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>＋</button>
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
        <Pager total={filtered.length} pg={page} setPg={setPage} ps={PS}/>
      </div>}

      {tab==="clients"&&<div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div>
            <span style={{color:GRL,fontSize:11}}>{users.length} usuarios registrados</span>
            {userLoad&&<span style={{color:OR,fontSize:11,marginLeft:8}}>cargando...</span>}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={loadUsers} style={{background:"#f0f0f0",color:GRL,border:"1px solid "+BD,padding:"8px 14px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:700}}>↻ RECARGAR</button>
            <Btn onClick={()=>setModal({mode:"create",data:{}})}>+ NUEVO CLIENTE</Btn>
          </div>
        </div>
        {mob?(
          <div>{users.map(u=><div key={u.id} style={{background:u.rol==="admin"||u.rol==="superadmin"?"#eff6ff":CD,border:"1px solid "+(u.rol==="admin"||u.rol==="superadmin"?"#bfdbfe":BD),borderRadius:6,padding:14,marginBottom:8,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <div>
                <div style={{fontWeight:700,fontSize:13}}>{u.nombre}{(u.rol==="admin"||u.rol==="superadmin")&&<span style={{marginLeft:6,fontSize:9,background:"#dbeafe",color:"#2563eb",padding:"1px 6px",borderRadius:3,fontWeight:700}}>{u.rol==="superadmin"?"SUPERADMIN":"ADMIN"}</span>}</div>
                {u.empresa&&<div style={{color:GRL,fontSize:11}}>{u.empresa}</div>}
              </div>
              <Badge val={u.estatus}/>
            </div>
            <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
              <Badge val={u.rol==="superadmin"?"superadmin":u.rol==="admin"?"admin":u.lista}/>
              <span style={{color:GRL,fontSize:11,fontFamily:"monospace"}}>@{u.usuario}</span>
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {(u.rol!=="admin"&&u.rol!=="superadmin")&&<Btn sm onClick={()=>setModal({mode:"edit",data:{...u}})}>EDITAR</Btn>}
              {(u.rol!=="admin"&&u.rol!=="superadmin")&&<Btn sm ghost onClick={()=>toggleEstatus(u.id,u.estatus)}>{u.estatus==="activo"?"DESACTIVAR":"ACTIVAR"}</Btn>}
              {u.id!==session?.id&&<Btn sm danger onClick={()=>deleteClient(u.id,u.nombre,u.rol)}>ELIMINAR</Btn>}
            </div>
          </div>)}</div>
        ):(
          <div style={{border:"1px solid "+BD,borderRadius:6,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr style={{background:"#f0f0f0"}}>{["NOMBRE","EMPRESA","USUARIO","CONTRASEÑA","ROL","TIPO/LISTA","ESTATUS","ACCIONES"].map(h=><th key={h} style={{padding:"9px 14px",textAlign:"left",color:OR,fontWeight:700,fontSize:10,letterSpacing:1}}>{h}</th>)}</tr></thead>
              <tbody>{users.map((u,i)=><tr key={u.id} style={{borderTop:"1px solid "+BD,background:(u.rol==="admin"||u.rol==="superadmin")?"#eff6ff":i%2===0?CD:"#fafafa"}}>
                <td style={{padding:"9px 14px",fontWeight:600}}>{u.nombre}{(u.rol==="admin"||u.rol==="superadmin")&&<span style={{marginLeft:6,fontSize:9,background:"#dbeafe",color:"#2563eb",padding:"1px 6px",borderRadius:3,fontWeight:700}}>{u.rol==="superadmin"?"SUPERADMIN":"ADMIN"}</span>}</td>
                <td style={{padding:"9px 14px",color:GRL,fontSize:11}}>{u.empresa||"—"}</td>
                <td style={{padding:"9px 14px",fontFamily:"monospace",color:GRL,fontSize:11}}>{u.usuario}</td>
                <td style={{padding:"9px 14px"}}>
                  {(canDo(session,"config") || (u.rol!=="admin"&&u.rol!=="superadmin"))
                    ? <PassCell uid={u.id} db={db} hashPassword={hashPassword}/>
                    : <span style={{color:"#bbb",fontSize:11}}>—</span>}
                </td>
                <td style={{padding:"9px 14px"}}><Badge val={u.rol==="superadmin"?"superadmin":u.rol==="admin"?"admin":u.rol}/></td>
                <td style={{padding:"9px 14px"}}>{(u.rol==="admin"||u.rol==="superadmin")?<span style={{color:GRL,fontSize:11}}>—</span>:<Badge val={u.lista}/>}</td>
                <td style={{padding:"9px 14px"}}><Badge val={u.estatus}/></td>
                <td style={{padding:"9px 14px"}}><div style={{display:"flex",gap:6}}>
                  {(u.rol!=="admin"&&u.rol!=="superadmin")&&<Btn sm onClick={()=>setModal({mode:"edit",data:{...u}})}>EDITAR</Btn>}
                  {(u.rol!=="admin"&&u.rol!=="superadmin")&&<Btn sm ghost onClick={()=>toggleEstatus(u.id,u.estatus)}>{u.estatus==="activo"?"DESACTIVAR":"ACTIVAR"}</Btn>}
                  {u.id!==session?.id && canDo(session,"config") &&<Btn sm danger onClick={()=>deleteClient(u.id,u.nombre,u.rol)}>ELIMINAR</Btn>}
                  {u.id!==session?.id && !canDo(session,"config") && (u.rol!=="admin"&&u.rol!=="superadmin") &&<Btn sm danger onClick={()=>deleteClient(u.id,u.nombre,u.rol)}>ELIMINAR</Btn>}
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </div>}

      {tab==="settings"&&<div style={{maxWidth:520}}>
        <div style={{background:CD,border:"1px solid "+BD,borderRadius:6,padding:24,marginBottom:16,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
          <div style={{fontWeight:700,fontSize:13,color:OR,marginBottom:16}}>🔑 CAMBIAR MI CONTRASEÑA</div>
          <ChangePassword session={session} db={db} hashPassword={hashPassword} checkPassword={checkPassword}/>
        </div>
        <div style={{background:CD,border:"1px solid "+BD,borderRadius:6,padding:24,marginBottom:16,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
          <div style={{fontWeight:700,fontSize:13,color:OR,marginBottom:16}}>👤 CREAR USUARIO ADMINISTRADOR</div>
          <CreateAdmin session={session} db={db} hashPassword={hashPassword}/>
        </div>
        <div style={{background:CD,border:"1px solid "+BD,borderRadius:6,padding:24,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
          <div style={{fontWeight:700,fontSize:13,color:OR,marginBottom:12}}>ℹ️ INFORMACIÓN DEL SISTEMA</div>
          <div style={{color:GRL,fontSize:12,lineHeight:2}}>
            <div>🔥 Base de datos: <strong style={{color:"#1a1a1a"}}>Firebase Firestore</strong></div>
            <div>🌐 Proyecto: <strong style={{color:"#1a1a1a"}}>portal-tapatia</strong></div>
            <div>👤 Admin: <strong style={{color:"#1a1a1a"}}>{session?.nombre}</strong></div>
            <div>📦 Productos: <strong style={{color:"#1a1a1a"}}>{products.length}</strong></div>
            <div>👥 Clientes: <strong style={{color:"#1a1a1a"}}>{users.filter(u=>u.estatus==="activo").length} activos / {users.filter(u=>u.estatus==="inactivo").length} inactivos</strong></div>
          </div>
          <div style={{marginTop:16,display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={loadProducts} style={{background:"#f0f0f0",color:GRL,border:"1px solid "+BD,padding:"9px 16px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:700}}>↻ Recargar productos</button>
            <button onClick={loadUsers} style={{background:"#f0f0f0",color:GRL,border:"1px solid "+BD,padding:"9px 16px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:700}}>↻ Recargar clientes</button>
          </div>
        </div>
      </div>}

      {tab==="quotes"&&<div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
          <div>
            <span style={{fontWeight:700,fontSize:14,color:"#1a1a1a"}}>Historial de Cotizaciones</span>
            {(session?.rol==="admin"||session?.rol==="superadmin")&&
              <span style={{color:GRL,fontSize:11,marginLeft:10}}>— todas los usuarios</span>}
          </div>
          <button onClick={loadQuotes} style={{background:"#f0f0f0",color:GRL,border:"1px solid "+BD,padding:"8px 14px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:700}}>↻ RECARGAR</button>
        </div>
        {quotesLoad&&<div style={{textAlign:"center",padding:30,color:GRL}}>Cargando cotizaciones...</div>}
        {!quotesLoad&&quotes.length===0&&(
          <div style={{textAlign:"center",padding:"50px 20px",color:GRL}}>
            <div style={{fontSize:36,marginBottom:10}}>📋</div>
            <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>Sin cotizaciones aún</div>
            <div style={{fontSize:12}}>Las cotizaciones generadas aparecerán aquí</div>
          </div>
        )}
        {!quotesLoad&&quotes.length>0&&(
          mob?(
            <div>{quotes.map((q,i)=>(
              <div key={i} style={{background:CD,border:"1px solid "+BD,borderRadius:8,padding:14,marginBottom:10,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:13,color:OR}}>{q.folio}</div>
                    <div style={{color:GRL,fontSize:11,marginTop:2}}>{new Date(q.fecha).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})}</div>
                  </div>
                  <span style={{fontWeight:700,fontSize:13,color:"#1a1a1a"}}>{new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(q.subtotal||0)}</span>
                </div>
                <div style={{fontSize:12,color:GRL,marginBottom:4}}>Cliente: <strong style={{color:"#1a1a1a"}}>{q.cliente||q.empresa||q.nombre||"—"}</strong></div>
                {(session?.rol==="admin"||session?.rol==="superadmin")&&
                  <div style={{fontSize:11,color:GRL,marginBottom:8}}>Elaboró: {q.nombre} · @{q.usuario}</div>}
                <div style={{fontSize:11,color:GRL,marginBottom:10}}>{(q.items||[]).length} producto{(q.items||[]).length!==1?"s":""} · Vigencia: {q.vigencia||"—"}</div>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>setQuoteDetail(quoteDetail?.folio===q.folio?null:q)}
                    style={{flex:1,padding:"7px",background:"#f3f4f6",color:"#374151",border:"1px solid "+BD,borderRadius:5,cursor:"pointer",fontSize:11,fontWeight:600}}>
                    {quoteDetail?.folio===q.folio?"▲ Ocultar":"▼ Ver detalle"}
                  </button>
                  <button onClick={()=>generarPDF({folio:q.folio,session:{nombre:q.nombre,empresa:q.empresa||""},items:q.items||[],nota:q.nota||"",vigencia:q.vigencia||"7 días naturales",clienteLabel:q.cliente||q.empresa||q.nombre||"Público en general"})}
                    style={{flex:2,padding:"7px",background:OR,color:"#fff",border:"none",borderRadius:5,cursor:"pointer",fontSize:11,fontWeight:700}}>
                    📄 Regenerar PDF
                  </button>
                </div>
                {quoteDetail?.folio===q.folio&&(
                  <div style={{marginTop:10,borderTop:"1px solid "+BD,paddingTop:10}}>
                    <div style={{fontSize:10,color:GRL,fontWeight:700,marginBottom:6}}>PRODUCTOS</div>
                    {(q.items||[]).map((it,j)=>(
                      <div key={j} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"4px 0",borderBottom:"1px solid #f3f4f6"}}>
                        <div style={{flex:1}}><span style={{fontFamily:"monospace",color:GRL,fontSize:10}}>{it.codigo}</span><br/>{it.descripcion}</div>
                        <div style={{textAlign:"right",marginLeft:8,whiteSpace:"nowrap"}}>
                          <div>{it.cantidad} pz</div>
                          <div style={{fontWeight:700,color:OR}}>{new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format((it.precio||0)*(it.cantidad||1))}</div>
                        </div>
                      </div>
                    ))}
                    {q.nota&&<div style={{marginTop:6,fontSize:11,color:GRL}}>Obs: {q.nota}</div>}
                  </div>
                )}
              </div>
            ))}</div>
          ):(
            <div style={{border:"1px solid "+BD,borderRadius:6,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:"#f0f0f0"}}>
                  {["FOLIO","FECHA","CLIENTE",...((session?.rol==="admin"||session?.rol==="superadmin")?["ELABORÓ"]:[]),"PRODUCTOS","SUBTOTAL","VIGENCIA","ACCIONES"]
                    .map(h=><th key={h} style={{padding:"9px 12px",textAlign:"left",color:OR,fontWeight:700,fontSize:10,letterSpacing:1,whiteSpace:"nowrap"}}>{h}</th>)}
                </tr></thead>
                <tbody>{quotes.map((q,i)=>(
                  <React.Fragment key={i}>
                    <tr style={{borderTop:"1px solid "+BD,background:i%2===0?CD:"#fafafa"}}>
                      <td style={{padding:"9px 12px",fontWeight:700,color:OR,whiteSpace:"nowrap"}}>{q.folio}</td>
                      <td style={{padding:"9px 12px",color:GRL,whiteSpace:"nowrap"}}>{new Date(q.fecha).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})}</td>
                      <td style={{padding:"9px 12px",fontWeight:600}}>{q.cliente||q.empresa||q.nombre||"—"}</td>
                      {(session?.rol==="admin"||session?.rol==="superadmin")&&
                        <td style={{padding:"9px 12px",color:GRL,fontSize:11}}>{q.nombre}<br/><span style={{fontFamily:"monospace",fontSize:10}}>@{q.usuario}</span></td>}
                      <td style={{padding:"9px 12px",textAlign:"center",color:GRL}}>{(q.items||[]).length}</td>
                      <td style={{padding:"9px 12px",fontWeight:700,color:"#1a1a1a",whiteSpace:"nowrap"}}>{new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(q.subtotal||0)}</td>
                      <td style={{padding:"9px 12px",color:GRL,fontSize:11,whiteSpace:"nowrap"}}>{q.vigencia||"—"}</td>
                      <td style={{padding:"9px 12px"}}>
                        <div style={{display:"flex",gap:6}}>
                          <button onClick={()=>setQuoteDetail(quoteDetail?.folio===q.folio?null:q)}
                            style={{padding:"5px 10px",background:"#f3f4f6",color:"#374151",border:"1px solid "+BD,borderRadius:4,cursor:"pointer",fontSize:10,fontWeight:600,whiteSpace:"nowrap"}}>
                            {quoteDetail?.folio===q.folio?"▲ Ocultar":"▼ Detalle"}
                          </button>
                          <button onClick={()=>generarPDF({folio:q.folio,session:{nombre:q.nombre,empresa:q.empresa||""},items:q.items||[],nota:q.nota||"",vigencia:q.vigencia||"15 días naturales",clienteLabel:q.cliente||q.empresa||q.nombre||"Público en general"})}
                            style={{padding:"5px 10px",background:OR,color:"#fff",border:"none",borderRadius:4,cursor:"pointer",fontSize:10,fontWeight:700,whiteSpace:"nowrap"}}>
                            📄 PDF
                          </button>
                        </div>
                      </td>
                    </tr>
                    {quoteDetail?.folio===q.folio&&(
                      <tr style={{background:"#fffbf5"}}>
                        <td colSpan={9} style={{padding:"12px 16px",borderTop:"1px solid #fde68a"}}>
                          <div style={{fontSize:11,fontWeight:700,color:OR,marginBottom:8}}>DETALLE DE PRODUCTOS</div>
                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                            <thead><tr style={{background:"#fff7ed"}}>
                              {["CÓDIGO","DESCRIPCIÓN","CANT.","P. UNIT.","IMPORTE"].map(h=>(
                                <th key={h} style={{padding:"5px 8px",textAlign:"left",color:GRL,fontWeight:700,fontSize:10}}>{h}</th>
                              ))}
                            </tr></thead>
                            <tbody>{(q.items||[]).map((it,j)=>(
                              <tr key={j} style={{borderTop:"1px solid #fde68a"}}>
                                <td style={{padding:"5px 8px",fontFamily:"monospace",color:GRL,fontSize:10}}>{it.codigo}</td>
                                <td style={{padding:"5px 8px"}}>{it.descripcion}</td>
                                <td style={{padding:"5px 8px",textAlign:"center"}}>{it.cantidad}</td>
                                <td style={{padding:"5px 8px",textAlign:"right"}}>{new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(it.precio||0)}</td>
                                <td style={{padding:"5px 8px",textAlign:"right",fontWeight:700,color:OR}}>{new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format((it.precio||0)*(it.cantidad||1))}</td>
                              </tr>
                            ))}</tbody>
                          </table>
                          {q.nota&&<div style={{marginTop:8,fontSize:11,color:GRL}}>📝 <strong>Observaciones:</strong> {q.nota}</div>}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}</tbody>
              </table>
            </div>
          )
        )}
      </div>}
    </div>
  </div>;

  // ════ CLIENTE / VENDEDOR ════════════════════════════════════
  const lista=session?.lista, isVend=lista==="VENDEDOR"||session?.rol==="admin"||session?.rol==="superadmin";
  const [clienteTab, setClienteTab] = useState("catalog");
  return <div style={{minHeight:"100vh",background:DK,fontFamily:"Arial,sans-serif",color:"#1a1a1a"}}>
    {cartOpen&&<CartPanel cart={cart} setCart={setCart} session={session} db={db} onClose={()=>setCartOpen(false)} mob={mob}/>}
    {/* FAB carrito — siempre visible en cliente */}
    {!cartOpen&&<CartFAB cart={cart} onClick={()=>setCartOpen(true)} mob={mob}/>}
    {Hdr}
    {/* Tabs cliente */}
    <div style={{background:CD,display:"flex",borderBottom:"1px solid "+BD,padding:mob?"0 8px":"0 20px",overflowX:"auto",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
      {[["catalog","🏷️ CATÁLOGO"],["quotes","📋 MIS COTIZACIONES"]].map(([k,l])=>(
        <button key={k} onClick={()=>{setClienteTab(k);if(k==="quotes")loadQuotes();}}
          style={{padding:mob?"10px 12px":"11px 18px",background:"none",border:"none",
            color:clienteTab===k?OR:GRL,borderBottom:clienteTab===k?"2px solid "+OR:"2px solid transparent",
            cursor:"pointer",fontSize:mob?11:12,fontWeight:700,letterSpacing:1,marginBottom:-1,whiteSpace:"nowrap"}}>{l}</button>
      ))}
    </div>
    <div style={{background:"linear-gradient(90deg,#e05500,#c44a00)",padding:"8px "+(mob?"12px":"24px"),display:"flex",alignItems:"center",gap:8}}>
      <span style={{color:"#fff",fontSize:14}}>★</span>
      <span style={{color:"#fff",fontSize:mob?11:13,fontWeight:700}}>CONTADO ANTICIPADO: <span style={{color:"#ffe0c0"}}>3% DESCUENTO ADICIONAL</span></span>
    </div>
    <div style={{background:"linear-gradient(90deg,#1e40af,#1d4ed8,#2563eb)",padding:"10px "+(mob?"12px":"24px"),display:"flex",alignItems:"center",justifyContent:"center",gap:10,boxShadow:"inset 0 -2px 0 rgba(0,0,0,0.15)"}}>
      <span style={{fontSize:mob?16:18}}>💳</span>
      <span style={{color:"#fff",fontSize:mob?11:13,fontWeight:600,letterSpacing:0.3}}>
        ¡Solicita tus compras hasta con{" "}
        <span style={{color:"#fbbf24",fontWeight:800,fontSize:mob?13:15}}>90 días de crédito</span>
        {" "}con{" "}
        <span style={{color:"#93c5fd",fontWeight:800,fontStyle:"italic"}}>Tapatía Credit</span>
        <span style={{color:"#fbbf24",fontWeight:800}}>!</span>
      </span>
      <span style={{fontSize:mob?14:16}}>🏆</span>
    </div>
    <div style={{padding:mob?12:20,maxWidth:1400,margin:"0 auto"}}>
      <div style={{background:"#fff7ed",borderLeft:"3px solid "+OR,border:"1px solid #fed7aa",borderRadius:4,padding:"8px 13px",marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
        <span style={{color:OR,fontWeight:700}}>i</span>
        <span style={{color:GRL,fontSize:11}}>
          Precios <strong style={{color:"#1a1a1a"}}>antes de IVA</strong>. El impuesto se aplicará al facturar.{" "}
          <strong style={{color:"#dc2626"}}>Productos agrícolas no causan IVA.</strong>
        </span>
      </div>
      {isVend&&<div style={{background:"#f3e8ff",border:"1px solid #d8b4fe",borderRadius:4,padding:"8px 13px",marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
        <span style={{color:"#9333ea",fontWeight:700}}>★</span>
        <span style={{color:"#9333ea",fontSize:11,fontWeight:700}}>Modo Vendedor — Todos los precios visibles</span>
      </div>}
      {clienteTab==="catalog"&&<>
      {prodLoad&&<div style={{textAlign:"center",padding:40,color:GRL}}>Cargando productos de Firebase...</div>}
      {!prodLoad&&<>
        <Buscador search={search} ds={ds} onChange={setSearch} count={filtered.length} mob={mob}/>
        {mob?(
          <div>{filtered.slice(page*PS,(page+1)*PS).map((p,i)=>{
            const tot=calcTotal(p),disp=tot>0;
            return <div key={i} style={{background:CD,border:"1px solid "+BD,borderRadius:6,padding:12,marginBottom:8,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
              <div style={{fontFamily:"monospace",color:GRL,fontSize:10,marginBottom:2}}>{p.codigo}</div>
              <div style={{fontSize:12,fontWeight:600,marginBottom:8,lineHeight:1.4}}>{p.descripcion}</div>
              {isVend?<div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
                <div style={{background:"#f0fdf4",borderRadius:4,padding:"4px 8px"}}><div style={{color:GRL,fontSize:9}}>PÚBLICO</div><div style={{color:"#16a34a",fontWeight:700,fontSize:12}}>{money(p.publico)}</div></div>
                <div style={{background:"#eff6ff",borderRadius:4,padding:"4px 8px"}}><div style={{color:GRL,fontSize:9}}>DISTRIBUIDOR</div><div style={{color:"#2563eb",fontWeight:700,fontSize:12}}>{money(p.distribuidor)}</div></div>
                <div style={{background:"#fff7ed",borderRadius:4,padding:"4px 8px"}}><div style={{color:GRL,fontSize:9}}>ASOCIADO</div><div style={{color:"#ea580c",fontWeight:700,fontSize:12}}>{money(p.asociado)}</div></div>
              </div>:<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <span style={{color:GRL,fontSize:10}}>Almacén ppal: <strong>{almPpal(p)}</strong></span>
                <span style={{color:OR,fontWeight:700,fontSize:14}}>{money(getPrecio(p,lista))}</span>
              </div>}
              <div style={{display:"flex",gap:8,marginBottom:6,flexWrap:"wrap",alignItems:"center"}}>
                <span style={{color:nColor(tot),fontWeight:700,fontSize:11}}>Total: {stockVis(tot)}</span>
                <span style={{color:disp?"#16a34a":"#dc2626",fontSize:11,fontWeight:700}}>{disp?"● Disponible":"● Sin stock"}</span>
              </div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
                {ALMS.map((a,idx)=>{
                  const v=Number(p[a])||0;
                  return <div key={a} style={{background:v>0?"#f0fdf4":"#f9f9f9",border:"1px solid "+(v>0?"#bbf7d0":BD),borderRadius:3,padding:"2px 7px",textAlign:"center"}}>
                    <div style={{fontSize:9,color:GRL}}>{ALMS_L[idx]}</div>
                    <div style={{fontSize:11,fontWeight:700,color:v>0?nColor(v):"#ccc"}}>{v>=30?"+30":v}</div>
                  </div>;
                })}
              </div>
              <button onClick={()=>addToCart(p)}
                style={{width:"100%",padding:"8px",background:OR,color:"#fff",border:"none",borderRadius:4,cursor:"pointer",fontWeight:700,fontSize:12,letterSpacing:1}}>
                ＋ AGREGAR A COTIZACIÓN
              </button>
            </div>;
          })}</div>
        ):(
          <div style={{overflowX:"auto",border:"1px solid "+BD,borderRadius:6,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr style={{background:"#f0f0f0"}}>
                <th style={{padding:"9px 12px",textAlign:"left",color:OR,fontWeight:700,whiteSpace:"nowrap"}}>CÓDIGO</th>
                <th style={{padding:"9px 12px",textAlign:"left",color:OR,fontWeight:700}}>DESCRIPCIÓN</th>
                {isVend?<>
                  <th style={{padding:"9px 8px",textAlign:"right",color:"#16a34a",fontWeight:700}}>PÚBLICO</th>
                  <th style={{padding:"9px 8px",textAlign:"right",color:"#2563eb",fontWeight:700}}>DISTRIBUIDOR</th>
                  <th style={{padding:"9px 8px",textAlign:"right",color:"#ea580c",fontWeight:700}}>ASOCIADO</th>
                </>:<th style={{padding:"9px 10px",textAlign:"right",color:OR,fontWeight:700}}>PRECIO</th>}
                <th style={{padding:"9px 8px",textAlign:"right",color:OR,fontWeight:700}}>TOTAL</th>
                <th style={{padding:"9px 8px",textAlign:"center",color:GRL,fontSize:10}}>PPAL</th>
                {ALMS_L.map(a=><th key={a} style={{padding:"9px 6px",textAlign:"right",color:GRL,fontSize:10,whiteSpace:"nowrap"}}>{a}</th>)}
                <th style={{padding:"9px 8px",textAlign:"center",color:GRL,fontSize:10}}>DISP.</th>
                <th style={{padding:"9px 6px",width:34}}></th>
              </tr></thead>
              <tbody>{filtered.slice(page*PS,(page+1)*PS).map((p,i)=>{
                const tot=calcTotal(p),disp=tot>0;
                return <tr key={i} style={{borderTop:"1px solid "+BD,background:i%2===0?CD:"#fafafa"}}>
                  <td style={{padding:"7px 12px",fontFamily:"monospace",color:GRL,whiteSpace:"nowrap",fontSize:11}}>{p.codigo}</td>
                  <td style={{padding:"7px 12px",minWidth:260}}>{p.descripcion}</td>
                  {isVend?<>
                    <td style={{padding:"7px 8px",textAlign:"right",color:"#16a34a",fontWeight:600}}>{money(p.publico)}</td>
                    <td style={{padding:"7px 8px",textAlign:"right",color:"#2563eb",fontWeight:600}}>{money(p.distribuidor)}</td>
                    <td style={{padding:"7px 8px",textAlign:"right",color:"#ea580c",fontWeight:600}}>{money(p.asociado)}</td>
                  </>:<td style={{padding:"7px 10px",textAlign:"right",fontWeight:700,color:OR,whiteSpace:"nowrap"}}>{money(getPrecio(p,lista))}</td>}
                  <td style={{padding:"7px 8px",textAlign:"right",fontWeight:700,color:nColor(tot)}}>{stockVis(tot)}</td>
                  <td style={{padding:"7px 8px",textAlign:"center",color:GRL,fontSize:11}}>{almPpal(p)}</td>
                  {ALMS.map(a=>{
                    const v=Number(p[a])||0;
                    return <td key={a} style={{padding:"7px 6px",textAlign:"right",fontSize:11,color:v>0?nColor(v):"#ccc",fontWeight:v>0?600:400}}>{v>=30?"+30":v}</td>;
                  })}
                  <td style={{padding:"7px 8px",textAlign:"center"}}><span style={{color:disp?"#16a34a":"#dc2626",fontWeight:700,fontSize:10}}>{disp?"SÍ":"NO"}</span></td>
                  <td style={{padding:"6px 8px"}}>
                    <button onClick={()=>addToCart(p)} title="Agregar a cotización"
                      style={{background:OR,color:"#fff",border:"none",borderRadius:4,width:26,height:26,cursor:"pointer",fontSize:14,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>＋</button>
                  </td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
        <Pager total={filtered.length} pg={page} setPg={setPage} ps={PS}/>
      </>}
      </>}

      {clienteTab==="quotes"&&<div style={{marginTop:8}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
          <span style={{fontWeight:700,fontSize:14,color:"#1a1a1a"}}>Mis Cotizaciones</span>
          <button onClick={loadQuotes} style={{background:"#f0f0f0",color:GRL,border:"1px solid "+BD,padding:"8px 14px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:700}}>↻ RECARGAR</button>
        </div>
        {quotesLoad&&<div style={{textAlign:"center",padding:30,color:GRL}}>Cargando cotizaciones...</div>}
        {!quotesLoad&&quotes.length===0&&(
          <div style={{textAlign:"center",padding:"50px 20px",color:GRL}}>
            <div style={{fontSize:36,marginBottom:10}}>📋</div>
            <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>Sin cotizaciones aún</div>
            <div style={{fontSize:12}}>Las cotizaciones que generes aparecerán aquí</div>
          </div>
        )}
        {!quotesLoad&&quotes.map((q,i)=>(
          <div key={i} style={{background:CD,border:"1px solid "+BD,borderRadius:8,padding:14,marginBottom:10,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div>
                <div style={{fontWeight:700,fontSize:13,color:OR}}>{q.folio}</div>
                <div style={{color:GRL,fontSize:11,marginTop:2}}>{new Date(q.fecha).toLocaleDateString("es-MX",{day:"2-digit",month:"long",year:"numeric"})}</div>
              </div>
              <span style={{fontWeight:700,fontSize:14,color:"#1a1a1a"}}>{new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(q.subtotal||0)}</span>
            </div>
            <div style={{fontSize:12,color:GRL,marginBottom:4}}>Cliente: <strong style={{color:"#1a1a1a"}}>{q.cliente||q.empresa||q.nombre||"—"}</strong></div>
            <div style={{fontSize:11,color:GRL,marginBottom:10}}>{(q.items||[]).length} producto{(q.items||[]).length!==1?"s":""} · Vigencia: {q.vigencia||"—"}</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              <button onClick={()=>setQuoteDetail(quoteDetail?.folio===q.folio?null:q)}
                style={{flex:1,padding:"8px",background:"#f3f4f6",color:"#374151",border:"1px solid "+BD,borderRadius:5,cursor:"pointer",fontSize:11,fontWeight:600}}>
                {quoteDetail?.folio===q.folio?"▲ Ocultar detalle":"▼ Ver detalle"}
              </button>
              <button onClick={()=>generarPDF({folio:q.folio,session:{nombre:q.nombre,empresa:q.empresa||""},items:q.items||[],nota:q.nota||"",vigencia:q.vigencia||"15 días naturales",clienteLabel:q.cliente||q.empresa||q.nombre||"Público en general"})}
                style={{flex:2,padding:"8px",background:OR,color:"#fff",border:"none",borderRadius:5,cursor:"pointer",fontSize:11,fontWeight:700}}>
                📄 Regenerar PDF
              </button>
            </div>
            {quoteDetail?.folio===q.folio&&(
              <div style={{marginTop:10,borderTop:"1px solid "+BD,paddingTop:10}}>
                <div style={{fontSize:10,color:GRL,fontWeight:700,marginBottom:6}}>PRODUCTOS</div>
                {(q.items||[]).map((it,j)=>(
                  <div key={j} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"5px 0",borderBottom:"1px solid #f3f4f6"}}>
                    <div style={{flex:1}}>
                      <span style={{fontFamily:"monospace",color:GRL,fontSize:10}}>{it.codigo}</span>
                      <div style={{marginTop:1}}>{it.descripcion}</div>
                    </div>
                    <div style={{textAlign:"right",marginLeft:8,whiteSpace:"nowrap"}}>
                      <div style={{color:GRL,fontSize:10}}>{it.cantidad} pz × {new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(it.precio||0)}</div>
                      <div style={{fontWeight:700,color:OR}}>{new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format((it.precio||0)*(it.cantidad||1))}</div>
                    </div>
                  </div>
                ))}
                {q.nota&&<div style={{marginTop:8,fontSize:11,color:GRL}}>📝 {q.nota}</div>}
              </div>
            )}
          </div>
        ))}
      </div>}
    </div>
  </div>;
}