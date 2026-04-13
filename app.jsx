import { useState, useEffect, useMemo, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc, query, orderBy, writeBatch } from "firebase/firestore";


// ── Firebase config ───────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDb5e9x1c73eFxOp4hd2BjEsqmYL2_JTvY",
  authDomain: "portal-tapatia.firebaseapp.com",
  projectId: "portal-tapatia",
  storageBucket: "portal-tapatia.firebasestorage.app",
  messagingSenderId: "252152037275",
  appId: "1:252152037275:web:99356044c89eff2203ab3e",
  measurementId: "G-KV7PV687LG"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// ── Brand ─────────────────────────────────────────────────────
const OR  = "#FF6B06";
const GRL = "#6b6b6b";
const DK  = "#f4f4f4";
const CD  = "#ffffff";
const BD  = "#e0e0e0";
const ALMS = ["gdl1","gdl3","ags","col","len","cul"];
const ALMS_L = ["GDL1","GDL3","AGS","COL","LEN","CUL"];

// ── Helpers ───────────────────────────────────────────────────
const money = n => (!n||isNaN(n)||Number(n)===0)?"—":new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN",minimumFractionDigits:2}).format(n);
const calcTotal = p => ALMS.reduce((t,a)=>t+(Number(p[a])||0),0);
const stockVis  = t => t>=30?"+30":t;
const nColor    = t => t===0?"#dc2626":t<=5?"#ea580c":t<=20?"#d97706":"#16a34a";
const nLabel    = t => t===0?"Sin stock":t<=5?"Bajo":t<=20?"Medio":"Alto";
const almPpal   = p => ALMS_L[ALMS.findIndex(a=>(Number(p[a])||0)>0)]||"—";
const almsDisp  = p => ALMS.map((a,i)=>(Number(p[a])||0)>0?ALMS_L[i]:null).filter(Boolean).join(", ")||"—";
const getPrecio = (p,l) => l==="PUBLICO"||l==="PÚBLICO"?p.publico||0:l==="DISTRIBUIDOR"?p.distribuidor||0:l==="ASOCIADO"?p.asociado||0:0;

