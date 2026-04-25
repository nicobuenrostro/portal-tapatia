import { useState, useEffect, useMemo, useRef } from "react";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, getDocs, doc, setDoc,
  deleteDoc, writeBatch, getDoc
} from "firebase/firestore";
import jsPDF from "jspdf";
import "jspdf-autotable";

// ── Firebase ──────────────────────────────────────────────────
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

// ── Constantes ────────────────────────────────────────────────
const OR   = "#FF6B06";
const GRL  = "#6b6b6b";
const DK   = "#f4f4f4";
const CD   = "#ffffff";
const BD   = "#e0e0e0";
const ALMS   = ["gdl1","gdl3","ags","col","len","cul"];
const ALMS_L = ["GDL1","GDL3","AGS","COL","LEN","CUL"];
const LOGO_URL = "https://raw.githubusercontent.com/nicobuenrostro/portal-tapatia/main/logo.png";

// ── Helpers ───────────────────────────────────────────────────
const safe    = v => String(v??"").trim();
const safeNum = v => { const n=Number(v); return isNaN(n)?0:n; };
const money   = n => { const v=safeNum(n); return v===0?"—":new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN",minimumFractionDigits:2}).format(v); };
const money2  = n => new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN",minimumFractionDigits:2}).format(safeNum(n));
const calcTotal = p => ALMS.reduce((t,a)=>t+safeNum(p[a]),0);
const stockVis  = t => t>=30?"+30":String(t);
const nColor    = t => t===0?"#dc2626":t<=5?"#ea580c":t<=20?"#d97706":"#16a34a";
const almPpal   = p => { const i=ALMS.findIndex(a=>safeNum(p[a])>0); return i>=0?ALMS_L[i]:"—"; };
const getPrecio = (p,l) => {
  const s=safe(l).toUpperCase();
  if(s==="DISTRIBUIDOR") return safeNum(p.distribuidor);
  if(s==="ASOCIADO")     return safeNum(p.asociado);
  return safeNum(p.publico);
};
// IVA desde columna CSV — acepta SI/NO, 1/0, TRUE/FALSE, 16/0
const tieneIVA = p => {
  const v=safe(p?.iva??p?.IVA??"").toUpperCase();
  return v!==""&&v!=="0"&&v!=="NO"&&v!=="N"&&v!=="FALSE";
};
const clampDesc = v => Math.min(30,Math.max(0,Math.round(parseInt(v)||0)));

// ── Hash SHA-256 ──────────────────────────────────────────────
async function hashPassword(pwd){
  const enc=new TextEncoder().encode(safe(pwd));
  const buf=await crypto.subtle.digest("SHA-256",enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function checkPassword(pwd,hash){ return await hashPassword(pwd)===hash; }

// ── Firebase helpers ──────────────────────────────────────────
async function fbGetUsuarios(){
  try {
    const snap=await getDocs(collection(db,"usuarios"));
    if(snap.empty) return [];
    return snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>safe(a.nombre).localeCompare(safe(b.nombre)));
  } catch(e){ console.error("fbGetUsuarios:",e); return null; }
}
async function fbGetProductos(){
  try {
    const snap=await getDocs(collection(db,"productos"));
    if(snap.empty) return [];
    return snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>safe(a.codigo).localeCompare(safe(b.codigo)));
  } catch(e){ console.error("fbGetProductos:",e); return null; }
}
async function fbGetCotizaciones(usuario,isAdmin){
  try {
    const snap=await getDocs(collection(db,"cotizaciones"));
    if(snap.empty) return [];
    let data=snap.docs.map(d=>({id:d.id,...d.data()}));
    if(!isAdmin) data=data.filter(c=>safe(c.usuario)===safe(usuario));
    return data.sort((a,b)=>new Date(b.fecha||0)-new Date(a.fecha||0));
  } catch(e){ console.error("fbGetCotizaciones:",e); return null; }
}

// ── Búsqueda ──────────────────────────────────────────────────
function cIn(s){return safe(s).toUpperCase();}
function strp(s){return safe(s).toUpperCase().replace(/[^0-9XR\.]/g,"");}
function getVariants(s){
  if(!s)return[];
  const c=safe(s).toUpperCase(),b=strp(c);
  const vars=[c,b,c.replace(/[\.\-\/\s]/g,""),c.replace(/[\.\-\/\sX]/g,"").replace("R","")];
  const nums=c.replace(/[XR]/g," ").replace(/[\.\-\/]/g," ").replace(/\s+/g," ").trim().split(" ").filter(x=>x.length>0);
  if(nums.length===3){vars.push(nums.join(""),nums[0]+"."+nums[1]+"-"+nums[2],nums[0]+nums[1]+"-"+nums[2],nums[0]+"."+nums[1]+"R"+nums[2],nums[0]+"-"+nums[1]+"-"+nums[2],nums[0]+" "+nums[1]+" "+nums[2]);}
  if(nums.length===2){vars.push(nums.join(""),nums[0]+"."+nums[1],nums[0]+"-"+nums[1]);}
  if(/^\d{5,6}$/.test(b)){
    [[2,1,2],[2,2,2],[3,2,2],[2,2,3]].forEach(([a,bv,cv])=>{
      if(b.length===a+bv+cv){const p1=b.slice(0,a),p2=b.slice(a,a+bv),p3=b.slice(a+bv);vars.push(p1+"."+p2+"-"+p3,p1+p2+"-"+p3,p1+"."+p2+"R"+p3,p1+" "+p2+" "+p3,p1+p2+p3);}
    });
  }
  const seen={};return vars.filter(v=>{const t=safe(v);return t&&!seen[t]&&(seen[t]=true);});
}
function exMedidas(desc){
  if(!desc)return[];
  const s=safe(desc).toUpperCase(),found=[];
  [/\d{3}\/\d{2}[R]\d{2,3}(?:\.\d)?/g,/\d{2,3}[X]\d{2,3}(?:\.\d{2})?[-R]\d{2,3}/g,
   /\d{1,3}\.\d{2,3}[-\/R]\d{2,3}/g,/\d{2}\.?\d{1,2}[-\/R]\d{2,3}/g,/\d{2,3}\s\d{1,3}\s\d{2,3}/g]
    .forEach(p=>(s.match(p)||[]).forEach(m=>found.push(m)));
  found.push(s);return found;
}
function smartMatch(q,p){
  if(!q||q.trim().length<2)return true;
  const desc=cIn(p.descripcion),cod=cIn(p.codigo);
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

// ── Permisos ──────────────────────────────────────────────────
function canDo(session,accion){
  const rol=session?.rol;
  if(rol==="superadmin") return true;
  if(rol==="admin") return ["productos","clientes","subir_csv","crear_cliente","editar_cliente","toggle_estatus","eliminar_cliente"].includes(accion);
  return false;
}
function isAdminRole(s){ return s?.rol==="admin"||s?.rol==="superadmin"; }
function isVendedor(s){ return s?.lista==="VENDEDOR"||isAdminRole(s); }

function parseCsv(text){
  const lines=text.trim().split(/\r?\n/);
  if(lines.length<2) return [];
  const first=lines[0];
  const delim=first.includes("\t")?"\t":first.includes(";")?";":","
  const headers=first.split(delim).map(h=>h.trim().replace(/"/g,""));
  return lines.slice(1).map(line=>{
    const vals=line.split(delim),obj={};
    headers.forEach((h,i)=>{const v=safe(vals[i]??"");obj[h]=(!isNaN(v)&&v!=="")?parseFloat(v):v;});
    return obj;
  }).filter(r=>r.CODIGO||r["CÓDIGO"]||r.codigo);
}

// ── UI Components ─────────────────────────────────────────────
function Badge({val}){
  const map={PUBLICO:{bg:"#dcfce7",c:"#16a34a"},PÚBLICO:{bg:"#dcfce7",c:"#16a34a"},DISTRIBUIDOR:{bg:"#dbeafe",c:"#2563eb"},ASOCIADO:{bg:"#fff7ed",c:"#ea580c"},VENDEDOR:{bg:"#f3e8ff",c:"#9333ea"},superadmin:{bg:"#fef3c7",c:"#d97706"},admin:{bg:"#dbeafe",c:"#2563eb"},client:{bg:"#f3f4f6",c:"#6b7280"},activo:{bg:"#dcfce7",c:"#16a34a"},inactivo:{bg:"#fee2e2",c:"#dc2626"}};
  const s=map[val]||{bg:"#f3f4f6",c:GRL};
  return <span style={{background:s.bg,color:s.c,padding:"2px 8px",borderRadius:3,fontSize:10,fontWeight:700,letterSpacing:1}}>{val}</span>;
}
function Inp({label,value,onChange,type="text",mb=12,placeholder=""}){
  return <div style={{marginBottom:mb}}>
    {label&&<div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>{label}</div>}
    <input type={type} value={value} onChange={onChange} placeholder={placeholder}
      style={{width:"100%",padding:"9px 11px",background:"#f7f7f7",border:"1px solid "+BD,color:"#1a1a1a",fontSize:13,borderRadius:4,boxSizing:"border-box",outline:"none"}}/>
  </div>;
}
function Btn({onClick,children,danger,ghost,sm,disabled}){
  const bg=disabled?"#e5e7eb":danger?"#fee2e2":ghost?"transparent":OR;
  const cl=disabled?"#9ca3af":danger?"#dc2626":ghost?GRL:"#fff";
  const br=danger?"1px solid #fca5a5":ghost?"1px solid "+BD:"none";
  return <button onClick={disabled?undefined:onClick} disabled={disabled}
    style={{background:bg,color:cl,border:br,padding:sm?"4px 10px":"9px 16px",borderRadius:4,cursor:disabled?"not-allowed":"pointer",fontWeight:700,fontSize:sm?10:12,letterSpacing:1,whiteSpace:"nowrap",opacity:disabled?0.6:1}}>
    {children}
  </button>;
}
function Logo({h=36}){
  return <img src={LOGO_URL} alt="Grupo Tapatía" style={{height:h,objectFit:"contain",maxWidth:280}}
    onError={e=>{e.target.style.display="none";}}/>;
}
function Buscador({search,ds,onChange,count,mob}){
  const tipo=ds.trim().length>=2?detectTipo(ds.trim()):"";
  const norm=ds.trim().length>=2?(getVariants(ds.trim())[0]||""):"";
  return <div style={{marginBottom:14}}>
    <input value={search} onChange={e=>onChange(e.target.value)}
      placeholder={mob?"Buscar medida o código...":"Buscar: código, descripción o medida (ej: 15538, 315/80R22.5, 10.00-20)..."}
      style={{width:"100%",padding:"10px 13px",background:"#f7f7f7",border:"1.5px solid "+OR,color:"#1a1a1a",fontSize:13,borderRadius:4,boxSizing:"border-box",outline:"none"}}/>
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

// ── PDF ───────────────────────────────────────────────────────
async function generarPDF({folio,session,items,nota,vigencia,descuento,clienteNombre}){
  // Sanitizar todo antes de tocar jsPDF
  const sfolio    = safe(folio)||"S/F";
  const snota     = safe(nota);
  const svig      = safe(vigencia)||"7 días naturales";
  const scliente  = safe(clienteNombre)||"Público en general";
  const sdesc     = clampDesc(descuento);
  const snombre   = safe(session?.nombre)||"—";
  const sitems    = Array.isArray(items)?items:[];
  const fecha     = new Date().toLocaleDateString("es-MX",{day:"2-digit",month:"long",year:"numeric"});

  const doc2=new jsPDF({orientation:"portrait",unit:"mm",format:"a4"});
  const W=210,M=15;

  // Header naranja
  doc2.setFillColor(255,107,6); doc2.rect(0,0,W,42,"F");

  // Logo imagen
  try {
    const resp=await fetch(LOGO_URL);
    const blob=await resp.blob();
    const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(blob);});
    doc2.addImage(b64,"PNG",M,4,38,20);
  } catch(e){
    doc2.setTextColor(255,255,255);doc2.setFontSize(16);doc2.setFont("helvetica","bold");
    doc2.text("GRUPO TAPATÍA",M,16);
  }

  doc2.setTextColor(255,255,255);doc2.setFontSize(7.5);doc2.setFont("helvetica","normal");
  doc2.text("Importadores de llantas agrícolas, industriales, jardinería y remolques",M,28);
  doc2.text("Tlaquepaque, Jalisco, México  |  ventas@llanteratapatia.com  |  www.tapatia.app",M,33);

  // Etiqueta cotización
  doc2.setFillColor(210,75,0);doc2.rect(138,0,72,42,"F");
  doc2.setTextColor(255,255,255);doc2.setFontSize(16);doc2.setFont("helvetica","bold");
  doc2.text("COTIZACIÓN",174,14,{align:"center"});
  doc2.setFontSize(11);doc2.text(sfolio,174,22,{align:"center"});
  doc2.setFontSize(9);doc2.setFont("helvetica","normal");doc2.text(fecha,174,29,{align:"center"});

  // Datos cotización
  let y=50;
  doc2.setFillColor(245,245,245);doc2.rect(M,y-4,W-M*2,26,"F");
  doc2.setDrawColor(230,230,230);doc2.setLineWidth(0.3);doc2.rect(M,y-4,W-M*2,26);
  doc2.setTextColor(OR);doc2.setFont("helvetica","bold");doc2.setFontSize(9);
  doc2.text("DATOS DE COTIZACIÓN",M+2,y+1);y+=6;

  const tf=(lbl,val,x1,x2)=>{
    doc2.setFont("helvetica","normal");doc2.setTextColor(80,80,80);doc2.setFontSize(8.5);doc2.text(lbl,x1,y);
    doc2.setFont("helvetica","bold");doc2.setTextColor(30,30,30);doc2.text(safe(val)||"—",x2,y);
  };
  tf("Folio:",sfolio,M+2,M+18);tf("Fecha:",fecha,100,116);y+=6;
  tf("Elaboró:",snombre,M+2,M+20);tf("Vigencia:",svig,100,116);y+=6;
  doc2.setFont("helvetica","normal");doc2.setTextColor(80,80,80);doc2.setFontSize(8.5);doc2.text("Cliente:",M+2,y);
  doc2.setFont("helvetica","bold");doc2.setTextColor(30,30,30);
  // Truncar cliente si es muy largo
  const clienteTxt=doc2.splitTextToSize(scliente,100)[0]||scliente;
  doc2.text(clienteTxt,M+20,y);

  // Clasificación IVA
  const conIvaItems=sitems.filter(it=>tieneIVA(it));
  const sinIvaItems=sitems.filter(it=>!tieneIVA(it));
  y+=10;
  if(conIvaItems.length===0){
    doc2.setFont("helvetica","bold");doc2.setFontSize(8);doc2.setTextColor(220,38,38);
    doc2.text("Productos sin IVA",M,y);
  } else if(sinIvaItems.length===0){
    doc2.setFont("helvetica","bold");doc2.setFontSize(8);doc2.setTextColor(37,99,235);
    doc2.text("Productos con IVA (16%)",M,y);
  } else {
    doc2.setFont("helvetica","bold");doc2.setFontSize(8);doc2.setTextColor(80,80,80);
    doc2.text("* Productos sin IVA marcados con asterisco",M,y);
  }
  y+=4;

  // Tabla productos
  const rows=sitems.map((it,i)=>[
    i+1,
    safe(it.codigo)||"—",
    (safe(it.descripcion)||"—")+(tieneIVA(it)?"":" *"),
    safeNum(it.cantidad),
    money2(it.precio),
    money2(safeNum(it.precio)*safeNum(it.cantidad)),
  ]);

  doc2.autoTable({
    startY:y,
    head:[["No.","CÓDIGO","DESCRIPCIÓN","CANT.","P. UNIT.","IMPORTE"]],
    body:rows,
    margin:{left:M,right:M},
    headStyles:{fillColor:[255,107,6],textColor:255,fontStyle:"bold",fontSize:8,halign:"center"},
    bodyStyles:{fontSize:7.5,textColor:[40,40,40]},
    columnStyles:{0:{halign:"center",cellWidth:8},1:{cellWidth:28},2:{cellWidth:82},3:{halign:"center",cellWidth:14},4:{halign:"right",cellWidth:26},5:{halign:"right",cellWidth:26}},
    alternateRowStyles:{fillColor:[250,250,250]},
    tableLineColor:[220,220,220],tableLineWidth:0.1,
    didParseCell:data=>{if(data.section==="body"&&data.column.index===2&&safe(data.cell.raw).endsWith(" *"))data.cell.styles.textColor=[180,30,30];}
  });

  // Totales
  const subtotal=sitems.reduce((s,it)=>s+safeNum(it.precio)*safeNum(it.cantidad),0);
  const ivaTotal=conIvaItems.reduce((s,it)=>s+safeNum(it.precio)*safeNum(it.cantidad)*0.16,0);
  const descMonto=sdesc>0?subtotal*(sdesc/100):0;
  const total=subtotal+ivaTotal-descMonto;

  const fy=doc2.lastAutoTable.finalY+5;
  const bx=118,bw=77;let ty=fy;
  const numRows=sdesc>0?3:2;
  doc2.setFillColor(248,248,248);doc2.rect(bx,ty-2,bw,numRows*6.5+4,"F");
  doc2.setDrawColor(220,220,220);doc2.setLineWidth(0.2);doc2.rect(bx,ty-2,bw,numRows*6.5+4);

  const trow=(lbl,val,color)=>{
    doc2.setFont("helvetica","normal");doc2.setFontSize(8.5);doc2.setTextColor(...(color||[80,80,80]));doc2.text(lbl,bx+2,ty+4);
    doc2.setFont("helvetica","bold");doc2.setTextColor(...(color||[30,30,30]));doc2.text(val,bx+bw-2,ty+4,{align:"right"});
    ty+=6.5;
  };
  trow("Subtotal:",money2(subtotal));
  trow("IVA:",money2(ivaTotal),ivaTotal===0?[180,180,180]:[37,99,235]);
  if(sdesc>0) trow(`Descuento (${sdesc}%):`,"-"+money2(descMonto),[200,30,30]);

  doc2.setDrawColor(255,107,6);doc2.setLineWidth(0.6);doc2.line(bx,ty+2,bx+bw,ty+2);
  doc2.setFillColor(255,107,6);doc2.rect(bx,ty+3,bw,9,"F");
  doc2.setTextColor(255,255,255);doc2.setFont("helvetica","bold");doc2.setFontSize(11);
  doc2.text("TOTAL:",bx+3,ty+9.5);
  doc2.text(money2(total),bx+bw-2,ty+9.5,{align:"right"});

  // Notas
  if(snota){
    const ny=ty+18;
    if(ny<265){
      doc2.setTextColor(60,60,60);doc2.setFont("helvetica","bold");doc2.setFontSize(8);
      doc2.text("OBSERVACIONES:",M,ny);
      doc2.setFont("helvetica","normal");doc2.setFontSize(7.5);
      doc2.text(doc2.splitTextToSize(snota,W-M*2-5),M,ny+5);
    }
  }

  // Datos bancarios
  const by=ty+20+(snota?12:0);
  if(by<268){
    doc2.setFillColor(245,245,245);doc2.rect(M,by,W-M*2,20,"F");
    doc2.setDrawColor(220,220,220);doc2.rect(M,by,W-M*2,20);
    doc2.setTextColor(OR);doc2.setFont("helvetica","bold");doc2.setFontSize(8);
    doc2.text("DATOS PARA DEPÓSITO / TRANSFERENCIA",M+2,by+5);
    doc2.setFontSize(7.5);
    doc2.setFont("helvetica","normal");doc2.setTextColor(80,80,80);doc2.text("Banco:",M+2,by+11);
    doc2.setFont("helvetica","bold");doc2.setTextColor(30,30,30);doc2.text("BBVA",M+16,by+11);
    doc2.setFont("helvetica","normal");doc2.setTextColor(80,80,80);doc2.text("Titular:",100,by+11);
    doc2.setFont("helvetica","bold");doc2.setTextColor(30,30,30);doc2.text("Comercial Llantera Tapatía SA de CV",118,by+11);
    doc2.setFont("helvetica","normal");doc2.setTextColor(80,80,80);doc2.text("No. Cuenta:",M+2,by+17);
    doc2.setFont("helvetica","bold");doc2.setTextColor(30,30,30);doc2.text("0154483138",M+26,by+17);
    doc2.setFont("helvetica","normal");doc2.setTextColor(80,80,80);doc2.text("CLABE:",100,by+17);
    doc2.setFont("helvetica","bold");doc2.setTextColor(30,30,30);doc2.text("012320001544831389",118,by+17);
  }

  // Footer
  doc2.setFillColor(255,107,6);doc2.rect(0,282,W,15,"F");
  doc2.setTextColor(255,255,255);doc2.setFont("helvetica","bold");doc2.setFontSize(7.5);
  doc2.text("Precios sujetos a cambio sin previo aviso. Sujeto a disponibilidad.",W/2,286,{align:"center"});
  doc2.setFont("helvetica","normal");
  doc2.text("Esta cotización es informativa y no constituye un pedido, factura ni compromiso de entrega.",W/2,290,{align:"center"});
  doc2.text(`Grupo Tapatía  |  tapatia.app  |  ${fecha}`,W/2,294,{align:"center"});

  doc2.save(`Cotizacion_${sfolio}.pdf`);
}

// ── CartPanel ─────────────────────────────────────────────────
function CartPanel({cart,setCart,session,db,onClose,mob}){
  const vend=isVendedor(session);
  const [nota,setNota]=useState("");
  const [vigencia,setVigencia]=useState("7 días naturales");
  const [descuento,setDescuento]=useState(0);
  const [clienteNombre,setClienteNombre]=useState("");
  const [generating,setGenerating]=useState(false);
  const [folioMsg,setFolioMsg]=useState("");

  const subtotal=cart.reduce((s,it)=>s+safeNum(it.precio)*safeNum(it.cantidad),0);
  const ivaTotal=cart.filter(it=>tieneIVA(it)).reduce((s,it)=>s+safeNum(it.precio)*safeNum(it.cantidad)*0.16,0);
  const descPct=clampDesc(descuento);
  const descMonto=vend&&descPct>0?subtotal*(descPct/100):0;
  const total=subtotal+ivaTotal-descMonto;

  function updCantidad(idx,val){const n=Math.max(1,parseInt(val)||1);setCart(prev=>prev.map((it,i)=>i===idx?{...it,cantidad:n}:it));}
  function updPrecio(idx,tipo){
    setCart(prev=>prev.map((it,i)=>{
      if(i!==idx)return it;
      const p=tipo==="publico"?it._publico:tipo==="distribuidor"?it._distribuidor:it._asociado;
      return{...it,precio:safeNum(p),tipoPrecio:tipo};
    }));
  }
  function remove(idx){setCart(prev=>prev.filter((_,i)=>i!==idx));}

  async function getNextFolio(){
    const uid=safe(session?.id||session?.usuario)||"unknown";
    const ref=doc(db,"folios",uid);
    const snap=await getDoc(ref);
    const current=snap.exists()?(safeNum(snap.data().ultimo)):0;
    const next=current+1;
    await setDoc(ref,{ultimo:next,usuario:safe(session?.usuario),actualizado:new Date().toISOString()},{merge:true});
    const prefix=safe(session?.usuario).substring(0,3).toUpperCase()||"USR";
    return`COT-${prefix}-${String(next).padStart(4,"0")}`;
  }

  async function generarCotizacion(){
    if(cart.length===0){setFolioMsg("❌ Agrega al menos un producto.");return;}
    setGenerating(true);setFolioMsg("Generando folio...");
    try{
      const folio=await getNextFolio();
      setFolioMsg(`📄 ${folio} — generando PDF...`);
      const descReal=vend?descPct:0;
      const nombreCliente=safe(clienteNombre)||"Público en general";
      await generarPDF({folio,session,items:cart,nota,vigencia,descuento:descReal,clienteNombre:nombreCliente});
      await setDoc(doc(db,"cotizaciones",folio),{
        folio,usuario:safe(session?.usuario),nombre:safe(session?.nombre),
        empresa:safe(session?.empresa),items:cart,
        subtotal,ivaTotal,descuento:descReal,total,
        clienteNombre:nombreCliente,nota:safe(nota),vigencia:safe(vigencia),
        fecha:new Date().toISOString(),
      });
      setFolioMsg(`✅ ${folio} generada y guardada.`);
      setTimeout(()=>{setCart([]);onClose();},2000);
    }catch(e){
      console.error("Error generarCotizacion:",e);
      setFolioMsg("❌ Error: "+safe(e.message));
    }
    setGenerating(false);
  }

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:2000,display:"flex",justifyContent:"flex-end",fontFamily:"Arial,sans-serif"}}>
      <div style={{width:"100%",maxWidth:520,background:"#fff",height:"100%",display:"flex",flexDirection:"column",boxShadow:"-4px 0 24px rgba(0,0,0,0.15)"}}>
        <div style={{background:OR,padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div>
            <div style={{color:"#fff",fontWeight:700,fontSize:15,letterSpacing:1}}>🧾 COTIZACIÓN</div>
            <div style={{color:"rgba(255,255,255,0.85)",fontSize:11}}>{cart.length} producto{cart.length!==1?"s":""} · {money2(total)}</div>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.2)",border:"none",color:"#fff",width:32,height:32,borderRadius:"50%",cursor:"pointer",fontSize:16,fontWeight:700}}>✕</button>
        </div>

        <div style={{flex:1,overflowY:"auto",padding:16}}>
          {cart.length===0&&<div style={{textAlign:"center",color:GRL,padding:40,fontSize:13}}>
            Agrega productos con el botón <strong style={{color:OR}}>＋</strong> en el catálogo
          </div>}
          {cart.map((it,i)=>{
            const conIvaItem=tieneIVA(it);
            return(
              <div key={i} style={{border:"1px solid #e5e7eb",borderRadius:6,padding:12,marginBottom:10,background:"#fafafa"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                  <div style={{flex:1,marginRight:8}}>
                    <div style={{fontFamily:"monospace",color:GRL,fontSize:10}}>{it.codigo}</div>
                    <div style={{fontSize:12,fontWeight:600,lineHeight:1.3,color:"#1a1a1a"}}>{it.descripcion}</div>
                    <div style={{fontSize:10,marginTop:2,color:conIvaItem?"#2563eb":"#dc2626",fontWeight:600}}>{conIvaItem?"🧾 Con IVA 16%":"🌾 Sin IVA"}</div>
                  </div>
                  <button onClick={()=>remove(i)} style={{background:"#fee2e2",border:"none",color:"#dc2626",width:24,height:24,borderRadius:"50%",cursor:"pointer",fontSize:12,fontWeight:700,flexShrink:0}}>✕</button>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:11,color:GRL}}>Cant:</span>
                    <div style={{display:"flex",alignItems:"center",border:"1px solid #e5e7eb",borderRadius:4,overflow:"hidden"}}>
                      <button onClick={()=>updCantidad(i,it.cantidad-1)} style={{background:"#f3f4f6",border:"none",padding:"4px 8px",cursor:"pointer",fontSize:14,fontWeight:700,color:"#374151"}}>−</button>
                      <input type="number" min="1" value={it.cantidad} onChange={e=>updCantidad(i,e.target.value)}
                        style={{width:40,textAlign:"center",border:"none",padding:"4px",fontSize:13,fontWeight:700,outline:"none"}}/>
                      <button onClick={()=>updCantidad(i,it.cantidad+1)} style={{background:"#f3f4f6",border:"none",padding:"4px 8px",cursor:"pointer",fontSize:14,fontWeight:700,color:"#374151"}}>＋</button>
                    </div>
                  </div>
                  {vend&&(
                    <select value={it.tipoPrecio} onChange={e=>updPrecio(i,e.target.value)}
                      style={{padding:"4px 8px",border:"1px solid #e5e7eb",borderRadius:4,fontSize:11,color:"#374151",outline:"none",background:"#fff"}}>
                      <option value="publico">Público</option>
                      <option value="distribuidor">Distribuidor</option>
                      <option value="asociado">Asociado</option>
                    </select>
                  )}
                  <div style={{marginLeft:"auto",textAlign:"right"}}>
                    <div style={{fontSize:11,color:GRL}}>P. Unit: <strong style={{color:"#1a1a1a"}}>{money2(it.precio)}</strong></div>
                    <div style={{fontSize:13,fontWeight:700,color:OR}}>Importe: {money2(safeNum(it.precio)*safeNum(it.cantidad))}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{borderTop:"1px solid #e5e7eb",padding:16,background:"#f9f9f9",flexShrink:0}}>
          <div style={{marginBottom:10}}>
            <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>A QUIÉN SE COTIZA</div>
            <input value={clienteNombre} onChange={e=>setClienteNombre(e.target.value)} placeholder="Público en general"
              style={{width:"100%",padding:"8px 10px",border:"1px solid #e5e7eb",borderRadius:4,fontSize:12,outline:"none",background:"#fff",boxSizing:"border-box"}}/>
          </div>
          <div style={{marginBottom:10}}>
            <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>VIGENCIA</div>
            <select value={vigencia} onChange={e=>setVigencia(e.target.value)}
              style={{width:"100%",padding:"8px 10px",border:"1px solid #e5e7eb",borderRadius:4,fontSize:12,outline:"none",background:"#fff"}}>
              <option>7 días naturales</option>
              <option>15 días naturales</option>
              <option>30 días naturales</option>
              <option>Sujeto a disponibilidad</option>
            </select>
          </div>
          {/* Descuento solo vendedor/admin — enteros 0-30 */}
          {vend&&(
            <div style={{marginBottom:10}}>
              <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>DESCUENTO ADICIONAL % (0–30)</div>
              <input type="number" min="0" max="30" step="1" value={descuento}
                onChange={e=>setDescuento(clampDesc(e.target.value))}
                style={{width:"100%",padding:"8px 10px",border:"1px solid #e5e7eb",borderRadius:4,fontSize:12,outline:"none",background:"#fff",boxSizing:"border-box"}}/>
            </div>
          )}
          <div style={{marginBottom:12}}>
            <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>OBSERVACIONES</div>
            <textarea value={nota} onChange={e=>setNota(e.target.value)} rows={2}
              placeholder="Condiciones especiales, etc."
              style={{width:"100%",padding:"8px 10px",border:"1px solid #e5e7eb",borderRadius:4,fontSize:12,resize:"none",outline:"none",boxSizing:"border-box"}}/>
          </div>
          {/* Resumen */}
          <div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:4,padding:"10px 12px",marginBottom:12,fontSize:12}}>
            <div style={{display:"flex",justifyContent:"space-between",color:GRL,marginBottom:3}}>
              <span>Subtotal:</span><span style={{color:"#1a1a1a",fontWeight:600}}>{money2(subtotal)}</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:3,color:ivaTotal===0?"#9ca3af":"#2563eb"}}>
              <span>IVA (16%):</span><span style={{fontWeight:600}}>{money2(ivaTotal)}</span>
            </div>
            {vend&&descPct>0&&<div style={{display:"flex",justifyContent:"space-between",color:"#dc2626",marginBottom:3}}>
              <span>Descuento ({descPct}%):</span><span style={{fontWeight:600}}>-{money2(descMonto)}</span>
            </div>}
            <div style={{display:"flex",justifyContent:"space-between",fontWeight:700,fontSize:15,color:OR,borderTop:"1px solid #e5e7eb",paddingTop:6,marginTop:4}}>
              <span>TOTAL:</span><span>{money2(total)}</span>
            </div>
          </div>
          {folioMsg&&<div style={{fontSize:11,marginBottom:10,padding:"8px 12px",borderRadius:4,
            background:folioMsg.startsWith("✅")?"#f0fdf4":folioMsg.startsWith("❌")?"#fef2f2":"#fffbeb",
            color:folioMsg.startsWith("✅")?"#16a34a":folioMsg.startsWith("❌")?"#dc2626":"#d97706",
            border:`1px solid ${folioMsg.startsWith("✅")?"#bbf7d0":folioMsg.startsWith("❌")?"#fecaca":"#fde68a"}`}}>{folioMsg}</div>}
          <button onClick={generarCotizacion} disabled={generating||cart.length===0}
            style={{width:"100%",padding:"13px",background:cart.length===0?"#e5e7eb":OR,color:cart.length===0?GRL:"#fff",
              border:"none",borderRadius:4,cursor:cart.length===0?"not-allowed":"pointer",fontWeight:700,fontSize:14,letterSpacing:1,opacity:generating?0.7:1}}>
            {generating?"⏳ GENERANDO...":"📄 GENERAR COTIZACIÓN PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Historial ─────────────────────────────────────────────────
function HistorialCotizaciones({session,db,mob}){
  const [cots,setCots]=useState([]);
  const [loading,setLoading]=useState(true);
  const [expanded,setExpanded]=useState(null);
  const admin=isAdminRole(session);

  useEffect(()=>{
    let mounted=true;
    (async()=>{
      setLoading(true);
      const data=await fbGetCotizaciones(session?.usuario,admin);
      if(mounted&&data!==null) setCots(data);
      if(mounted) setLoading(false);
    })();
    return()=>{mounted=false;};
  },[]);

  async function reimprimir(cot){
    try{
      await generarPDF({
        folio:cot.folio,
        session:{nombre:cot.nombre,empresa:cot.empresa},
        items:cot.items||[],nota:cot.nota||"",
        vigencia:cot.vigencia||"7 días naturales",
        descuento:cot.descuento||0,
        clienteNombre:cot.clienteNombre||"Público en general",
      });
    }catch(e){alert("Error al reimprimir: "+safe(e.message));}
  }

  if(loading) return <div style={{textAlign:"center",padding:40,color:GRL}}>Cargando historial...</div>;
  if(cots.length===0) return(
    <div style={{textAlign:"center",padding:"50px 20px",color:GRL}}>
      <div style={{fontSize:40,marginBottom:12}}>📋</div>
      <div style={{fontSize:14,fontWeight:600}}>Sin cotizaciones aún</div>
    </div>
  );

  return(
    <div>
      <div style={{marginBottom:12,color:GRL,fontSize:11}}>{cots.length} cotización{cots.length!==1?"es":""}</div>
      {cots.map(cot=>{
        const open=expanded===cot.folio;
        return(
          <div key={cot.folio} style={{background:CD,border:"1px solid "+BD,borderRadius:6,marginBottom:8,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",cursor:"pointer"}} onClick={()=>setExpanded(open?null:cot.folio)}>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <span style={{fontWeight:700,fontSize:13,fontFamily:"monospace",color:OR}}>{cot.folio}</span>
                  {admin&&<span style={{fontSize:11,color:GRL}}>· {cot.nombre}{cot.empresa?` (${cot.empresa})`:""}</span>}
                </div>
                <div style={{display:"flex",gap:12,marginTop:3,flexWrap:"wrap"}}>
                  <span style={{fontSize:11,color:GRL}}>{cot.fecha?new Date(cot.fecha).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):""}</span>
                  <span style={{fontSize:11,fontWeight:600,color:"#1a1a1a"}}>{money2(cot.total??cot.subtotal)}</span>
                  {cot.clienteNombre&&<span style={{fontSize:11,color:GRL}}>→ {cot.clienteNombre}</span>}
                </div>
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <button onClick={e=>{e.stopPropagation();reimprimir(cot);}}
                  style={{background:OR,color:"#fff",border:"none",padding:"6px 12px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:700}}>📄 PDF</button>
                <span style={{color:GRL,fontSize:16,transform:open?"rotate(180deg)":"none",transition:"transform 0.2s"}}>▾</span>
              </div>
            </div>
            {open&&(
              <div style={{borderTop:"1px solid "+BD,padding:"12px 16px",background:"#fafafa"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <thead><tr style={{background:"#f0f0f0"}}>
                    {["CÓDIGO","DESCRIPCIÓN","CANT.","P. UNIT.","IMPORTE"].map(h=><th key={h} style={{padding:"6px 10px",textAlign:["CANT.","P. UNIT.","IMPORTE"].includes(h)?"right":"left",color:OR,fontWeight:700,fontSize:10}}>{h}</th>)}
                  </tr></thead>
                  <tbody>{(cot.items||[]).map((it,i)=><tr key={i} style={{borderTop:"1px solid #f0f0f0"}}>
                    <td style={{padding:"5px 10px",fontFamily:"monospace",color:GRL,fontSize:10}}>{it.codigo}</td>
                    <td style={{padding:"5px 10px"}}>{it.descripcion}</td>
                    <td style={{padding:"5px 10px",textAlign:"right"}}>{it.cantidad}</td>
                    <td style={{padding:"5px 10px",textAlign:"right"}}>{money2(it.precio)}</td>
                    <td style={{padding:"5px 10px",textAlign:"right",fontWeight:600,color:OR}}>{money2(safeNum(it.precio)*safeNum(it.cantidad))}</td>
                  </tr>)}</tbody>
                </table>
                <div style={{display:"flex",justifyContent:"flex-end",gap:16,marginTop:10,paddingTop:8,borderTop:"1px solid #e5e7eb",flexWrap:"wrap",fontSize:12}}>
                  <span style={{color:GRL}}>Subtotal: <strong>{money2(cot.subtotal)}</strong></span>
                  {safeNum(cot.ivaTotal)>0&&<span style={{color:"#2563eb"}}>IVA: <strong>{money2(cot.ivaTotal)}</strong></span>}
                  {safeNum(cot.descuento)>0&&<span style={{color:"#dc2626"}}>Desc. ({cot.descuento}%): <strong>-{money2(safeNum(cot.subtotal)*(safeNum(cot.descuento)/100))}</strong></span>}
                  <span style={{fontWeight:700,color:OR}}>Total: {money2(cot.total??cot.subtotal)}</span>
                </div>
                {cot.nota&&<div style={{marginTop:6,fontSize:11,color:GRL}}><strong>Nota:</strong> {cot.nota}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── PassCell ──────────────────────────────────────────────────
function PassCell({uid,db,hashPassword}){
  const [show,setShow]=useState(false);const [editing,setEditing]=useState(false);
  const [newPass,setNewPass]=useState("");const [saving,setSaving]=useState(false);
  const [msg,setMsg]=useState("");const [plain,setPlain]=useState("");
  async function guardar(){
    if(!newPass.trim()){setMsg("❌ Escribe una contraseña");return;}
    if(newPass.trim().length<3){setMsg("❌ Mínimo 3 caracteres");return;}
    setSaving(true);setMsg("");
    try{
      const hash=await hashPassword(newPass.trim());
      await setDoc(doc(db,"usuarios",uid),{password:hash,actualizado:new Date().toISOString()},{merge:true});
      setPlain(newPass.trim());setNewPass("");setEditing(false);
      setMsg("✅ Guardada");setTimeout(()=>setMsg(""),3000);
    }catch(e){setMsg("❌ "+safe(e.message));}
    setSaving(false);
  }
  if(editing) return(
    <div style={{display:"flex",gap:4,alignItems:"center",minWidth:200}}>
      <input autoFocus value={newPass} onChange={e=>setNewPass(e.target.value)}
        onKeyDown={e=>{if(e.key==="Enter")guardar();if(e.key==="Escape"){setEditing(false);setNewPass("");}}}
        placeholder="Nueva contraseña" style={{padding:"4px 8px",border:"1px solid "+OR,borderRadius:3,fontSize:12,width:130,outline:"none"}}/>
      <button onClick={guardar} disabled={saving} style={{background:OR,color:"#fff",border:"none",padding:"4px 8px",borderRadius:3,cursor:"pointer",fontSize:10,fontWeight:700}}>{saving?"...":"OK"}</button>
      <button onClick={()=>{setEditing(false);setNewPass("");}} style={{background:"#f3f4f6",color:GRL,border:"1px solid "+BD,padding:"4px 8px",borderRadius:3,cursor:"pointer",fontSize:10}}>✕</button>
      {msg&&<span style={{fontSize:10,color:msg.startsWith("✅")?"#16a34a":"#dc2626"}}>{msg}</span>}
    </div>
  );
  return(
    <div style={{display:"flex",gap:4,alignItems:"center"}}>
      <span style={{fontFamily:"monospace",fontSize:11,color:show?"#1a1a1a":GRL,background:show?"#f0fdf4":"#f3f4f6",padding:"3px 8px",borderRadius:3,minWidth:80}}>{show?(plain||"(hash)"):"••••••"}</span>
      <button onClick={()=>setShow(s=>!s)} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,padding:"2px 4px",color:GRL}}>{show?"🙈":"👁"}</button>
      <button onClick={()=>{setEditing(true);setShow(false);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,padding:"2px 4px",color:OR}}>✏️</button>
      {msg&&<span style={{fontSize:10,color:"#16a34a"}}>{msg}</span>}
    </div>
  );
}

// ── ChangePassword ────────────────────────────────────────────
function ChangePassword({session,db,hashPassword,checkPassword}){
  const [actual,setActual]=useState("");const [nueva,setNueva]=useState("");const [conf,setConf]=useState("");
  const [msg,setMsg]=useState("");const [loading,setLoading]=useState(false);
  async function cambiar(){
    if(!actual||!nueva||!conf){setMsg("❌ Completa todos los campos.");return;}
    if(nueva!==conf){setMsg("❌ Las contraseñas no coinciden.");return;}
    if(nueva.length<4){setMsg("❌ Mínimo 4 caracteres.");return;}
    setLoading(true);setMsg("");
    try{
      const snap=await getDocs(collection(db,"usuarios"));
      const d=snap.docs.find(d=>d.data().usuario===session?.usuario);
      if(!d){setMsg("❌ Usuario no encontrado.");setLoading(false);return;}
      if(!await checkPassword(actual,d.data().password)){setMsg("❌ Contraseña actual incorrecta.");setLoading(false);return;}
      const hash=await hashPassword(nueva);
      await setDoc(doc(db,"usuarios",d.id),{password:hash,actualizado:new Date().toISOString()},{merge:true});
      localStorage.setItem("gt_session",JSON.stringify({...session,password:hash}));
      setMsg("✅ Contraseña cambiada.");setActual("");setNueva("");setConf("");
    }catch(e){setMsg("❌ "+safe(e.message));}
    setLoading(false);
  }
  return <div>
    <div style={{display:"grid",gap:10}}>
      {[["CONTRASEÑA ACTUAL",actual,setActual],["CONTRASEÑA NUEVA",nueva,setNueva],["CONFIRMAR",conf,setConf]].map(([lbl,val,set])=>(
        <div key={lbl}><div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>{lbl}</div>
          <input type="password" value={val} onChange={e=>set(e.target.value)} style={{width:"100%",padding:"9px 11px",background:"#f7f7f7",border:"1px solid "+BD,color:"#1a1a1a",fontSize:13,borderRadius:4,boxSizing:"border-box",outline:"none"}}/>
        </div>
      ))}
    </div>
    {msg&&<div style={{marginTop:10,fontSize:12,color:msg.startsWith("✅")?"#16a34a":"#dc2626",fontWeight:600}}>{msg}</div>}
    <button onClick={cambiar} disabled={loading} style={{marginTop:14,background:OR,color:"#fff",border:"none",padding:"10px 20px",borderRadius:4,cursor:loading?"wait":"pointer",fontWeight:700,fontSize:12,opacity:loading?0.7:1}}>
      {loading?"GUARDANDO...":"CAMBIAR CONTRASEÑA"}
    </button>
  </div>;
}

// ── CreateAdmin ───────────────────────────────────────────────
function CreateAdmin({session,db,hashPassword}){
  const [form,setForm]=useState({nombre:"",usuario:"",password:"",confirmar:""});
  const [msg,setMsg]=useState("");const [loading,setLoading]=useState(false);
  const upd=(k,v)=>setForm(p=>({...p,[k]:v}));
  async function crear(){
    if(!form.nombre||!form.usuario||!form.password){setMsg("❌ Completa todos los campos.");return;}
    if(form.password!==form.confirmar){setMsg("❌ Las contraseñas no coinciden.");return;}
    if(form.password.length<4){setMsg("❌ Mínimo 4 caracteres.");return;}
    setLoading(true);setMsg("");
    try{
      const snap=await getDocs(collection(db,"usuarios"));
      if(snap.docs.find(d=>d.data().usuario===form.usuario.trim())){setMsg("❌ Ya existe ese usuario.");setLoading(false);return;}
      const hash=await hashPassword(form.password);
      await setDoc(doc(db,"usuarios","admin_"+Date.now()),{
        nombre:form.nombre.trim(),usuario:form.usuario.trim(),password:hash,
        rol:"admin",lista:"PUBLICO",estatus:"activo",empresa:"Grupo Tapatía",
        creado_por:safe(session?.nombre),creado_en:new Date().toISOString(),actualizado:new Date().toISOString()
      });
      setMsg("✅ Admin '"+form.usuario+"' creado.");setForm({nombre:"",usuario:"",password:"",confirmar:""});
    }catch(e){setMsg("❌ "+safe(e.message));}
    setLoading(false);
  }
  return <div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 14px"}}>
      {[["NOMBRE","nombre"],["USUARIO","usuario"],["CONTRASEÑA","password"],["CONFIRMAR","confirmar"]].map(([lbl,k])=>(
        <div key={k} style={{marginBottom:12}}>
          <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>{lbl}</div>
          <input type={k.includes("pass")||k==="confirmar"?"password":"text"} value={form[k]} onChange={e=>upd(k,e.target.value)}
            style={{width:"100%",padding:"9px 11px",background:"#f7f7f7",border:"1px solid "+BD,color:"#1a1a1a",fontSize:13,borderRadius:4,boxSizing:"border-box",outline:"none"}}/>
        </div>
      ))}
    </div>
    {msg&&<div style={{fontSize:12,color:msg.startsWith("✅")?"#16a34a":"#dc2626",fontWeight:600,marginBottom:10}}>{msg}</div>}
    <button onClick={crear} disabled={loading} style={{background:OR,color:"#fff",border:"none",padding:"10px 20px",borderRadius:4,cursor:loading?"wait":"pointer",fontWeight:700,fontSize:12,opacity:loading?0.7:1}}>
      {loading?"CREANDO...":"CREAR ADMINISTRADOR"}
    </button>
  </div>;
}

// ════════════════════════════════════════════════════════════
// APP PRINCIPAL
// ════════════════════════════════════════════════════════════
export default function App(){
  const [session,setSession]=useState(()=>{try{const s=localStorage.getItem("gt_session");return s?JSON.parse(s):null;}catch(e){return null;}});
  const [view,setView]=useState(()=>{try{const s=localStorage.getItem("gt_session");if(s){const u=JSON.parse(s);return isAdminRole(u)?"admin":"client";}}catch(e){}return "login";});
  const [tab,setTab]=useState("products");
  const [users,setUsers]=useState([]);
  const [products,setProducts]=useState([]);
  const [prodLoad,setProdLoad]=useState(false);
  const [userLoad,setUserLoad]=useState(false);
  const [search,setSearch]=useState("");
  const [ds,setDs]=useState("");
  const [page,setPage]=useState(0);
  const [cart,setCart]=useState([]);
  const [cartOpen,setCartOpen]=useState(false);
  const PS=50;
  const [lu,setLu]=useState("");const [lp,setLp]=useState("");const [lerr,setLerr]=useState("");
  const [loginLoad,setLoginLoad]=useState(false);
  const [msg,setMsg]=useState("");
  const [modal,setModal]=useState(null);
  const [saving,setSaving]=useState(false);
  const [mob,setMob]=useState(window.innerWidth<768);
  const fref=useRef();const dbRef=useRef(null);
  const emptyC={nombre:"",empresa:"",usuario:"",password:"",lista:"DISTRIBUIDOR",estatus:"activo"};

  useEffect(()=>{const h=()=>setMob(window.innerWidth<768);window.addEventListener("resize",h);return()=>window.removeEventListener("resize",h);},[]);
  useEffect(()=>{
    if(dbRef.current)clearTimeout(dbRef.current);
    dbRef.current=setTimeout(()=>{setDs(search);setPage(0);},300);
    return()=>{if(dbRef.current)clearTimeout(dbRef.current);};
  },[search]);
  // Carga inicial solo si ya había sesión (refresh de página)
  useEffect(()=>{
    if(session){loadProducts();if(isAdminRole(session))loadUsers();}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  async function loadProducts(){setProdLoad(true);const d=await fbGetProductos();if(d!==null)setProducts(d);setProdLoad(false);}
  async function loadUsers(){setUserLoad(true);const d=await fbGetUsuarios();if(d!==null)setUsers(d);setUserLoad(false);}

  // ── addToCart ─────────────────────────────────────────────
  function addToCart(p){
    const lista=safe(session?.lista).toUpperCase();
    const vend=isVendedor(session);
    const tipoPrecio=vend?"publico":lista==="DISTRIBUIDOR"?"distribuidor":lista==="ASOCIADO"?"asociado":"publico";
    const precio=tipoPrecio==="publico"?safeNum(p.publico):tipoPrecio==="distribuidor"?safeNum(p.distribuidor):safeNum(p.asociado);
    setCart(prev=>{
      const idx=prev.findIndex(it=>it.codigo===p.codigo);
      if(idx>=0) return prev.map((it,i)=>i===idx?{...it,cantidad:it.cantidad+1}:it);
      return [...prev,{
        codigo:safe(p.codigo),descripcion:safe(p.descripcion),
        iva:safe(p.iva??p.IVA??"0"),
        precio,tipoPrecio,cantidad:1,
        _publico:safeNum(p.publico),_distribuidor:safeNum(p.distribuidor),_asociado:safeNum(p.asociado),
      }];
    });
  }

  // ── Login ─────────────────────────────────────────────────
  async function doLogin(){
    setLerr("");setLoginLoad(true);
    try{
      const data=await fbGetUsuarios();
      if(data===null){setLerr("Error de conexión. Intenta de nuevo.");setLoginLoad(false);return;}
      const u=data.find(u=>safe(u.usuario)===safe(lu));
      if(!u){setLerr("Usuario o contraseña incorrectos");setLoginLoad(false);return;}
      if(!await checkPassword(safe(lp),safe(u.password))){setLerr("Usuario o contraseña incorrectos");setLoginLoad(false);return;}
      if(u.estatus==="inactivo"){setLerr("Cuenta inactiva. Contacta al administrador.");setLoginLoad(false);return;}
      setSession(u);localStorage.setItem("gt_session",JSON.stringify(u));
      setView(isAdminRole(u)?"admin":"client");
      setLu("");setLp("");
      // Cargar datos inmediatamente — evita pantalla blanca
      const pd=await fbGetProductos();if(pd!==null)setProducts(pd);
      if(isAdminRole(u)){const ud=await fbGetUsuarios();if(ud!==null)setUsers(ud);}
    }catch(e){setLerr("Error: "+safe(e.message));}
    setLoginLoad(false);
  }

  function doLogout(){setSession(null);setView("login");setSearch("");setDs("");setPage(0);setProducts([]);setUsers([]);setCart([]);localStorage.removeItem("gt_session");}

  // ── Subir CSV ─────────────────────────────────────────────
  async function handleFile(e){
    const file=e.target.files[0];if(!file)return;e.target.value="";
    if(file.name.endsWith(".xlsx")||file.name.endsWith(".xls")){setMsg("⚠️ Guarda como CSV UTF-8 desde Excel.");return;}
    setMsg("📂 Leyendo archivo...");
    const reader=new FileReader();
    reader.onload=async ev=>{
      try{
        const rows=parseCsv(ev.target.result);
        if(rows.length===0){setMsg("❌ No se encontró columna CÓDIGO.");return;}
        const mapped=rows.map(r=>({
          codigo:     safe(r.CODIGO??r["CÓDIGO"]??r.codigo??""),
          descripcion:safe(r.DESCRIPCION??r["DESCRIPCIÓN"]??r.descripcion??""),
          gdl1:safeNum(r.GDL1??r.gdl1),
          gdl3:safeNum(r.GDL3??r.gdl3),
          ags: safeNum(r.AGS??r.ags),
          col: safeNum(r.COL??r.col),
          len: safeNum(r.LEN??r.len),
          cul: safeNum(r.CUL??r.cul),
          publico:     safeNum(r.PUBLICO??r["PÚBLICO"]??r.publico),
          distribuidor:safeNum(r.DISTRIBUIDOR??r.distribuidor),
          asociado:    safeNum(r.ASOCIADO??r.asociado),
          // IVA: manejar columna con espacio al final "IVA "
          iva: safe(r["IVA "]??r.IVA??r["iva "]??r.iva??"0"),
          actualizado:new Date().toISOString(),
        })).filter(p=>p.codigo);
        if(mapped.length===0){setMsg("❌ No hay productos válidos.");return;}
        setMsg("💾 Respaldando...");
        const oldSnap=await getDocs(collection(db,"productos"));
        if(oldSnap.docs.length>0){
          const ts=new Date().toISOString().replace(/[:.]/g,"-").slice(0,19);
          const bk=writeBatch(db);oldSnap.docs.forEach(d=>bk.set(doc(db,`respaldo_${ts}`,d.id),d.data()));await bk.commit();
          setMsg("🗑️ Eliminando versión anterior...");
          const del=writeBatch(db);oldSnap.docs.forEach(d=>del.delete(d.ref));await del.commit();
        }
        const chunk=400;
        for(let i=0;i<mapped.length;i+=chunk){
          const batch=writeBatch(db);
          mapped.slice(i,i+chunk).forEach((p,j)=>batch.set(doc(collection(db,"productos"),`p_${String(i+j).padStart(6,"0")}`),p));
          await batch.commit();setMsg(`⏳ ${Math.min(i+chunk,mapped.length)} / ${mapped.length} guardados...`);
        }
        const verify=await getDocs(collection(db,"productos"));
        if(verify.size===0){setMsg("❌ ERROR: No se guardaron. Revisa Firebase.");return;}
        await setDoc(doc(db,"bitacora",`carga_${Date.now()}`),{tipo:"carga_productos",por:safe(session?.nombre),cantidad:mapped.length,fecha:new Date().toISOString()});
        await loadProducts();setMsg(`✅ ${mapped.length} productos guardados.`);
      }catch(err){console.error("handleFile:",err);setMsg("❌ ERROR: "+safe(err.message));}
    };
    reader.readAsText(file,"UTF-8");
  }

  // ── Guardar cliente ───────────────────────────────────────
  async function saveClient(form){
    setSaving(true);
    try{
      if(!safe(form.nombre)||!safe(form.usuario)){alert("Nombre y usuario son obligatorios.");setSaving(false);return;}
      if(!form.id&&!safe(form.password)){alert("La contraseña es obligatoria para usuarios nuevos.");setSaving(false);return;}
      if(!form.id&&users.find(u=>safe(u.usuario)===safe(form.usuario))){alert("Ya existe ese usuario.");setSaving(false);return;}
      const id=form.id||"u_"+Date.now();
      const data={nombre:safe(form.nombre),empresa:safe(form.empresa),usuario:safe(form.usuario),lista:safe(form.lista),estatus:safe(form.estatus),rol:"client",actualizado:new Date().toISOString()};
      if(!form.id)data.creado_en=new Date().toISOString();
      if(safe(form.password))data.password=await hashPassword(safe(form.password));
      await setDoc(doc(db,"usuarios",id),data,{merge:true});
      const verify=await getDoc(doc(db,"usuarios",id));
      if(!verify.exists()){alert("❌ No se guardó. Intenta de nuevo.");setSaving(false);return;}
      await setDoc(doc(db,"bitacora",`u_${Date.now()}`),{tipo:form.id?"edicion_usuario":"nuevo_usuario",usuario:safe(form.usuario),por:safe(session?.nombre),fecha:new Date().toISOString()});
      await loadUsers();setModal(null);
    }catch(err){alert("❌ Error: "+safe(err.message));}
    setSaving(false);
  }

  async function toggleEstatus(id,est){
    try{await setDoc(doc(db,"usuarios",id),{estatus:est==="activo"?"inactivo":"activo",actualizado:new Date().toISOString()},{merge:true});
      setUsers(prev=>prev.map(u=>u.id===id?{...u,estatus:est==="activo"?"inactivo":"activo"}:u));
    }catch(err){alert("❌ Error: "+safe(err.message));}
  }
  async function deleteClient(id,nombre,rol){
    if(rol==="admin"&&users.filter(u=>u.rol==="admin").length<=1){alert("❌ No puedes eliminar el único administrador.");return;}
    if(!window.confirm(`¿Eliminar a ${nombre}? Esta acción no se puede deshacer.`))return;
    try{await deleteDoc(doc(db,"usuarios",id));
      await setDoc(doc(db,"bitacora",`del_${Date.now()}`),{tipo:"eliminacion_usuario",usuario_id:id,usuario_nombre:safe(nombre),por:safe(session?.nombre),fecha:new Date().toISOString()});
      setUsers(prev=>prev.filter(u=>u.id!==id));
    }catch(err){alert("❌ Error: "+safe(err.message));}
  }

  const filtered=useMemo(()=>{
    const q=ds.trim();
    const results=q?products.filter(p=>smartMatch(q,p)):[...products];
    return results.sort((a,b)=>{const ta=calcTotal(a),tb=calcTotal(b);if(ta===0&&tb===0)return 0;if(ta===0)return 1;if(tb===0)return -1;return tb-ta;});
  },[products,ds]);

  function ClientModal(){
    const isEdit=modal.mode==="edit";
    const [form,setForm]=useState(isEdit?{...modal.data,password:""}:{...emptyC});
    const upd=(k,v)=>setForm(p=>({...p,[k]:v}));
    return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
      <div style={{background:CD,border:"1px solid "+BD,borderRadius:8,padding:24,width:"100%",maxWidth:460,boxShadow:"0 8px 40px rgba(0,0,0,0.15)",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{fontWeight:700,fontSize:14,color:OR,marginBottom:18}}>{isEdit?"EDITAR CLIENTE":"NUEVO CLIENTE"}</div>
        <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:"0 14px"}}>
          <Inp label="NOMBRE *" value={form.nombre} onChange={e=>upd("nombre",e.target.value)}/>
          <Inp label="EMPRESA" value={form.empresa||""} onChange={e=>upd("empresa",e.target.value)}/>
          <Inp label="USUARIO *" value={form.usuario} onChange={e=>upd("usuario",e.target.value)}/>
          <Inp label={isEdit?"NUEVA CONTRASEÑA (vacío = no cambia)":"CONTRASEÑA *"} value={form.password} onChange={e=>upd("password",e.target.value)} type="password"/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:"0 14px"}}>
          <div style={{marginBottom:12}}>
            <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>TIPO *</div>
            <select value={form.lista} onChange={e=>upd("lista",e.target.value)} style={{width:"100%",padding:"9px 11px",background:"#f7f7f7",border:"1px solid "+BD,color:"#1a1a1a",fontSize:13,borderRadius:4,outline:"none"}}>
              <option value="PUBLICO">PÚBLICO</option><option value="DISTRIBUIDOR">DISTRIBUIDOR</option>
              <option value="ASOCIADO">ASOCIADO</option><option value="VENDEDOR">VENDEDOR (todos los precios)</option>
            </select>
          </div>
          <div style={{marginBottom:12}}>
            <div style={{color:GRL,fontSize:10,letterSpacing:2,marginBottom:4}}>ESTATUS</div>
            <select value={form.estatus} onChange={e=>upd("estatus",e.target.value)} style={{width:"100%",padding:"9px 11px",background:"#f7f7f7",border:"1px solid "+BD,color:"#1a1a1a",fontSize:13,borderRadius:4,outline:"none"}}>
              <option value="activo">Activo</option><option value="inactivo">Inactivo</option>
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

  const Hdr=session&&<div style={{background:OR,borderBottom:"2px solid #e05500",padding:mob?"10px 14px":"11px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",boxShadow:"0 2px 8px rgba(0,0,0,0.15)"}}>
    <div style={{display:"flex",alignItems:"center",gap:12}}>
      <Logo h={mob?32:44}/>
      {!mob&&<><div style={{width:1,height:24,background:"rgba(255,255,255,0.3)"}}/><span style={{color:"rgba(255,255,255,0.9)",fontSize:10,letterSpacing:2}}>{isAdminRole(session)?"PANEL ADMINISTRADOR":"PORTAL DE PRECIOS"}</span></>}
    </div>
    <div style={{display:"flex",alignItems:"center",gap:10}}>
      {!mob&&<div style={{textAlign:"right"}}><div style={{color:"#fff",fontSize:12,fontWeight:600}}>{session.nombre}</div>{session.empresa&&<div style={{color:"rgba(255,255,255,0.75)",fontSize:10}}>{session.empresa}</div>}</div>}
      <button onClick={doLogout} style={{background:"rgba(255,255,255,0.2)",color:"#fff",border:"1px solid rgba(255,255,255,0.4)",padding:"7px 16px",borderRadius:4,cursor:"pointer",fontWeight:700,fontSize:11,letterSpacing:1}}>SALIR</button>
    </div>
  </div>;

  const CartFab=cart.length>0&&!cartOpen&&(
    <button onClick={()=>setCartOpen(true)} style={{position:"fixed",bottom:24,right:24,zIndex:1000,background:OR,color:"#fff",border:"none",borderRadius:"50px",padding:"12px 20px",cursor:"pointer",fontWeight:700,fontSize:13,boxShadow:"0 4px 16px rgba(255,107,6,0.5)",display:"flex",alignItems:"center",gap:8}}>
      🧾 <span>Cotización</span>
      <span style={{background:"#fff",color:OR,borderRadius:"50%",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800}}>{cart.length}</span>
    </button>
  );

  // ════ LOGIN ═══════════════════════════════════════════════
  if(view==="login") return(
    <div style={{minHeight:"100vh",background:DK,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Arial,sans-serif",padding:16}}>
      <div style={{width:"100%",maxWidth:360,background:CD,borderRadius:8,overflow:"hidden",boxShadow:"0 8px 40px rgba(0,0,0,0.12)"}}>
        <div style={{background:OR,padding:"20px 28px",display:"flex",justifyContent:"center"}}><Logo h={48}/></div>
        <div style={{padding:"26px 28px 24px"}}>
          <div style={{color:GRL,fontSize:11,letterSpacing:3,textAlign:"center",marginBottom:20}}>PORTAL DE PRECIOS</div>
          <Inp label="USUARIO" value={lu} onChange={e=>setLu(e.target.value)}/>
          <Inp label="CONTRASEÑA" value={lp} onChange={e=>setLp(e.target.value)} type="password" mb={20}/>
          {lerr&&<div style={{color:"#dc2626",fontSize:12,textAlign:"center",marginBottom:12,fontWeight:600}}>{lerr}</div>}
          <button onClick={doLogin} disabled={loginLoad}
            style={{width:"100%",padding:"12px",background:OR,color:"#fff",border:"none",borderRadius:4,fontSize:13,fontWeight:700,cursor:loginLoad?"wait":"pointer",letterSpacing:2,opacity:loginLoad?0.7:1}}>
            {loginLoad?"VERIFICANDO...":"INGRESAR"}
          </button>
        </div>
      </div>
    </div>
  );

  // ════ ADMIN ════════════════════════════════════════════════
  if(view==="admin") return(
    <div style={{minHeight:"100vh",background:DK,fontFamily:"Arial,sans-serif",color:"#1a1a1a"}}>
      {Hdr}{modal&&<ClientModal/>}
      {cartOpen&&<CartPanel cart={cart} setCart={setCart} session={session} db={db} onClose={()=>setCartOpen(false)} mob={mob}/>}
      {CartFab}
      <div style={{background:CD,display:"flex",borderBottom:"1px solid "+BD,padding:mob?"0 8px":"0 24px",overflowX:"auto",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
        {[["products","📦 PRODUCTOS"],["clients","👥 CLIENTES"],["quotes","📋 COTIZACIONES"],
          ...(canDo(session,"config")?[["settings","⚙️ CONFIG"]]:[])]
          .map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)} style={{padding:mob?"10px 12px":"11px 18px",background:"none",border:"none",color:tab===k?OR:GRL,borderBottom:tab===k?"2px solid "+OR:"2px solid transparent",cursor:"pointer",fontSize:mob?11:12,fontWeight:700,letterSpacing:1,marginBottom:-1,whiteSpace:"nowrap"}}>{l}</button>
        ))}
      </div>
      <div style={{padding:mob?12:24,maxWidth:1400,margin:"0 auto"}}>

        {tab==="products"&&<div>
          <div style={{background:CD,border:"1px solid "+BD,borderRadius:6,padding:14,marginBottom:14,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
            <div style={{flex:1,minWidth:180}}>
              <div style={{fontWeight:700,fontSize:12,marginBottom:3}}>ACTUALIZAR CATÁLOGO</div>
              <div style={{color:GRL,fontSize:11}}>CSV UTF-8 — Columnas requeridas:</div>
              <div style={{color:"#bbb",fontSize:10,marginTop:2}}>CODIGO, DESCRIPCION, GDL1, GDL3, AGS, COL, LEN, CUL, PUBLICO, DISTRIBUIDOR, ASOCIADO, IVA</div>
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
                <th style={{padding:"8px 6px",textAlign:"center",color:GRL}}>IVA</th>
                <th style={{padding:"8px 6px",textAlign:"center",color:GRL}}>DISP</th>
                <th style={{padding:"8px 6px",textAlign:"right",color:"#16a34a",fontWeight:700}}>PÚB</th>
                <th style={{padding:"8px 6px",textAlign:"right",color:"#2563eb",fontWeight:700}}>DIST</th>
                <th style={{padding:"8px 6px",textAlign:"right",color:"#ea580c",fontWeight:700}}>ASOC</th>
                <th style={{padding:"8px 6px",width:34}}></th>
              </tr></thead>
              <tbody>{filtered.slice(page*PS,(page+1)*PS).map((p,i)=>{
                const tot=calcTotal(p),disp=tot>0,conIvaP=tieneIVA(p);
                return <tr key={i} style={{borderTop:"1px solid "+BD,background:i%2===0?CD:"#fafafa"}}>
                  <td style={{padding:"6px 10px",fontFamily:"monospace",color:GRL,whiteSpace:"nowrap"}}>{p.codigo}</td>
                  <td style={{padding:"6px 10px",minWidth:mob?140:300}}>{p.descripcion}</td>
                  <td style={{padding:"6px 6px",textAlign:"right",fontWeight:700,color:nColor(tot)}}>{stockVis(tot)}</td>
                  {!mob&&ALMS.map(a=>{const v=safeNum(p[a]);return<td key={a} style={{padding:"6px 5px",textAlign:"right",color:v>0?"#5a5a5a":"#ddd"}}>{v>0?(v>=30?"+30":v):"—"}</td>;})}
                  <td style={{padding:"6px 6px",textAlign:"center",fontSize:10,fontWeight:700,color:conIvaP?"#2563eb":"#dc2626"}}>{conIvaP?"16%":"0%"}</td>
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
            <div><span style={{color:GRL,fontSize:11}}>{users.length} usuarios registrados</span>{userLoad&&<span style={{color:OR,fontSize:11,marginLeft:8}}>cargando...</span>}</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={loadUsers} style={{background:"#f0f0f0",color:GRL,border:"1px solid "+BD,padding:"8px 14px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:700}}>↻ RECARGAR</button>
              <Btn onClick={()=>setModal({mode:"create",data:{}})}>+ NUEVO CLIENTE</Btn>
            </div>
          </div>
          {mob?(
            <div>{users.map(u=><div key={u.id} style={{background:u.rol==="admin"?"#eff6ff":CD,border:"1px solid "+(u.rol==="admin"?"#bfdbfe":BD),borderRadius:6,padding:14,marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <div><div style={{fontWeight:700,fontSize:13}}>{u.nombre}{u.rol==="admin"&&<span style={{marginLeft:6,fontSize:9,background:"#dbeafe",color:"#2563eb",padding:"1px 6px",borderRadius:3,fontWeight:700}}>ADMIN</span>}</div>
                {u.empresa&&<div style={{color:GRL,fontSize:11}}>{u.empresa}</div>}</div>
                <Badge val={u.estatus}/>
              </div>
              <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}><Badge val={u.rol==="admin"?"admin":u.lista}/><span style={{color:GRL,fontSize:11,fontFamily:"monospace"}}>@{u.usuario}</span></div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {u.rol!=="admin"&&<Btn sm onClick={()=>setModal({mode:"edit",data:{...u}})}>EDITAR</Btn>}
                {u.rol!=="admin"&&<Btn sm ghost onClick={()=>toggleEstatus(u.id,u.estatus)}>{u.estatus==="activo"?"DESACTIVAR":"ACTIVAR"}</Btn>}
                {u.id!==session?.id&&<Btn sm danger onClick={()=>deleteClient(u.id,u.nombre,u.rol)}>ELIMINAR</Btn>}
              </div>
            </div>)}</div>
          ):(
            <div style={{border:"1px solid "+BD,borderRadius:6,overflow:"hidden"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:"#f0f0f0"}}>{["NOMBRE","EMPRESA","USUARIO","CONTRASEÑA","ROL","TIPO/LISTA","ESTATUS","ACCIONES"].map(h=><th key={h} style={{padding:"9px 14px",textAlign:"left",color:OR,fontWeight:700,fontSize:10,letterSpacing:1}}>{h}</th>)}</tr></thead>
                <tbody>{users.map((u,i)=><tr key={u.id} style={{borderTop:"1px solid "+BD,background:u.rol==="admin"?"#eff6ff":i%2===0?CD:"#fafafa"}}>
                  <td style={{padding:"9px 14px",fontWeight:600}}>{u.nombre}{u.rol==="admin"&&<span style={{marginLeft:6,fontSize:9,background:"#dbeafe",color:"#2563eb",padding:"1px 6px",borderRadius:3,fontWeight:700}}>ADMIN</span>}</td>
                  <td style={{padding:"9px 14px",color:GRL,fontSize:11}}>{u.empresa||"—"}</td>
                  <td style={{padding:"9px 14px",fontFamily:"monospace",color:GRL,fontSize:11}}>{u.usuario}</td>
                  <td style={{padding:"9px 14px"}}>{(canDo(session,"config")||u.rol!=="admin")?<PassCell uid={u.id} db={db} hashPassword={hashPassword}/>:<span style={{color:"#bbb",fontSize:11}}>—</span>}</td>
                  <td style={{padding:"9px 14px"}}><Badge val={u.rol==="superadmin"?"superadmin":u.rol==="admin"?"admin":u.rol}/></td>
                  <td style={{padding:"9px 14px"}}>{u.rol==="admin"||u.rol==="superadmin"?<span style={{color:GRL,fontSize:11}}>—</span>:<Badge val={u.lista}/>}</td>
                  <td style={{padding:"9px 14px"}}><Badge val={u.estatus}/></td>
                  <td style={{padding:"9px 14px"}}><div style={{display:"flex",gap:6}}>
                    {(u.rol!=="admin"&&u.rol!=="superadmin")&&<Btn sm onClick={()=>setModal({mode:"edit",data:{...u}})}>EDITAR</Btn>}
                    {(u.rol!=="admin"&&u.rol!=="superadmin")&&<Btn sm ghost onClick={()=>toggleEstatus(u.id,u.estatus)}>{u.estatus==="activo"?"DESACTIVAR":"ACTIVAR"}</Btn>}
                    {u.id!==session?.id&&canDo(session,"config")&&<Btn sm danger onClick={()=>deleteClient(u.id,u.nombre,u.rol)}>ELIMINAR</Btn>}
                    {u.id!==session?.id&&!canDo(session,"config")&&(u.rol!=="admin"&&u.rol!=="superadmin")&&<Btn sm danger onClick={()=>deleteClient(u.id,u.nombre,u.rol)}>ELIMINAR</Btn>}
                  </div></td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
        </div>}

        {tab==="quotes"&&<HistorialCotizaciones session={session} db={db} mob={mob}/>}

        {tab==="settings"&&<div style={{maxWidth:520}}>
          <div style={{background:CD,border:"1px solid "+BD,borderRadius:6,padding:24,marginBottom:16}}>
            <div style={{fontWeight:700,fontSize:13,color:OR,marginBottom:16}}>🔑 CAMBIAR MI CONTRASEÑA</div>
            <ChangePassword session={session} db={db} hashPassword={hashPassword} checkPassword={checkPassword}/>
          </div>
          <div style={{background:CD,border:"1px solid "+BD,borderRadius:6,padding:24,marginBottom:16}}>
            <div style={{fontWeight:700,fontSize:13,color:OR,marginBottom:16}}>👤 CREAR USUARIO ADMINISTRADOR</div>
            <CreateAdmin session={session} db={db} hashPassword={hashPassword}/>
          </div>
          <div style={{background:CD,border:"1px solid "+BD,borderRadius:6,padding:24}}>
            <div style={{fontWeight:700,fontSize:13,color:OR,marginBottom:12}}>ℹ️ INFORMACIÓN DEL SISTEMA</div>
            <div style={{color:GRL,fontSize:12,lineHeight:2}}>
              <div>🔥 Firebase: <strong style={{color:"#1a1a1a"}}>portal-tapatia</strong></div>
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
      </div>
    </div>
  );

  // ════ CLIENTE / VENDEDOR ════════════════════════════════════
  const lista=safe(session?.lista).toUpperCase();
  const vend=isVendedor(session);
  return(
    <div style={{minHeight:"100vh",background:DK,fontFamily:"Arial,sans-serif",color:"#1a1a1a"}}>
      {cartOpen&&<CartPanel cart={cart} setCart={setCart} session={session} db={db} onClose={()=>setCartOpen(false)} mob={mob}/>}
      {CartFab}{Hdr}
      <div style={{background:"linear-gradient(90deg,#e05500,#c44a00)",padding:"8px "+(mob?"12px":"24px"),display:"flex",alignItems:"center",gap:8}}>
        <span style={{color:"#fff",fontSize:14}}>★</span>
        <span style={{color:"#fff",fontSize:mob?11:13,fontWeight:700}}>CONTADO ANTICIPADO: <span style={{color:"#ffe0c0"}}>3% DESCUENTO ADICIONAL</span></span>
      </div>
      <div style={{background:"linear-gradient(90deg,#1e40af,#1d4ed8,#2563eb)",padding:"10px "+(mob?"12px":"24px"),display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
        <span style={{fontSize:mob?16:18}}>💳</span>
        <span style={{color:"#fff",fontSize:mob?11:13,fontWeight:600}}>
          ¡Solicita tus compras hasta con{" "}
          <span style={{color:"#fbbf24",fontWeight:800,fontSize:mob?13:15}}>90 días de crédito</span>
          {" "}con{" "}
          <span style={{color:"#93c5fd",fontWeight:800,fontStyle:"italic"}}>Tapatía Credit</span>!
        </span>
        <span style={{fontSize:mob?14:16}}>🏆</span>
      </div>

      <div style={{background:CD,display:"flex",borderBottom:"1px solid "+BD,padding:mob?"0 8px":"0 24px",overflowX:"auto"}}>
        {[["products","📦 CATÁLOGO"],["quotes","📋 MIS COTIZACIONES"]].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)} style={{padding:mob?"10px 12px":"11px 18px",background:"none",border:"none",color:tab===k?OR:GRL,borderBottom:tab===k?"2px solid "+OR:"2px solid transparent",cursor:"pointer",fontSize:mob?11:12,fontWeight:700,letterSpacing:1,marginBottom:-1,whiteSpace:"nowrap"}}>{l}</button>
        ))}
      </div>

      <div style={{padding:mob?12:20,maxWidth:1400,margin:"0 auto"}}>
        {tab==="products"&&<>
          <div style={{background:"#fff7ed",borderLeft:"3px solid "+OR,border:"1px solid #fed7aa",borderRadius:4,padding:"8px 13px",marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
            <span style={{color:OR,fontWeight:700}}>i</span>
            <span style={{color:GRL,fontSize:11}}>Precios <strong style={{color:"#1a1a1a"}}>antes de IVA</strong>. <strong style={{color:"#dc2626"}}>Productos agrícolas no causan IVA.</strong></span>
          </div>
          {vend&&<div style={{background:"#f3e8ff",border:"1px solid #d8b4fe",borderRadius:4,padding:"8px 13px",marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
            <span style={{color:"#9333ea",fontWeight:700}}>★</span>
            <span style={{color:"#9333ea",fontSize:11,fontWeight:700}}>Modo Vendedor — Todos los precios visibles</span>
          </div>}
          {prodLoad&&<div style={{textAlign:"center",padding:40,color:GRL}}>Cargando productos...</div>}
          {!prodLoad&&<>
            <Buscador search={search} ds={ds} onChange={setSearch} count={filtered.length} mob={mob}/>
            {mob?(
              <div>{filtered.slice(page*PS,(page+1)*PS).map((p,i)=>{
                const tot=calcTotal(p),disp=tot>0,conIvaP=tieneIVA(p);
                return <div key={i} style={{background:CD,border:"1px solid "+BD,borderRadius:6,padding:12,marginBottom:8}}>
                  <div style={{fontFamily:"monospace",color:GRL,fontSize:10,marginBottom:2}}>{p.codigo}</div>
                  <div style={{fontSize:12,fontWeight:600,marginBottom:4,lineHeight:1.4}}>{p.descripcion}</div>
                  <div style={{fontSize:10,marginBottom:6,color:conIvaP?"#2563eb":"#dc2626",fontWeight:600}}>{conIvaP?"🧾 +IVA 16%":"🌾 Sin IVA"}</div>
                  {vend?<div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
                    <div style={{background:"#f0fdf4",borderRadius:4,padding:"4px 8px"}}><div style={{color:GRL,fontSize:9}}>PÚBLICO</div><div style={{color:"#16a34a",fontWeight:700,fontSize:12}}>{money(p.publico)}</div></div>
                    <div style={{background:"#eff6ff",borderRadius:4,padding:"4px 8px"}}><div style={{color:GRL,fontSize:9}}>DISTRIBUIDOR</div><div style={{color:"#2563eb",fontWeight:700,fontSize:12}}>{money(p.distribuidor)}</div></div>
                    <div style={{background:"#fff7ed",borderRadius:4,padding:"4px 8px"}}><div style={{color:GRL,fontSize:9}}>ASOCIADO</div><div style={{color:"#ea580c",fontWeight:700,fontSize:12}}>{money(p.asociado)}</div></div>
                  </div>:<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <span style={{color:GRL,fontSize:10}}>Almacén ppal: <strong>{almPpal(p)}</strong></span>
                    <span style={{color:OR,fontWeight:700,fontSize:14}}>{money(getPrecio(p,lista))}</span>
                  </div>}
                  <div style={{display:"flex",gap:8,marginBottom:6,flexWrap:"wrap",alignItems:"center"}}>
                    <span style={{color:nColor(tot),fontWeight:700,fontSize:11}}>Stock: {stockVis(tot)}</span>
                    <span style={{color:disp?"#16a34a":"#dc2626",fontSize:11,fontWeight:700}}>{disp?"● Disponible":"● Sin stock"}</span>
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
                    {ALMS.map((a,idx)=>{const v=safeNum(p[a]);return<div key={a} style={{background:v>0?"#f0fdf4":"#f9f9f9",border:"1px solid "+(v>0?"#bbf7d0":BD),borderRadius:3,padding:"2px 7px",textAlign:"center"}}>
                      <div style={{fontSize:9,color:GRL}}>{ALMS_L[idx]}</div>
                      <div style={{fontSize:11,fontWeight:700,color:v>0?nColor(v):"#ccc"}}>{v>=30?"+30":v}</div>
                    </div>;})}
                  </div>
                  <button onClick={()=>addToCart(p)} style={{width:"100%",padding:"8px",background:OR,color:"#fff",border:"none",borderRadius:4,cursor:"pointer",fontWeight:700,fontSize:12}}>＋ AGREGAR A COTIZACIÓN</button>
                </div>;
              })}</div>
            ):(
              <div style={{overflowX:"auto",border:"1px solid "+BD,borderRadius:6}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead><tr style={{background:"#f0f0f0"}}>
                    <th style={{padding:"9px 12px",textAlign:"left",color:OR,fontWeight:700,whiteSpace:"nowrap"}}>CÓDIGO</th>
                    <th style={{padding:"9px 12px",textAlign:"left",color:OR,fontWeight:700}}>DESCRIPCIÓN</th>
                    <th style={{padding:"9px 6px",textAlign:"center",color:GRL,fontSize:10}}>IVA</th>
                    {vend?<>
                      <th style={{padding:"9px 8px",textAlign:"right",color:"#16a34a",fontWeight:700}}>PÚBLICO</th>
                      <th style={{padding:"9px 8px",textAlign:"right",color:"#2563eb",fontWeight:700}}>DISTRIBUIDOR</th>
                      <th style={{padding:"9px 8px",textAlign:"right",color:"#ea580c",fontWeight:700}}>ASOCIADO</th>
                    </>:<th style={{padding:"9px 10px",textAlign:"right",color:OR,fontWeight:700}}>PRECIO</th>}
                    <th style={{padding:"9px 8px",textAlign:"right",color:OR,fontWeight:700}}>STOCK</th>
                    <th style={{padding:"9px 8px",textAlign:"center",color:GRL,fontSize:10}}>PPAL</th>
                    {ALMS_L.map(a=><th key={a} style={{padding:"9px 6px",textAlign:"right",color:GRL,fontSize:10,whiteSpace:"nowrap"}}>{a}</th>)}
                    <th style={{padding:"9px 8px",textAlign:"center",color:GRL,fontSize:10}}>DISP.</th>
                    <th style={{padding:"9px 6px",width:34}}></th>
                  </tr></thead>
                  <tbody>{filtered.slice(page*PS,(page+1)*PS).map((p,i)=>{
                    const tot=calcTotal(p),disp=tot>0,conIvaP=tieneIVA(p);
                    return <tr key={i} style={{borderTop:"1px solid "+BD,background:i%2===0?CD:"#fafafa"}}>
                      <td style={{padding:"7px 12px",fontFamily:"monospace",color:GRL,whiteSpace:"nowrap",fontSize:11}}>{p.codigo}</td>
                      <td style={{padding:"7px 12px",minWidth:260}}>{p.descripcion}</td>
                      <td style={{padding:"7px 6px",textAlign:"center",fontSize:10,fontWeight:700,color:conIvaP?"#2563eb":"#dc2626"}}>{conIvaP?"16%":"0%"}</td>
                      {vend?<>
                        <td style={{padding:"7px 8px",textAlign:"right",color:"#16a34a",fontWeight:600}}>{money(p.publico)}</td>
                        <td style={{padding:"7px 8px",textAlign:"right",color:"#2563eb",fontWeight:600}}>{money(p.distribuidor)}</td>
                        <td style={{padding:"7px 8px",textAlign:"right",color:"#ea580c",fontWeight:600}}>{money(p.asociado)}</td>
                      </>:<td style={{padding:"7px 10px",textAlign:"right",fontWeight:700,color:OR,whiteSpace:"nowrap"}}>{money(getPrecio(p,lista))}</td>}
                      <td style={{padding:"7px 8px",textAlign:"right",fontWeight:700,color:nColor(tot)}}>{stockVis(tot)}</td>
                      <td style={{padding:"7px 8px",textAlign:"center",color:GRL,fontSize:11}}>{almPpal(p)}</td>
                      {ALMS.map(a=>{const v=safeNum(p[a]);return<td key={a} style={{padding:"7px 6px",textAlign:"right",fontSize:11,color:v>0?nColor(v):"#ccc",fontWeight:v>0?600:400}}>{v>=30?"+30":v}</td>;})}
                      <td style={{padding:"7px 8px",textAlign:"center"}}><span style={{color:disp?"#16a34a":"#dc2626",fontWeight:700,fontSize:10}}>{disp?"SÍ":"NO"}</span></td>
                      <td style={{padding:"6px 8px"}}>
                        <button onClick={()=>addToCart(p)} title="Agregar"
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
        {tab==="quotes"&&<HistorialCotizaciones session={session} db={db} mob={mob}/>}
      </div>
    </div>
  );
}