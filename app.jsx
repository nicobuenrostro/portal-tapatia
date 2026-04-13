import { useState, useEffect, useMemo, useRef } from "react";
import {
  initializeApp
} from "firebase/app";
import {
  getFirestore, collection, getDocs, doc, setDoc,
  deleteDoc, writeBatch, getDoc
} from "firebase/firestore";

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
// NUNCA pisa el estado si hay error — retorna null en caso de fallo
async function fbGetUsuarios(){
  try {
    // Sin orderBy para evitar error si falta índice o campo nombre
    const snap=await getDocs(collection(db,"usuarios"));
    if(snap.empty) return [];
    const data=snap.docs.map(d=>({id:d.id,...d.data()}));
    // Ordenar en cliente para no depender de índices Firebase
    return data.sort((a,b)=>(a.nombre||"").localeCompare(b.nombre||""));
  } catch(e){
    console.error("Error leyendo usuarios:",e);
    return null;
  }
}

async function fbGetProductos(){
  try {
    // Sin orderBy para evitar error si falta índice
    const snap=await getDocs(collection(db,"productos"));
    if(snap.empty) return [];
    const data=snap.docs.map(d=>({id:d.id,...d.data()}));
    // Ordenar en cliente
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

// ── CSV parser ────────────────────────────────────────────────
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
    VENDEDOR:{bg:"#f3e8ff",c:"#9333ea"},activo:{bg:"#dcfce7",c:"#16a34a"},
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
      // Actualizar sesión local
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
      // Verificar que no exista
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
  const [view,     setView]     = useState(()=>{ try{const s=localStorage.getItem("gt_session");if(s){const u=JSON.parse(s);return u.rol==="admin"?"admin":"client";}}catch(e){}return "login"; });
  const [tab,      setTab]      = useState("products");
  const [users,    setUsers]    = useState([]);
  const [products, setProducts] = useState([]);
  const [prodLoad, setProdLoad] = useState(false);
  const [userLoad, setUserLoad] = useState(false);
  const [search,   setSearch]   = useState("");
  const [ds,       setDs]       = useState("");
  const [page,     setPage]     = useState(0);
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

  // Debounce buscador
  useEffect(()=>{
    if(dbRef.current)clearTimeout(dbRef.current);
    dbRef.current=setTimeout(()=>{setDs(search);setPage(0);},300);
    return()=>{if(dbRef.current)clearTimeout(dbRef.current);};
  },[search]);

  // Cargar productos al entrar
  useEffect(()=>{
    if(session) loadProducts();
    if(session?.rol==="admin") loadUsers();
  },[session]);

  // ── Cargar productos — NUNCA pisa estado si hay error ──────
  async function loadProducts(){
    setProdLoad(true);
    const data = await fbGetProductos();
    if(data !== null) setProducts(data); // solo actualiza si no hubo error
    else console.warn("No se pudieron cargar productos — manteniendo estado anterior");
    setProdLoad(false);
  }

  // ── Cargar usuarios — NUNCA pisa estado si hay error ──────
  async function loadUsers(){
    setUserLoad(true);
    const data = await fbGetUsuarios();
    if(data !== null){
      // Filtrar admin del listado visible pero NO borrar nada
      setUsers(data.filter(u=>u.rol!=="admin"));
    } else {
      console.warn("No se pudieron cargar usuarios — manteniendo estado anterior");
    }
    setUserLoad(false);
  }

  // ── Login ──────────────────────────────────────────────────
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
      setView(u.rol==="admin"?"admin":"client");
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

  // ── Subir CSV ──────────────────────────────────────────────
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
          actualizado: new Date().toISOString(),
        })).filter(p=>p.codigo); // solo productos con código válido

        if(mapped.length===0){setMsg("❌ No hay productos válidos en el archivo.");return;}

        // 1. Respaldar versión anterior
        setMsg("💾 Respaldando versión anterior...");
        const oldSnap=await getDocs(collection(db,"productos"));
        if(oldSnap.docs.length>0){
          const ts=new Date().toISOString().replace(/[:.]/g,"-").slice(0,19);
          const bkBatch=writeBatch(db);
          oldSnap.docs.forEach(d=>bkBatch.set(doc(db,`respaldo_${ts}`,d.id),d.data()));
          await bkBatch.commit();
        }

        // 2. Borrar productos anteriores
        setMsg("🗑️ Eliminando versión anterior...");
        if(oldSnap.docs.length>0){
          const delBatch=writeBatch(db);
          oldSnap.docs.forEach(d=>delBatch.delete(d.ref));
          await delBatch.commit();
        }

        // 3. Insertar nuevos en lotes de 400
        const chunk=400;
        for(let i=0;i<mapped.length;i+=chunk){
          const batch=writeBatch(db);
          mapped.slice(i,i+chunk).forEach((p,j)=>{
            batch.set(doc(collection(db,"productos"),`p_${String(i+j).padStart(6,"0")}`),p);
          });
          await batch.commit();
          setMsg(`⏳ ${Math.min(i+chunk,mapped.length)} / ${mapped.length} productos guardados...`);
        }

        // 4. Verificar que se guardaron
        const verify=await getDocs(collection(db,"productos"));
        if(verify.size===0){
          setMsg("❌ ERROR CRÍTICO: Los productos no se guardaron correctamente. Revisa Firebase.");
          return;
        }

        // 5. Bitácora
        await setDoc(doc(db,"bitacora",`carga_${Date.now()}`),{
          tipo:"carga_productos",
          por:session.nombre,
          cantidad:mapped.length,
          fecha:new Date().toISOString(),
        });

        await loadProducts();
        setMsg(`✅ ${mapped.length} productos guardados y verificados en Firebase.`);
      } catch(err){
        setMsg("❌ ERROR: "+err.message);
        console.error("Error al subir CSV:",err);
      }
    };
    reader.readAsText(file,"UTF-8");
  }

  // ── Guardar usuario ────────────────────────────────────────
  async function saveClient(form){
    setSaving(true);
    try {
      // Validar campos
      if(!form.nombre?.trim()||!form.usuario?.trim()){
        alert("Nombre y usuario son obligatorios.");setSaving(false);return;
      }
      if(!form.id&&!form.password?.trim()){
        alert("La contraseña es obligatoria para usuarios nuevos.");setSaving(false);return;
      }

      // Verificar duplicado solo en creación
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

      // Guardar con merge:true para NO borrar campos existentes
      await setDoc(doc(db,"usuarios",id),data,{merge:true});

      // Verificar que se guardó
      const verify=await getDoc(doc(db,"usuarios",id));
      if(!verify.exists()){
        alert("❌ ERROR: El usuario no se guardó. Intenta de nuevo.");setSaving(false);return;
      }

      // Bitácora
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

  // ── Toggle estatus ─────────────────────────────────────────
  async function toggleEstatus(id,est){
    try {
      // Solo actualizar el campo estatus, no tocar nada más
      await setDoc(doc(db,"usuarios",id),{
        estatus: est==="activo"?"inactivo":"activo",
        actualizado: new Date().toISOString()
      },{merge:true});
      // Actualizar estado local sin recargar todo
      setUsers(prev=>prev.map(u=>u.id===id?{...u,estatus:est==="activo"?"inactivo":"activo"}:u));
    } catch(err){
      alert("❌ Error al cambiar estatus: "+err.message);
    }
  }

  // ── Eliminar usuario ───────────────────────────────────────
  async function deleteClient(id,nombre){
    if(!window.confirm(`¿Eliminar a ${nombre}? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteDoc(doc(db,"usuarios",id));
      // Bitácora
      await setDoc(doc(db,"bitacora",`del_${Date.now()}`),{
        tipo:"eliminacion_usuario",
        usuario_id:id,
        usuario_nombre:nombre,
        por:session.nombre,
        fecha:new Date().toISOString(),
      });
      // Actualizar estado local sin recargar todo
      setUsers(prev=>prev.filter(u=>u.id!==id));
    } catch(err){
      alert("❌ Error al eliminar: "+err.message);
    }
  }

  // ── Filtrado ───────────────────────────────────────────────
  const filtered=useMemo(()=>{
    const q=ds.trim();
    if(!q)return products;
    return products.filter(p=>smartMatch(q,p));
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
      {!mob&&<><div style={{width:1,height:24,background:"rgba(255,255,255,0.3)"}}/><span style={{color:"rgba(255,255,255,0.9)",fontSize:10,letterSpacing:2}}>{session.rol==="admin"?"PANEL ADMINISTRADOR":"PORTAL DE PRECIOS"}</span></>}
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
    <div style={{background:CD,display:"flex",borderBottom:"1px solid "+BD,padding:mob?"0 8px":"0 24px",overflowX:"auto",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
      {[["products","📦 PRODUCTOS"],["clients","👥 CLIENTES"],["settings","⚙️ CONFIG"]].map(([k,l])=>(
        <button key={k} onClick={()=>setTab(k)} style={{padding:mob?"10px 12px":"11px 18px",background:"none",border:"none",
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
              </tr>;
            })}</tbody>
          </table>
        </div>}
        <Pager total={filtered.length} pg={page} setPg={setPage} ps={PS}/>
      </div>}

      {tab==="clients"&&<div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div>
            <span style={{color:GRL,fontSize:11}}>{users.length} clientes registrados</span>
            {userLoad&&<span style={{color:OR,fontSize:11,marginLeft:8}}>cargando...</span>}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={loadUsers} style={{background:"#f0f0f0",color:GRL,border:"1px solid "+BD,padding:"8px 14px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:700}}>↻ RECARGAR</button>
            <Btn onClick={()=>setModal({mode:"create",data:{}})}>+ NUEVO CLIENTE</Btn>
          </div>
        </div>
        {mob?(
          <div>{users.map(u=><div key={u.id} style={{background:CD,border:"1px solid "+BD,borderRadius:6,padding:14,marginBottom:8,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <div><div style={{fontWeight:700,fontSize:13}}>{u.nombre}</div>{u.empresa&&<div style={{color:GRL,fontSize:11}}>{u.empresa}</div>}</div>
              <Badge val={u.estatus}/>
            </div>
            <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}><Badge val={u.lista}/><span style={{color:GRL,fontSize:11,fontFamily:"monospace"}}>@{u.usuario}</span></div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              <Btn sm onClick={()=>setModal({mode:"edit",data:{...u}})}>EDITAR</Btn>
              <Btn sm ghost onClick={()=>toggleEstatus(u.id,u.estatus)}>{u.estatus==="activo"?"DESACTIVAR":"ACTIVAR"}</Btn>
              <Btn sm danger onClick={()=>deleteClient(u.id,u.nombre)}>ELIMINAR</Btn>
            </div>
          </div>)}</div>
        ):(
          <div style={{border:"1px solid "+BD,borderRadius:6,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr style={{background:"#f0f0f0"}}>{["NOMBRE","EMPRESA","USUARIO","TIPO","ESTATUS","ACCIONES"].map(h=><th key={h} style={{padding:"9px 14px",textAlign:"left",color:OR,fontWeight:700,fontSize:10,letterSpacing:1}}>{h}</th>)}</tr></thead>
              <tbody>{users.map((u,i)=><tr key={u.id} style={{borderTop:"1px solid "+BD,background:i%2===0?CD:"#fafafa"}}>
                <td style={{padding:"9px 14px",fontWeight:600}}>{u.nombre}</td>
                <td style={{padding:"9px 14px",color:GRL,fontSize:11}}>{u.empresa||"—"}</td>
                <td style={{padding:"9px 14px",fontFamily:"monospace",color:GRL,fontSize:11}}>{u.usuario}</td>
                <td style={{padding:"9px 14px"}}><Badge val={u.lista}/></td>
                <td style={{padding:"9px 14px"}}><Badge val={u.estatus}/></td>
                <td style={{padding:"9px 14px"}}><div style={{display:"flex",gap:6}}>
                  <Btn sm onClick={()=>setModal({mode:"edit",data:{...u}})}>EDITAR</Btn>
                  <Btn sm ghost onClick={()=>toggleEstatus(u.id,u.estatus)}>{u.estatus==="activo"?"DESACTIVAR":"ACTIVAR"}</Btn>
                  <Btn sm danger onClick={()=>deleteClient(u.id,u.nombre)}>ELIMINAR</Btn>
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </div>}

      {tab==="settings"&&<div style={{maxWidth:520}}>
        {/* Cambiar contraseña */}
        <div style={{background:CD,border:"1px solid "+BD,borderRadius:6,padding:24,marginBottom:16,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
          <div style={{fontWeight:700,fontSize:13,color:OR,marginBottom:16}}>🔑 CAMBIAR MI CONTRASEÑA</div>
          <ChangePassword session={session} db={db} hashPassword={hashPassword} checkPassword={checkPassword}/>
        </div>
        {/* Crear admin */}
        <div style={{background:CD,border:"1px solid "+BD,borderRadius:6,padding:24,marginBottom:16,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
          <div style={{fontWeight:700,fontSize:13,color:OR,marginBottom:16}}>👤 CREAR USUARIO ADMINISTRADOR</div>
          <CreateAdmin session={session} db={db} hashPassword={hashPassword}/>
        </div>
        {/* Info sistema */}
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
    </div>
  </div>;

  // ════ CLIENTE / VENDEDOR ════════════════════════════════════
  const lista=session?.lista, isVend=lista==="VENDEDOR";
  return <div style={{minHeight:"100vh",background:DK,fontFamily:"Arial,sans-serif",color:"#1a1a1a"}}>
    {Hdr}
    <div style={{background:"linear-gradient(90deg,#e05500,#c44a00)",padding:"8px "+(mob?"12px":"24px"),display:"flex",alignItems:"center",gap:8}}>
      <span style={{color:"#fff",fontSize:14}}>★</span>
      <span style={{color:"#fff",fontSize:mob?11:13,fontWeight:700}}>CONTADO ANTICIPADO: <span style={{color:"#ffe0c0"}}>3% DESCUENTO ADICIONAL</span></span>
    </div>
    <div style={{padding:mob?12:20,maxWidth:1400,margin:"0 auto"}}>
      <div style={{background:"#fff7ed",borderLeft:"3px solid "+OR,border:"1px solid #fed7aa",borderRadius:4,padding:"8px 13px",marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
        <span style={{color:OR,fontWeight:700}}>i</span>
        <span style={{color:GRL,fontSize:11}}>Precios <strong style={{color:"#1a1a1a"}}>antes de IVA</strong>. El impuesto se aplicará al facturar.</span>
      </div>
      {isVend&&<div style={{background:"#f3e8ff",border:"1px solid #d8b4fe",borderRadius:4,padding:"8px 13px",marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
        <span style={{color:"#9333ea",fontWeight:700}}>★</span>
        <span style={{color:"#9333ea",fontSize:11,fontWeight:700}}>Modo Vendedor — Todos los precios visibles</span>
      </div>}
      {prodLoad&&<div style={{textAlign:"center",padding:40,color:GRL}}>Cargando productos de Firebase...</div>}
      {!prodLoad&&<>
        <Buscador search={search} ds={ds} onChange={setSearch} count={filtered.length} mob={mob}/>
        {mob?(
          <div>{filtered.slice(page*PS,(page+1)*PS).map((p,i)=>{
            const tot=calcTotal(p),disp=tot>0;
            return <div key={i} style={{background:CD,border:"1px solid "+BD,borderRadius:6,padding:12,marginBottom:8,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
              <div style={{fontFamily:"monospace",color:GRL,fontSize:10,marginBottom:2}}>{p.codigo}</div>
              <div style={{fontSize:12,fontWeight:600,marginBottom:8,lineHeight:1.4}}>{p.descripcion}</div>
              <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap"}}>
                <span style={{color:nColor(tot),fontWeight:700,fontSize:11}}>Stock: {stockVis(tot)}</span>
                <span style={{color:disp?"#16a34a":"#dc2626",fontSize:11,fontWeight:700}}>{disp?"● Disponible":"● Sin stock"}</span>
              </div>
              {isVend?<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <div style={{background:"#f0fdf4",borderRadius:4,padding:"4px 8px"}}><div style={{color:GRL,fontSize:9}}>PÚBLICO</div><div style={{color:"#16a34a",fontWeight:700,fontSize:12}}>{money(p.publico)}</div></div>
                <div style={{background:"#eff6ff",borderRadius:4,padding:"4px 8px"}}><div style={{color:GRL,fontSize:9}}>DISTRIBUIDOR</div><div style={{color:"#2563eb",fontWeight:700,fontSize:12}}>{money(p.distribuidor)}</div></div>
                <div style={{background:"#fff7ed",borderRadius:4,padding:"4px 8px"}}><div style={{color:GRL,fontSize:9}}>ASOCIADO</div><div style={{color:"#ea580c",fontWeight:700,fontSize:12}}>{money(p.asociado)}</div></div>
              </div>:<div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{color:GRL,fontSize:10}}>{almPpal(p)}</span>
                <span style={{color:OR,fontWeight:700,fontSize:14}}>{money(getPrecio(p,lista))}</span>
              </div>}
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
                <th style={{padding:"9px 8px",textAlign:"right",color:GRL}}>STOCK</th>
                <th style={{padding:"9px 8px",textAlign:"center",color:GRL}}>DISP.</th>
                <th style={{padding:"9px 8px",textAlign:"center",color:GRL}}>NIVEL</th>
                <th style={{padding:"9px 8px",textAlign:"center",color:GRL,whiteSpace:"nowrap"}}>ALM. PPAL</th>
                <th style={{padding:"9px 8px",textAlign:"left",color:GRL,whiteSpace:"nowrap"}}>ALMACENES</th>
              </tr></thead>
              <tbody>{filtered.slice(page*PS,(page+1)*PS).map((p,i)=>{
                const tot=calcTotal(p),disp=tot>0;
                return <tr key={i} style={{borderTop:"1px solid "+BD,background:i%2===0?CD:"#fafafa"}}>
                  <td style={{padding:"7px 12px",fontFamily:"monospace",color:GRL,whiteSpace:"nowrap",fontSize:11}}>{p.codigo}</td>
                  <td style={{padding:"7px 12px",minWidth:300}}>{p.descripcion}</td>
                  {isVend?<>
                    <td style={{padding:"7px 8px",textAlign:"right",color:"#16a34a",fontWeight:600}}>{money(p.publico)}</td>
                    <td style={{padding:"7px 8px",textAlign:"right",color:"#2563eb",fontWeight:600}}>{money(p.distribuidor)}</td>
                    <td style={{padding:"7px 8px",textAlign:"right",color:"#ea580c",fontWeight:600}}>{money(p.asociado)}</td>
                  </>:<td style={{padding:"7px 10px",textAlign:"right",fontWeight:700,color:OR,whiteSpace:"nowrap"}}>{money(getPrecio(p,lista))}</td>}
                  <td style={{padding:"7px 8px",textAlign:"right",fontWeight:700,color:nColor(tot)}}>{stockVis(tot)}</td>
                  <td style={{padding:"7px 8px",textAlign:"center"}}><span style={{color:disp?"#16a34a":"#dc2626",fontWeight:700,fontSize:10}}>{disp?"SÍ":"NO"}</span></td>
                  <td style={{padding:"7px 8px",textAlign:"center"}}><span style={{color:nColor(tot),fontWeight:700,fontSize:10}}>{nLabel(tot)}</span></td>
                  <td style={{padding:"7px 8px",textAlign:"center",color:GRL,fontSize:11}}>{almPpal(p)}</td>
                  <td style={{padding:"7px 8px",color:GRL,fontSize:10}}>{almsDisp(p)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
        <Pager total={filtered.length} pg={page} setPg={setPage} ps={PS}/>
      </>}
    </div>
  </div>;
}