// Hash simple para contraseñas (sin bcrypt en browser, usamos SHA-256)
async function hashPassword(pwd) {
  const enc = new TextEncoder().encode(pwd);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function checkPassword(pwd, hash) {
  return await hashPassword(pwd) === hash;
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
      if(b.length===a+bv+cv){const p1=b.slice(0,a),p2=b.slice(a,a+bv),p3=b.slice(a+bv);vars.push(p1+"."+p2+"-"+p3,p1+p2+"-"+p3,p1+"."+p2+"R"+p3,p1+" "+p2+" "+p3,p1+p2+p3);}
    });
  }
  const seen={};return vars.filter(v=>{const t=String(v).trim();return t&&!seen[t]&&(seen[t]=true);});
}
function exMedidas(desc){
  if(!desc)return[];
  const s=String(desc).toUpperCase(),found=[];
  [/\d{3}\/\d{2}[R]\d{2,3}(?:\.\d)?/g,/\d{2,3}[X]\d{2,3}(?:\.\d{2})?[-R]\d{2,3}/g,/\d{1,3}\.\d{2,3}[-\/R]\d{2,3}/g,/\d{2}\.?\d{1,2}[-\/R]\d{2,3}/g,/\d{2,3}\s\d{1,3}\s\d{2,3}/g]
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
function detectTipo(s){const u=cIn(s);if(/\d{3}\/\d{2}R\d/.test(u))return"Radial métrica";if(/\d+X[\d\.]+R\d/.test(u))return"Flotación radial";if(/\d+X[\d\.]+[-]\d/.test(u))return"Flotación";if(/\d+[\.\-]\d+[-\/R]\d/.test(u))return"Convencional";if(/^\d{4,8}$/.test(strp(u)))return"Numérica";return"";}

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
  const map={PUBLICO:{bg:"#dcfce7",c:"#16a34a"},PÚBLICO:{bg:"#dcfce7",c:"#16a34a"},DISTRIBUIDOR:{bg:"#dbeafe",c:"#2563eb"},ASOCIADO:{bg:"#fff7ed",c:"#ea580c"},VENDEDOR:{bg:"#f3e8ff",c:"#9333ea"},activo:{bg:"#dcfce7",c:"#16a34a"},inactivo:{bg:"#fee2e2",c:"#dc2626"}};
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
function Btn({onClick,children,danger,ghost,sm}){
  const bg=danger?"#fee2e2":ghost?"transparent":OR;
  const cl=danger?"#dc2626":ghost?GRL:"#fff";
  const br=danger?"1px solid #fca5a5":ghost?"1px solid "+BD:"none";
  return <button onClick={onClick} style={{background:bg,color:cl,border:br,padding:sm?"4px 10px":"9px 16px",borderRadius:4,cursor:"pointer",fontWeight:700,fontSize:sm?10:12,letterSpacing:1,whiteSpace:"nowrap"}}>{children}</button>;
}
function LogoSVG({white,h=36}){
  const gc=white?"#fff":"#7C7C7C",oc=white?"#fff":OR;
  return <svg height={h} viewBox="0 0 140 50" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 8 Q8 4 12 4 L30 4 L30 10 L14 10 Q12 10 12 12 L12 38 Q12 40 14 40 L28 40 L28 28 L20 28 L20 22 L34 22 L34 40 Q34 46 28 46 L12 46 Q6 46 6 40 L6 12 Q6 6 8 6 Z" fill={gc}/>
    <path d="M42 4 L78 4 L78 12 L64 12 L64 46 L56 46 L56 12 L42 12 Z" fill={gc}/>
    <polygon points="22,8 24.5,15.5 32,15.5 26,20 28.5,27.5 22,23 15.5,27.5 18,20 12,15.5 19.5,15.5" fill={oc}/>
    <text x="88" y="20" fontFamily="Arial Narrow,Arial,sans-serif" fontWeight="600" fontSize="13" letterSpacing="3" fill={gc}>GRUPO</text>
    <text x="86" y="40" fontFamily="Arial Narrow,Arial,sans-serif" fontWeight="700" fontSize="16" letterSpacing="2" fill={oc}>TAPATÍA</text>
  </svg>;
}

// Buscador fuera de App para no perder foco
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

// ════════════════════════════════════════════════════════════
// APP
// ════════════════════════════════════════════════════════════
export default function App(){
  const [session, setSession] = useState(null);
  const [view,    setView]    = useState("login");
  const [tab,     setTab]     = useState("products");
  const [users,   setUsers]   = useState([]);
  const [products,setProducts]= useState([]);
  const [loading, setLoading] = useState(false);
  const [search,  setSearch]  = useState("");
  const [ds,      setDs]      = useState("");
  const [page,    setPage]    = useState(0);
  const PS = 50;
  const [lu,setLu]=useState(""); const [lp,setLp]=useState(""); const [lerr,setLerr]=useState("");
  const [msg,setMsg]=useState("");
  const [modal,setModal]=useState(null);
  const [mob,setMob]=useState(window.innerWidth<768);
  const fref=useRef(); const dbRef=useRef(null);
  const emptyC={nombre:"",empresa:"",usuario:"",password:"",lista:"DISTRIBUIDOR",estatus:"activo"};

  useEffect(()=>{const h=()=>setMob(window.innerWidth<768);window.addEventListener("resize",h);return()=>window.removeEventListener("resize",h);},[]);

  // Debounce
  useEffect(()=>{
    if(dbRef.current)clearTimeout(dbRef.current);
    dbRef.current=setTimeout(()=>{setDs(search);setPage(0);},300);
    return()=>{if(dbRef.current)clearTimeout(dbRef.current);};
  },[search]);

  // Login con Firestore
  async function doLogin(){
    setLerr(""); setLoading(true);
    try {
      const snap = await getDocs(query(collection(db,"usuarios")));
      const allUsers = snap.docs.map(d=>({id:d.id,...d.data()}));
      const u = allUsers.find(u=>u.usuario===lu.trim());
      if(!u){ setLerr("Usuario o contraseña incorrectos"); setLoading(false); return; }
      const ok = await checkPassword(lp.trim(), u.password);
      if(!ok){ setLerr("Usuario o contraseña incorrectos"); setLoading(false); return; }
      if(u.estatus==="inactivo"){ setLerr("Cuenta inactiva. Contacta al administrador."); setLoading(false); return; }
      setSession(u); setView(u.rol==="admin"?"admin":"client");
      setLu(""); setLp("");
      loadProducts();
      if(u.rol==="admin") loadUsers();
    } catch(e){ setLerr("Error de conexión: "+e.message); }
    setLoading(false);
  }

  function doLogout(){ setSession(null); setView("login"); setSearch(""); setDs(""); setPage(0); setProducts([]); setUsers([]); }

  async function loadProducts(){
    const snap = await getDocs(query(collection(db,"productos"),orderBy("codigo")));
    setProducts(snap.docs.map(d=>({id:d.id,...d.data()})));
  }

  async function loadUsers(){
    const snap = await getDocs(query(collection(db,"usuarios"),orderBy("nombre")));
    setUsers(snap.docs.map(d=>({id:d.id,...d.data()})).filter(u=>u.rol!=="admin"));
  }

  // Subir CSV → Firestore
  async function handleFile(e){
    const file=e.target.files[0]; if(!file)return; e.target.value="";
    if(file.name.endsWith(".xlsx")||file.name.endsWith(".xls")){ setMsg("⚠️ Guarda como CSV UTF-8 desde Excel."); return; }
    setMsg("Procesando...");
    const reader=new FileReader();
    reader.onload=async ev=>{
      try {
        const rows=parseCsv(ev.target.result);
        if(rows.length===0){ setMsg("❌ No se encontró columna CÓDIGO."); return; }
        setMsg("Guardando "+rows.length+" productos en la base de datos...");
        // Borrar productos anteriores
        const oldSnap=await getDocs(collection(db,"productos"));
        const batchDel=writeBatch(db);
        oldSnap.docs.forEach(d=>batchDel.delete(d.ref));
        await batchDel.commit();
        // Insertar nuevos en lotes de 500
        const mapped=rows.map(r=>({
          codigo:     String(r.CODIGO||r["CÓDIGO"]||""),
          descripcion:String(r.DESCRIPCION||r["DESCRIPCIÓN"]||""),
          gdl1:Number(r.GDL1||0), gdl3:Number(r.GDL3||0),
          ags:Number(r.AGS||0),   col:Number(r.COL||0),
          len:Number(r.LEN||0),   cul:Number(r.CUL||0),
          publico:     Number(r.PUBLICO||r["PÚBLICO"]||0),
          distribuidor:Number(r.DISTRIBUIDOR||0),
          asociado:    Number(r.ASOCIADO||0),
          actualizado: new Date().toISOString(),
        }));
        const chunkSize=400;
        for(let i=0;i<mapped.length;i+=chunkSize){
          const batch=writeBatch(db);
          mapped.slice(i,i+chunkSize).forEach((p,j)=>batch.set(doc(collection(db,"productos"),`p_${i+j}`),p));
          await batch.commit();
        }
        await loadProducts();
        setMsg("✅ "+mapped.length+" productos guardados. Todos los usuarios ven los cambios al instante.");
      } catch(err){ setMsg("❌ Error: "+err.message); }
    };
    reader.readAsText(file,"UTF-8");
  }

  // Guardar cliente
  async function saveClient(form){
    const id = form.id || "u_"+Date.now();
    const data = {
      nombre:  form.nombre,
      empresa: form.empresa||"",
      usuario: form.usuario,
      lista:   form.lista,
      estatus: form.estatus,
      rol:     "client",
    };
    if(form.password) data.password = await hashPassword(form.password);
    await setDoc(doc(db,"usuarios",id), data, {merge:true});
    await loadUsers();
    setModal(null);
  }

  async function toggleEstatus(id,est){
    await setDoc(doc(db,"usuarios",id),{estatus:est==="activo"?"inactivo":"activo"},{merge:true});
    await loadUsers();
  }
  async function deleteClient(id){
    await deleteDoc(doc(db,"usuarios",id));
    await loadUsers();
  }

  const filtered=useMemo(()=>{
    const q=ds.trim(); if(!q)return products;
    return products.filter(p=>smartMatch(q,p));
  },[products,ds]);

  // Modal cliente
  function ClientModal(){
    const isEdit=modal.mode==="edit";
    const [form,setForm]=useState(isEdit?{...modal.data,password:""}:{...emptyC});
    const upd=(k,v)=>setForm(p=>({...p,[k]:v}));
    return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
      <div style={{background:CD,border:"1px solid "+BD,borderRadius:8,padding:24,width:"100%",maxWidth:460,boxShadow:"0 8px 40px rgba(0,0,0,0.15)",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{fontWeight:700,fontSize:14,color:OR,marginBottom:18}}>{isEdit?"EDITAR CLIENTE":"NUEVO CLIENTE"}</div>
        <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:"0 14px"}}>
          <Inp label="NOMBRE *"   value={form.nombre}   onChange={e=>upd("nombre",e.target.value)}/>
          <Inp label="EMPRESA"    value={form.empresa||""} onChange={e=>upd("empresa",e.target.value)}/>
          <Inp label="USUARIO *"  value={form.usuario}  onChange={e=>upd("usuario",e.target.value)}/>
          <Inp label={isEdit?"NUEVA CONTRASEÑA":"CONTRASEÑA *"} value={form.password} onChange={e=>upd("password",e.target.value)} type="password"/>
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
          <Btn onClick={()=>{if(!form.nombre||!form.usuario||(!isEdit&&!form.password))return;saveClient(form);}}>GUARDAR</Btn>
        </div>
      </div>
    </div>;
  }

  const Hdr = session&&<div style={{background:CD,borderBottom:"2px solid "+OR,padding:mob?"10px 14px":"11px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",boxShadow:"0 2px 8px rgba(0,0,0,0.06)"}}>
    <div style={{display:"flex",alignItems:"center",gap:12}}>
      <LogoSVG h={mob?28:34}/>
      {!mob&&<><div style={{width:1,height:24,background:BD}}/><span style={{color:GRL,fontSize:10,letterSpacing:2}}>{session.rol==="admin"?"PANEL ADMINISTRADOR":"PORTAL DE PRECIOS"}</span></>}
    </div>
    <div style={{display:"flex",alignItems:"center",gap:10}}>
      {!mob&&<div style={{textAlign:"right"}}><div style={{color:"#1a1a1a",fontSize:12,fontWeight:600}}>{session.nombre}</div>{session.empresa&&<div style={{color:GRL,fontSize:10}}>{session.empresa}</div>}</div>}
      <Btn onClick={doLogout} ghost>SALIR</Btn>
    </div>
  </div>;

  // ── LOGIN ──
  if(view==="login") return <div style={{minHeight:"100vh",background:DK,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Arial,sans-serif",padding:16}}>
    <div style={{width:"100%",maxWidth:360,background:CD,borderRadius:8,overflow:"hidden",boxShadow:"0 8px 40px rgba(0,0,0,0.12)"}}>
      <div style={{background:OR,padding:"22px 28px",display:"flex",justifyContent:"center"}}><LogoSVG h={40} white/></div>
      <div style={{padding:"26px 28px 24px"}}>
        <div style={{color:GRL,fontSize:11,letterSpacing:3,textAlign:"center",marginBottom:20}}>PORTAL DE PRECIOS</div>
        <Inp label="USUARIO"    value={lu} onChange={e=>setLu(e.target.value)}/>
        <Inp label="CONTRASEÑA" value={lp} onChange={e=>setLp(e.target.value)} type="password" mb={20}/>
        {lerr&&<div style={{color:"#dc2626",fontSize:12,textAlign:"center",marginBottom:12}}>{lerr}</div>}
        <button onClick={doLogin} disabled={loading}
          style={{width:"100%",padding:"12px",background:OR,color:"#fff",border:"none",borderRadius:4,fontSize:13,fontWeight:700,cursor:"pointer",letterSpacing:2,opacity:loading?0.7:1}}>
          {loading?"VERIFICANDO...":"INGRESAR"}
        </button>
      </div>
    </div>
  </div>;

  // ── ADMIN ──
  if(view==="admin") return <div style={{minHeight:"100vh",background:DK,fontFamily:"Arial,sans-serif",color:"#1a1a1a"}}>
    {Hdr}{modal&&<ClientModal/>}
    <div style={{background:CD,display:"flex",borderBottom:"1px solid "+BD,padding:mob?"0 8px":"0 24px",overflowX:"auto"}}>
      {[["products","PRODUCTOS"],["clients","CLIENTES"],["settings","CONFIG"]].map(([k,l])=>(
        <button key={k} onClick={()=>setTab(k)} style={{padding:mob?"10px 12px":"11px 18px",background:"none",border:"none",color:tab===k?OR:GRL,borderBottom:tab===k?"2px solid "+OR:"2px solid transparent",cursor:"pointer",fontSize:mob?11:12,fontWeight:700,letterSpacing:1,marginBottom:-1,whiteSpace:"nowrap"}}>{l}</button>
      ))}
    </div>
    <div style={{padding:mob?12:24,maxWidth:1400,margin:"0 auto"}}>

      {tab==="products"&&<div>
        <div style={{background:CD,border:"1px solid "+BD,borderRadius:6,padding:14,marginBottom:14,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
          <div style={{flex:1,minWidth:180}}>
            <div style={{fontWeight:700,fontSize:12,letterSpacing:1,marginBottom:3}}>ACTUALIZAR CATÁLOGO</div>
            <div style={{color:GRL,fontSize:11}}>Sube CSV → se guarda en Firebase y todos los usuarios ven los cambios al instante</div>
            <div style={{color:"#bbb",fontSize:10,marginTop:2}}>Columnas: CODIGO, DESCRIPCION, GDL1, GDL3, AGS, COL, LEN, CUL, PUBLICO, DISTRIBUIDOR, ASOCIADO</div>
          </div>
          <input type="file" accept=".csv,.tsv,.txt" ref={fref} onChange={handleFile} style={{display:"none"}}/>
          <Btn onClick={()=>{setMsg("");fref.current.click();}}>SUBIR CSV</Btn>
          {msg&&<span style={{fontSize:11,color:msg.startsWith("✅")?"#16a34a":msg.startsWith("⚠")?"#d97706":"#dc2626",maxWidth:320}}>{msg}</span>}
        </div>
        <Buscador search={search} ds={ds} onChange={setSearch} count={filtered.length} mob={mob}/>
        <div style={{overflowX:"auto",border:"1px solid "+BD,borderRadius:6,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
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
        </div>
        <Pager total={filtered.length} pg={page} setPg={setPage} ps={PS}/>
      </div>}

      {tab==="clients"&&<div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <span style={{color:GRL,fontSize:11}}>{users.length} clientes registrados</span>
          <Btn onClick={()=>setModal({mode:"create",data:{}})}>+ NUEVO CLIENTE</Btn>
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
              <Btn sm danger onClick={()=>window.confirm("¿Eliminar?")&&deleteClient(u.id)}>ELIMINAR</Btn>
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
                  <Btn sm danger onClick={()=>window.confirm("¿Eliminar "+u.nombre+"?")&&deleteClient(u.id)}>ELIMINAR</Btn>
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </div>}

      {tab==="settings"&&<div style={{background:CD,border:"1px solid "+BD,borderRadius:6,padding:24,maxWidth:440,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
        <div style={{fontWeight:700,fontSize:13,color:OR,marginBottom:12}}>INFORMACIÓN DEL SISTEMA</div>
        <div style={{color:GRL,fontSize:12,lineHeight:2}}>
          <div>🔥 Base de datos: <strong style={{color:"#1a1a1a"}}>Firebase Firestore</strong></div>
          <div>🌐 Proyecto: <strong style={{color:"#1a1a1a"}}>portal-tapatia</strong></div>
          <div>👤 Sesión: <strong style={{color:"#1a1a1a"}}>{session?.nombre}</strong></div>
          <div>📦 Productos: <strong style={{color:"#1a1a1a"}}>{products.length}</strong></div>
          <div>👥 Clientes: <strong style={{color:"#1a1a1a"}}>{users.filter(u=>u.estatus==="activo").length} activos</strong></div>
        </div>
      </div>}
    </div>
  </div>;

  // ── CLIENTE / VENDEDOR ──
  const lista=session?.lista, isVend=lista==="VENDEDOR";
  return <div style={{minHeight:"100vh",background:DK,fontFamily:"Arial,sans-serif",color:"#1a1a1a"}}>
    {Hdr}
    <div style={{background:`linear-gradient(90deg,${OR},#e05500)`,padding:"8px "+(mob?"12px":"24px"),display:"flex",alignItems:"center",gap:8}}>
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
              {isVend?<><th style={{padding:"9px 8px",textAlign:"right",color:"#16a34a",fontWeight:700}}>PÚBLICO</th><th style={{padding:"9px 8px",textAlign:"right",color:"#2563eb",fontWeight:700}}>DISTRIBUIDOR</th><th style={{padding:"9px 8px",textAlign:"right",color:"#ea580c",fontWeight:700}}>ASOCIADO</th></>
              :<th style={{padding:"9px 10px",textAlign:"right",color:OR,fontWeight:700}}>PRECIO</th>}
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
                {isVend?<><td style={{padding:"7px 8px",textAlign:"right",color:"#16a34a",fontWeight:600}}>{money(p.publico)}</td><td style={{padding:"7px 8px",textAlign:"right",color:"#2563eb",fontWeight:600}}>{money(p.distribuidor)}</td><td style={{padding:"7px 8px",textAlign:"right",color:"#ea580c",fontWeight:600}}>{money(p.asociado)}</td></>
                :<td style={{padding:"7px 10px",textAlign:"right",fontWeight:700,color:OR,whiteSpace:"nowrap"}}>{money(getPrecio(p,lista))}</td>}
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
    </div>
  </div>;
}