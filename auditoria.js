"use strict";
/* ===== Expedientes de auditoría (área de jefes) =====
   Por cliente: historial de auditorías con los archivos que se usaron
   (entrada) y lo que salió (informe), conclusiones, hallazgos, memoria del
   cliente y notas. Las auditorías las carga el skill de Claude Code con las
   acciones aud_* de qb-api; acá se consultan y se ajustan. */
const AUD_TIPOS_IN = ["Transaction Detail","Profit and Loss","Balance Sheet","Extracto bancario","Tarjeta","Cash Analysis","Reporte de nómina","Otro"];
const AUD_TIPOS_OUT = ["Reporte resumido","Reporte detallado","Reporte financiero","Mail al cliente","Informe","Papel de trabajo","Otro"];
const SEMAFORO = { verde:["#2ee6a6","Sin observaciones relevantes"], amarillo:["#ffb23e","Con observaciones"], rojo:["#ff6b6b","Problemas importantes"] };
const RUN_TIPOS = ["Integral","Mensual","Cierre anual"];
const RUN_ESTADOS = ["En curso","Enviada a Dennis","Hecho","Cerrada"];
const HALL_ESTADOS = ["Abierto","Repetido","Resuelto","Descartado"];
const HALL_ABIERTO = (h)=>h.estado==="Abierto"||h.estado==="Repetido";
const DESTINOS = ["AJUSTE","CLIENTE","CIERRE ANUAL","DEFINIR","DEFINIDO","CONTROL"];
const CTRL_ESTADOS = ["OK","DIFERENCIA","SIN DATO","N/A","Pendiente"];
const MODULOS = { A:"A · Insumos y calidad de datos", B:"B · Conciliaciones", C:"C · P&L", D:"D · Diario y memos", E:"E · Activos", F:"F · Clasificación", G:"G · Red flags y gobierno" };
const A = { pin:"", view:"lista", cid:null, tab:"revision", runs:[], abiertos:[], exp:null, cfil:"todos", rrun:null, rfil:"pend", rvis:"corregir", rab:new Set(), rmodo:false, lv:"empresas", avance:[], hq:"",
  ff:{ empresas:{}, pend:{ estado:"Pendiente" } }, tb:{ empresas:{ sort:null, fil:{} }, pend:{ sort:null, fil:{} } } };
// Revisión: los pasos de Dennis (mismos textos que la plantilla «Revisión … – HECHA» del skill).
const PASOS_DENNIS = { "0":"Repetidos y cambios de reglas de la Nota anterior: hechos", "1":"Misc ≈ $0",
  "2":"Total Expense > $350: memos leídos, cuenta correcta", "3":"Payroll: S&W del P&L = bruto YTD Datatech/AME",
  "4":"Repairs: nada ≥ $2,500; autos vs equipo", "5":"COGS: Total by Vendor tiene sentido", "6":"Ninguna transacción sin nombre",
  "7":"Activos fijos: compras del año en su subcuenta, nada como Repairs, ningún activo faltante", "8":"Payroll Liabilities en $0",
  "9":"Préstamos: cada pago en el préstamo correcto; préstamo nuevo → consultado", "10":"Mail al cliente enviado por Breana (retiros en efectivo / facturas)",
  "T":"Tarjetas y bancos: fecha de la última conciliación de cada uno" };
const CAPTURA = { "1":"captura", "3":"captura (los dos números)", "6":"captura (filtro Name vacío = sin resultados)",
  "7":"captura (activos del año + Repairs ≥ $2,500)", "8":"captura del Balance" };
const PASO_ORDEN = [...Object.keys(PASOS_DENNIS), "otros"];
const CORR_HECHAS = ["Corregido","Hecho distinto","No corresponde","Ya no aparece"];
const CORR_ICONO = { "Pendiente":"☐", "Corregido":"✔", "Hecho distinto":"✎", "No corresponde":"✕", "Ya no aparece":"—" };
const MARCA = { DEFINIR:["Consultar con Dennis","def"], CLIENTE:["Pedir al cliente · va en el mail","cli"], "CIERRE ANUAL":["Al cierre","cie"], DEFINIDO:["Consultado con Dennis","ok"] };

async function aapi(action, extra={}){
  const res = await fetch(`${CFG.URL}/functions/v1/${CFG.FN}`,{
    method:"POST", headers:{ apikey:CFG.ANON, Authorization:"Bearer "+CFG.ANON, "Content-Type":"application/json" },
    body: JSON.stringify({ pin:A.pin, action, ...extra }),
  });
  const data = await res.json().catch(()=>({error:"respuesta inválida"}));
  if(!res.ok) throw new Error(data.error || ("HTTP "+res.status));
  return data;
}

/* ---- abrir (pide el PIN de expedientes, propio del módulo) ---- */
async function abrirExpedientes(cid){
  const saved = sessionStorage.getItem("qb_pin_aud");
  if(saved){ A.pin=saved; try{ await aapi("aud_login"); return entrarExp(cid); }catch(e){ sessionStorage.removeItem("qb_pin_aud"); } }
  openModal("🔒 Expedientes de auditoría", `
    <p class="muted">Ingresá el PIN de expedientes para ver las auditorías.</p>
    <label>PIN de expedientes</label><input id="xa-pin" type="password" autocomplete="off">
    <div id="xa-err" class="gate-err"></div>
    <div class="modal-actions"><button class="btn ghost" id="xa-cancel">Cancelar</button><button class="btn primary" id="xa-ok">Entrar</button></div>`);
  const go=async ()=>{
    A.pin=$("#xa-pin").value.trim();
    try{ await aapi("aud_login"); sessionStorage.setItem("qb_pin_aud",A.pin); closeModal(); entrarExp(cid); }
    catch(ex){ $("#xa-err").textContent=ex.message; A.pin=""; }
  };
  $("#xa-cancel").addEventListener("click",closeModal);
  $("#xa-ok").addEventListener("click",go);
  $("#xa-pin").addEventListener("keydown",e=>{ if(e.key==="Enter"){e.preventDefault();go();} });
  setTimeout(()=>$("#xa-pin").focus(),50);
}
async function entrarExp(cid){
  const ov=$("#aud"); ov.classList.remove("hidden");
  ov.innerHTML=`<div class="rr-load">Cargando…</div>`;
  try{
    await cargarResumen();
    if(cid) await verCliente(cid); else { A.view="lista"; renderExp(); }
  }catch(ex){ ov.innerHTML=`<div class="rr-load">Error: ${esc(ex.message)} <button class="btn" id="xa-err-close">Cerrar</button></div>`;
    $("#xa-err-close").addEventListener("click",cerrarExp); }
}
function cerrarExp(){ $("#aud").classList.add("hidden"); }
async function cargarResumen(){ const d=await aapi("aud_resumen"); A.runs=d.runs; A.abiertos=d.abiertos; A.avance=d.avance||[]; }
async function verCliente(cid, runId){
  A.cid=cid; A.view="cliente";
  A.exp=await aapi("aud_cliente",{ cliente_id:cid });
  A.rrun=(runsConRevision()[0]||A.exp.runs[0])?.id ?? null; A.tab=runsConRevision().length?"revision":"auditorias"; A.rfil="pend"; A.rvis="corregir"; A.rab=new Set(); A.hq="";
  if(runId && A.exp.runs.some(r=>r.id===runId)){ A.rrun=runId; A.tab="revision"; }
  renderExp();
}
async function recargarCliente(){ const y=$("#ax-body")?.scrollTop||0; A.exp=await aapi("aud_cliente",{ cliente_id:A.cid }); await cargarResumen(); renderExp(); const b=$("#ax-body"); if(b) b.scrollTop=y; }

/* ---- helpers ---- */
const cliDe = (cid)=>S.clientes.find(c=>c.id===cid)||{ id:cid, nombre:"Cliente "+cid };
const semDot = (s)=> s&&SEMAFORO[s] ? `<span class="ax-sem" style="background:${SEMAFORO[s][0]}" title="${SEMAFORO[s][1]}"></span>` : `<span class="ax-sem off" title="Sin semáforo"></span>`;
const periodoTxt = (r)=> r.periodo_desde||r.periodo_hasta ? `${fechaCorta(r.periodo_desde)} – ${fechaCorta(r.periodo_hasta)}` : "Período sin cargar";
function pesoTxt(b){ if(!b) return ""; return b<1024?b+" B": b<1048576?(b/1024).toFixed(0)+" KB":(b/1048576).toFixed(1)+" MB"; }
function metricaVal(v){ return typeof v==="number" ? v.toLocaleString("en-US",Number.isInteger(v)?{}:{minimumFractionDigits:2,maximumFractionDigits:2}) : esc(typeof v==="object"?JSON.stringify(v):String(v)); }
function proxAuditoria(c){
  if(!auditTracked(c)) return null;
  let m=mesActual(); for(let i=0;i<24;i++){ if(scheduledIn(c,m) && !hechaEn(c.id,m)) return m; m=mesAdd(m,1); }
  return null;
}

/* ---- shell ---- */
function renderExp(){
  const ov=$("#aud");
  const titulo = A.view==="cliente" ? `<button class="btn ghost sm" id="ax-back">◀ Todos los clientes</button>` : "";
  ov.innerHTML=`
    <div class="rr-top">
      <div class="rr-brand">📁 Expedientes de auditoría <em>Chermisqui · confidencial</em></div>
      <div class="rr-actions">${titulo}<button class="btn ghost" id="ax-close">✕ Volver</button></div>
    </div>
    <div class="rr-body" id="ax-body"></div>`;
  $("#ax-close").addEventListener("click",cerrarExp);
  $("#ax-back")?.addEventListener("click",()=>{ A.view="lista"; renderExp(); });
  const body=$("#ax-body");
  if(A.view==="lista") renderLista(body); else renderCliente(body);
}

/* ================= LISTA DE CLIENTES =================
   Dos vistas con la misma tabla: tocar un encabezado ordena y filtra por esa
   columna (como en Excel), y arriba están los filtros generales. */
const avanceDe = r => A.avance.find(a=>a.run_id===r.id);
const conRevision = () => A.runs.filter(r=>(avanceDe(r)?.puntos||0)>0);
const pendiente = r => (avanceDe(r)?.puntos_abiertos||0)>0;
function vistaSeg(){
  const n=conRevision().filter(pendiente).length;
  return `<div class="ax-seg ax-vistas">${[["empresas","📁 Empresas"],["pend",`⏳ Pendientes de corregir <span class="cnt">${n}</span>`]]
    .map(v=>`<button class="tab ${A.lv===v[0]?"active":""}" data-lv="${v[0]}">${v[1]}</button>`).join("")}</div>`;
}
const priOf = c => PRIOS.includes(c?.prioridad)?c.prioridad:"Media";
const bucketPuntos = n => n===0?"0":n<=5?"1 a 5":n<=10?"6 a 10":"Más de 10";

function filasVista(v){
  if(v==="pend"){
    const cli=Object.fromEntries(S.clientes.map(c=>[c.id,c]));
    return conRevision().map(r=>{ const a=avanceDe(r), c=cli[r.cliente_id]||{ nombre:"#"+r.cliente_id }, ok=a.filas-a.filas_pendientes;
      return { r, a, c, ok, pct:a.filas?Math.round(ok*100/a.filas):100, pend:pendiente(r) }; });
  }
  const ultima={}, cant={}, ab={};
  A.runs.forEach(r=>{ cant[r.cliente_id]=(cant[r.cliente_id]||0)+1; if(!ultima[r.cliente_id]) ultima[r.cliente_id]=r; });
  A.abiertos.forEach(h=>{ ab[h.cliente_id]=(ab[h.cliente_id]||0)+1; });
  return S.clientes.filter(c=>c.activo!==false).map(c=>({ c, u:ultima[c.id]||null, cant:cant[c.id]||0, ab:ab[c.id]||0, prox:proxAuditoria(c), p:priOf(c) }));
}
/* val: con qué se ordena · txt: qué se ve en el filtro de la columna · html: la celda */
const COLS = {
  empresas:[
    { k:"empresa", t:"Empresa", val:f=>f.c.nombre, txt:f=>f.c.nombre, html:f=>`<b>${esc(f.c.nombre)}</b>` },
    { k:"bk", t:"Bookkeeper", val:f=>f.c.bookkeeper_default||"", txt:f=>f.c.bookkeeper_default||"—", html:f=>esc(f.c.bookkeeper_default||"—") },
    { k:"prio", t:"Prioridad", val:f=>PRIO_RANK[f.p], txt:f=>f.p, html:f=>`<span class="prio-badge prio-${prioSlug(f.p)}">${esc(f.p)}</span>` },
    { k:"freq", t:"Frecuencia", val:f=>f.c.audit_freq||"", txt:f=>f.c.audit_freq||"—", html:f=>esc(f.c.audit_freq||"—") },
    { k:"ultima", t:"Última auditoría", val:f=>f.u?.fecha||"", txt:f=>f.u?mesLabel(String(f.u.fecha).slice(0,7)):"Sin auditorías",
      html:f=>f.u?`${semDot(f.u.semaforo)} ${fechaCorta(f.u.fecha)} <span class="muted">· ${esc(f.u.estado)}</span>`:'<span class="muted">Sin auditorías</span>' },
    { k:"cant", t:"Auditorías", num:1, val:f=>f.cant, txt:f=>String(f.cant), html:f=>f.cant||'<span class="muted">0</span>' },
    { k:"ab", t:"Puntos abiertos", num:1, val:f=>f.ab, txt:f=>bucketPuntos(f.ab), html:f=>f.ab?`<b style="color:var(--amber)">${f.ab}</b>`:'<span class="muted">—</span>' },
    { k:"prox", t:"Próxima", val:f=>f.prox||"", txt:f=>f.prox?mesLabel(f.prox):"—", html:f=>f.prox?mesLabel(f.prox):'<span class="muted">—</span>' },
  ],
  pend:[
    { k:"empresa", t:"Empresa", val:f=>f.c.nombre, txt:f=>f.c.nombre, html:f=>`<b>${esc(f.c.nombre)}</b>` },
    { k:"bk", t:"Bookkeeper", val:f=>f.c.bookkeeper_default||"", txt:f=>f.c.bookkeeper_default||"—", html:f=>esc(f.c.bookkeeper_default||"—") },
    { k:"aud", t:"Auditoría", val:f=>f.r.fecha, txt:f=>periodoTxt(f.r), html:f=>`${fechaCorta(f.r.fecha)} <span class="muted">· ${esc(periodoTxt(f.r))}</span>` },
    { k:"filas", t:"Filas corregidas", num:1, val:f=>f.pct, txt:f=>f.ok===0?"Sin empezar":f.ok===f.a.filas?"Todas":"En curso",
      html:f=>`<div class="rv-prog"><div class="rv-bar ax-mini"><i style="width:${f.pct}%"></i></div><span><b>${f.ok}</b> de ${f.a.filas}</span></div>` },
    { k:"ptos", t:"Puntos abiertos", num:1, val:f=>f.a.puntos_abiertos, txt:f=>bucketPuntos(f.a.puntos_abiertos),
      html:f=>f.a.puntos_abiertos?`<b style="color:var(--amber)">${f.a.puntos_abiertos}</b> <span class="muted">de ${f.a.puntos}</span>`:`<span class="muted">0 de ${f.a.puntos}</span>` },
    { k:"tilde", t:"Último tilde", val:f=>f.a.ultimo_tilde||"", txt:f=>f.a.ultimo_tilde?fechaCorta(String(f.a.ultimo_tilde).slice(0,10)):"Sin empezar",
      html:f=>f.a.ultimo_tilde?fechaCorta(String(f.a.ultimo_tilde).slice(0,10)):'<span class="muted">Sin empezar</span>' },
    { k:"estado", t:"Estado", val:f=>f.pend?0:1, txt:f=>f.pend?"Pendiente":"OK", html:f=>f.pend?'<span class="rv-est">Pendiente</span>':'<span class="rv-est ok">✔ OK</span>' },
  ],
};
/* Filtros de arriba */
const TOPF = {
  empresas:[
    { k:"bk", t:"Bookkeeper", val:f=>f.c.bookkeeper_default||"—" },
    { k:"prio", t:"Prioridad", val:f=>f.p },
    { k:"freq", t:"Frecuencia", val:f=>f.c.audit_freq||"—" },
    { k:"exp", t:"Expediente", val:f=>f.cant?"Con auditoría":"Sin auditoría" },
    { k:"ab", t:"Puntos", val:f=>f.ab?"Con puntos abiertos":"Sin puntos abiertos" },
  ],
  pend:[
    { k:"bk", t:"Bookkeeper", val:f=>f.c.bookkeeper_default||"—" },
    { k:"estado", t:"Estado", val:f=>f.pend?"Pendiente":"OK" },
    { k:"avance", t:"Avance", val:f=>f.ok===0?"Sin empezar":f.ok===f.a.filas?"Todas corregidas":"En curso" },
    { k:"prio", t:"Prioridad", val:f=>priOf(f.c) },
    { k:"periodo", t:"Período", val:f=>periodoTxt(f.r) },
  ],
};
function comparar(a,b){
  const va=a==null||a==="", vb=b==null||b===""; if(va||vb) return va&&vb?0:va?1:-1; // lo vacío siempre al final
  return typeof a==="number"&&typeof b==="number" ? a-b : String(a).localeCompare(String(b),"es",{numeric:true,sensitivity:"base"});
}
function ordenBase(v,a,b){
  return v==="pend" ? (b.pend-a.pend)||(b.a.filas_pendientes-a.a.filas_pendientes)||(b.a.puntos_abiertos-a.a.puntos_abiertos)
    : (b.cant?1:0)-(a.cant?1:0)||PRIO_RANK[a.p]-PRIO_RANK[b.p]||a.c.nombre.localeCompare(b.c.nombre);
}
function aplicarFiltros(v, filas, sinCol){
  const T=A.tb[v], Q=A.ff[v], q=(Q.q||"").trim().toLowerCase();
  return filas.filter(f=>{
    if(q && !(`${f.c.nombre} ${f.c.bookkeeper_default||""}`).toLowerCase().includes(q)) return false;
    if(!TOPF[v].every(t=>!Q[t.k]||t.val(f)===Q[t.k])) return false;
    return COLS[v].every(c=>c.k===sinCol||!T.fil[c.k]||T.fil[c.k].includes(c.txt(f)));
  });
}
function pintarTabla(body,v){
  const T=A.tb[v], todas=filasVista(v), lista=aplicarFiltros(v,todas);
  if(T.sort){ const c=COLS[v].find(x=>x.k===T.sort.k); lista.sort((a,b)=>{ const va=c.val(a), vb=c.val(b);
    if(va==null||va===""||vb==null||vb==="") return comparar(va,vb); return T.sort.dir*comparar(va,vb); }); }
  else lista.sort((a,b)=>ordenBase(v,a,b));
  $("#ax-kp",body).innerHTML = v==="pend" ? (()=>{ const p=lista.filter(f=>f.pend), s=k=>p.reduce((t,f)=>t+(f.a[k]||0),0);
      return `<div class="ax-kpi"><b style="color:var(--amber)">${p.length}</b><span>auditorías con algo por corregir</span></div>
        <div class="ax-kpi"><b>${s("filas_pendientes")}</b><span>filas sin tildar</span></div>
        <div class="ax-kpi"><b>${s("puntos_abiertos")}</b><span>puntos abiertos</span></div>
        <div class="ax-kpi"><b style="color:var(--menta)">${lista.length-p.length}</b><span>auditorías OK</span></div>`; })()
    : (()=>{ const anio=String(new Date().getFullYear()), ids=new Set(lista.map(f=>f.c.id));
      return `<div class="ax-kpi"><b>${lista.filter(f=>f.cant).length}</b><span>clientes con expediente</span></div>
        <div class="ax-kpi"><b>${A.runs.filter(r=>ids.has(r.cliente_id)&&String(r.fecha).startsWith(anio)).length}</b><span>auditorías en ${anio}</span></div>
        <div class="ax-kpi"><b style="color:var(--amber)">${lista.reduce((t,f)=>t+f.ab,0)}</b><span>puntos abiertos</span></div>`; })();
  $("#ax-cuenta",body).textContent=`${lista.length} de ${todas.length}`;
  const hay=!!(A.ff[v].q||TOPF[v].some(t=>A.ff[v][t.k])||Object.keys(T.fil).length||T.sort);
  $("#ax-limpiar",body).classList.toggle("hidden",!hay);
  $$("th[data-col]",body).forEach(th=>{ const k=th.dataset.col, ord=T.sort?.k===k?(T.sort.dir>0?"↑":"↓"):"", fil=!!T.fil[k];
    th.classList.toggle("on",!!ord||fil); $(".ax-th-i",th).textContent=(fil?"● ":"")+(ord||"▾"); });
  $("#ax-tb",body).innerHTML = lista.length ? lista.map(f=>`<tr class="ax-row" data-cid="${f.c.id}"${f.r?` data-run="${f.r.id}" title="Abrir la Revisión"`:""}>${COLS[v].map(c=>`<td class="${c.num?"tc":""}" data-label="${esc(c.t)}">${c.html(f)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${COLS[v].length}"><div class="empty">Nada con estos filtros.</div></td></tr>`;
}
function cerrarPop(){ $("#ax-pop")?.remove(); document.removeEventListener("mousedown",fueraPop); document.removeEventListener("keydown",escPop); }
function fueraPop(e){ if(!e.target.closest("#ax-pop")) cerrarPop(); }
function escPop(e){ if(e.key==="Escape") cerrarPop(); }
function abrirPop(th,v,body){
  const yaAbierto=$("#ax-pop")?.dataset.col===th.dataset.col; cerrarPop(); if(yaAbierto) return;
  const c=COLS[v].find(x=>x.k===th.dataset.col), T=A.tb[v];
  const vals=[...new Set(aplicarFiltros(v,filasVista(v),c.k).map(c.txt))].sort((a,b)=>comparar(a,b));
  const elegidos=T.fil[c.k]||vals, flechas=c.num?["De menor a mayor","De mayor a menor"]:["De la A a la Z / más antiguo","De la Z a la A / más nuevo"];
  const pop=document.createElement("div"); pop.id="ax-pop"; pop.className="ax-pop"; pop.dataset.col=c.k;
  pop.innerHTML=`<button class="ax-pop-o ${T.sort?.k===c.k&&T.sort.dir>0?"on":""}" data-o="1">↑ ${flechas[0]}</button>
    <button class="ax-pop-o ${T.sort?.k===c.k&&T.sort.dir<0?"on":""}" data-o="-1">↓ ${flechas[1]}</button>
    ${vals.length>8?`<input type="search" id="ax-pop-q" placeholder="Buscar en ${esc(c.t.toLowerCase())}…">`:""}
    <label class="ax-pop-v ax-pop-all"><input type="checkbox" id="ax-pop-all"> Todos</label>
    <div class="ax-pop-list">${vals.map((x,i)=>`<label class="ax-pop-v" data-t="${esc(x.toLowerCase())}"><input type="checkbox" data-i="${i}" ${elegidos.includes(x)?"checked":""}> ${esc(x)}</label>`).join("")}</div>`;
  $("#aud").append(pop);
  const r=th.getBoundingClientRect(), w=pop.offsetWidth, h=pop.offsetHeight;
  pop.style.left=Math.max(8,Math.min(r.left,innerWidth-w-8))+"px"; pop.style.top=Math.max(8,Math.min(r.bottom+4,innerHeight-h-8))+"px";
  const all=$("#ax-pop-all",pop), chks=$$("[data-i]",pop);
  const sync=()=>{ const n=chks.filter(x=>x.checked).length; all.checked=n===chks.length; all.indeterminate=n>0&&n<chks.length; };
  const aplicar=()=>{ const sel=chks.filter(x=>x.checked).map(x=>vals[+x.dataset.i]);
    if(sel.length===vals.length) delete T.fil[c.k]; else T.fil[c.k]=sel; sync(); pintarTabla(body,v); };
  sync();
  chks.forEach(x=>x.addEventListener("change",aplicar));
  all.addEventListener("change",()=>{ chks.forEach(x=>{ x.checked=all.checked; }); aplicar(); });
  $$("[data-o]",pop).forEach(b=>b.addEventListener("click",()=>{ const d=+b.dataset.o;
    T.sort=T.sort?.k===c.k&&T.sort.dir===d?null:{ k:c.k, dir:d }; pintarTabla(body,v); cerrarPop(); }));
  $("#ax-pop-q",pop)?.addEventListener("input",e=>{ const q=e.target.value.toLowerCase(); $$(".ax-pop-list .ax-pop-v",pop).forEach(l=>{ l.style.display=l.dataset.t.includes(q)?"":"none"; }); });
  setTimeout(()=>{ document.addEventListener("mousedown",fueraPop); document.addEventListener("keydown",escPop); $("#ax-pop-q",pop)?.focus(); },0);
}
function renderLista(body){
  cerrarPop();
  const v=A.lv==="pend"?"pend":"empresas", Q=A.ff[v], base=filasVista(v);
  const opts=t=>[...new Set(base.map(t.val))].sort((a,b)=>comparar(a,b));
  body.innerHTML=`${vistaSeg()}
    <div class="ax-kpis ${v==="pend"?"ax-k5":""}" id="ax-kp"></div>
    <div class="ax-filtros">
      <input id="ax-q" type="search" placeholder="Buscar empresa o bookkeeper…" value="${esc(Q.q||"")}">
      ${TOPF[v].map(t=>`<label class="ax-fil"><span>${esc(t.t)}</span><select data-tf="${t.k}"><option value="">Todos</option>${opts(t).map(o=>`<option value="${esc(o)}" ${Q[t.k]===o?"selected":""}>${esc(o)}</option>`).join("")}</select></label>`).join("")}
      <button class="btn ghost sm hidden" id="ax-limpiar">✕ Limpiar filtros</button>
      <span class="muted ax-cuenta" id="ax-cuenta"></span>
    </div>
    <div class="ax-scroll"><table class="audit-table ax-lista ${v==="pend"?"ax-pend":""}"><thead><tr>
      ${COLS[v].map(c=>`<th class="ax-th" data-col="${c.k}" title="Ordenar y filtrar"><span>${esc(c.t)}</span> <span class="ax-th-i">▾</span></th>`).join("")}
    </tr></thead><tbody id="ax-tb"></tbody></table></div>
    <div class="rr-note">Tocá el título de una columna para ordenarla o filtrarla.${v==="pend"?" Una auditoría queda <b>OK</b> cuando todos los puntos de su Revisión están resueltos.":""}</div>`;
  pintarTabla(body,v);
  $$("[data-lv]",body).forEach(b=>b.addEventListener("click",()=>{ A.lv=b.dataset.lv; renderExp(); }));
  $("#ax-q",body).addEventListener("input",e=>{ Q.q=e.target.value; pintarTabla(body,v); });
  $$("[data-tf]",body).forEach(s=>s.addEventListener("change",()=>{ if(s.value) Q[s.dataset.tf]=s.value; else delete Q[s.dataset.tf]; pintarTabla(body,v); }));
  $("#ax-limpiar",body).addEventListener("click",()=>{ A.ff[v]={}; A.tb[v]={ sort:null, fil:{} }; renderLista(body); });
  $$("th[data-col]",body).forEach(th=>th.addEventListener("click",e=>{ e.stopPropagation(); abrirPop(th,v,body); }));
  $("#ax-tb",body).addEventListener("click",e=>{ const tr=e.target.closest(".ax-row"); if(!tr) return;
    verCliente(+tr.dataset.cid, tr.dataset.run?+tr.dataset.run:undefined).catch(ex=>toast(ex.message,true)); });
}

/* ================= EXPEDIENTE DE UN CLIENTE ================= */
const runSel = ()=>(A.exp?.runs||[]).find(r=>r.id===A.rrun)||null;
const puntosDe = (rid)=>A.exp.hallazgos.filter(h=>h.run_id===rid&&h.ref).sort((a,b)=>(a.orden??999)-(b.orden??999)||a.id-b.id);
function renderCliente(body){
  const c=cliDe(A.cid), E=A.exp, p=priOf(c), prox=proxAuditoria(c);
  if(!E.runs.some(r=>r.id===A.rrun)) A.rrun=E.runs[0]?.id ?? null;
  const run=runSel(), hs=run?puntosDe(run.id):[];
  const pend=filasRev(hs).filter(f=>f.estado==="Pendiente").length;
  const propuestas=E.memoria.filter(m=>m.estado==="Propuesta").length;
  const falta=run?faltanMail(run).length:0;
  const consultas=run?puntosDennis(run).length:0;
  const tabs=[["revision",`Revisión ${pend?`<span class="cnt" title="Filas pendientes de corregir">${pend}</span>`:""}`],
    ["mail",`✉️ Mail al cliente ${falta?`<span class="cnt ax-cnt-warn" title="Puntos a los que les falta foto o texto">${falta}</span>`:""}`],
    ["dennis",`✉️ Mail a Dennis ${consultas?`<span class="cnt" title="Puntos para consultar con Dennis">${consultas}</span>`:""}`],
    ["auditorias","Auditoría y documentación"],
    ["historial","Historial"],
    ["memoria",`Memoria ${propuestas?`<span class="cnt ax-cnt-prop" title="Propuestas para revisar">${propuestas}</span>`:""}`]];
  if(E.notas.length) tabs.push(["notas",`Notas <span class="cnt">${E.notas.length}</span>`]);
  if(!tabs.some(t=>t[0]===A.tab)) A.tab="revision";
  body.innerHTML=`
    <div class="ax-head ax-head-s">
      <div class="ax-head-l">
        <div class="ax-cli">${esc(c.nombre)}</div>
        <div class="rr-meta"><span class="prio-badge prio-${prioSlug(p)}">${esc(p)}</span>
          <span class="rr-badge">${esc(c.bookkeeper_default||"Sin bookkeeper")}</span>
          ${prox?`<span class="rr-badge">Próxima: ${mesLabel(prox)}</span>`:""}</div>
      </div>
      ${E.runs.length?`<label class="ax-inl ax-runsel">Auditoría ${E.runs.length>1?`<select id="ax-run">${E.runs.map(r=>`<option value="${r.id}" ${r.id===A.rrun?"selected":""}>${fechaCorta(r.fecha)} · ${esc(periodoRev(r))}</option>`).join("")}</select>`
        :`<b>${fechaCorta(run.fecha)} · ${esc(periodoRev(run))}</b>`}</label>`:""}
    </div>
    <div class="ax-tabs">${tabs.map(t=>`<button class="rr-tab ${A.tab===t[0]?"active":""}" data-t="${t[0]}">${t[1]}</button>`).join("")}</div>
    <div id="ax-tab"></div>`;
  $$(".ax-tabs .rr-tab",body).forEach(b=>b.addEventListener("click",()=>{ A.tab=b.dataset.t; renderExp(); }));
  $("#ax-run",body)?.addEventListener("change",e=>{ A.rrun=+e.target.value; renderExp(); });
  const t=$("#ax-tab",body);
  if(A.tab==="revision") tabRevision(t);
  else if(A.tab==="mail") tabMail(t);
  else if(A.tab==="dennis") tabDennis(t);
  else if(A.tab==="auditorias") tabAuditorias(t);
  else if(A.tab==="historial") tabHistorial(t);
  else if(A.tab==="memoria") tabMemoria(t);
  else tabNotas(t);
}

/* ---- Fotos: pegar (Ctrl+V), arrastrar o elegir archivo ---- */
const fotosDe = (pred)=>(A.exp.fotos||[]).filter(pred);
const fotoThumb = (f,quitable=true)=>`<span class="ax-foto">${f.url?`<img src="${esc(f.url)}" alt="${esc(f.nombre)}" data-ver="${f.id}">`:`<span class="ax-foto-off" title="${esc(f.nombre)}">🖼</span>`}${quitable?`<button class="ax-foto-x" data-fdel="${f.id}" title="Quitar la foto">✕</button>`:""}</span>`;
const zonaFoto = (d)=>`<div class="ax-zona" tabindex="0" data-zh="${d.hallazgo_id||""}" data-zc="${d.correccion_id||""}" data-zt="${d.tipo}">
    <span>📋 Hacé clic y pegá la captura (Ctrl+V)</span><label class="ax-zlink">o elegí un archivo<input type="file" accept="image/*" multiple hidden></label></div>`;
async function subirFoto(file,d){
  if(!file||!String(file.type).startsWith("image/")) return toast("Tiene que ser una imagen",true);
  if(file.size>15*1048576) return toast("La imagen pasa los 15 MB",true);
  const nombre=file.name&&file.name!=="image.png"?file.name:`captura-${Date.now()}.png`;
  const u=await aapi("aud_foto_url",{ run_id:A.rrun, nombre });
  const res=await fetch(u.url,{ method:"PUT", headers:{ "Content-Type":file.type, "x-upsert":"false" }, body:file });
  if(!res.ok) throw new Error("No se pudo subir la foto ("+res.status+")");
  await aapi("aud_foto_add",{ run_id:A.rrun, hallazgo_id:d.hallazgo_id||null, correccion_id:d.correccion_id||null, tipo:d.tipo, nombre, path:u.path, bytes:file.size, mime:file.type, quien:quien() });
}
function bindFotos(root, luego){
  const datos=z=>({ hallazgo_id:+z.dataset.zh||null, correccion_id:+z.dataset.zc||null, tipo:z.dataset.zt });
  const subir=async (files,z)=>{ const fs=[...files].filter(Boolean); if(!fs.length) return;
    toast("Subiendo foto…");
    try{ for(const f of fs) await subirFoto(f,datos(z)); await recargarCliente(); luego?.(); toast("Foto guardada ✓"); }
    catch(ex){ toast(ex.message,true); } };
  $$(".ax-zona",root).forEach(z=>{
    z.addEventListener("click",()=>z.focus());
    z.addEventListener("paste",e=>{ const fs=[...(e.clipboardData?.items||[])].filter(i=>i.type.startsWith("image/")).map(i=>i.getAsFile());
      if(!fs.length) return toast("No hay una imagen copiada. Sacá la captura y volvé a pegar.",true); e.preventDefault(); subir(fs,z); });
    z.addEventListener("dragover",e=>{ e.preventDefault(); z.classList.add("drag"); });
    z.addEventListener("dragleave",()=>z.classList.remove("drag"));
    z.addEventListener("drop",e=>{ e.preventDefault(); z.classList.remove("drag"); subir(e.dataTransfer.files,z); });
    $("input[type=file]",z).addEventListener("change",e=>subir(e.target.files,z));
  });
  $$("[data-ver]",root).forEach(i=>i.addEventListener("click",()=>verFoto(+i.dataset.ver)));
  $$("[data-fdel]",root).forEach(b=>b.addEventListener("click",async e=>{ e.stopPropagation();
    if(!confirm("¿Quitar esta foto?")) return;
    try{ await aapi("aud_foto_del",{ id:+b.dataset.fdel, quien:quien() }); await recargarCliente(); luego?.(); toast("Foto quitada"); }catch(ex){ toast(ex.message,true); } }));
}
function verFoto(id){
  const f=A.exp.fotos.find(x=>x.id===id); if(!f?.url) return;
  openModal(f.nombre,`<a href="${esc(f.url)}" target="_blank" rel="noopener"><img class="ax-foto-g" src="${esc(f.url)}" alt="${esc(f.nombre)}"></a>
    <p class="muted ax-small">${esc([f.subido_por,String(f.creado_at||"").slice(0,10)].filter(Boolean).join(" · "))}</p>`);
}
function fotoFila(id){
  const f=A.exp.correcciones.find(x=>x.id===id), h=A.exp.hallazgos.find(x=>x.id===f.hallazgo_id), fs=fotosDe(x=>x.correccion_id===id);
  openModal(`${h.ref} · foto de la corrección`,`<p class="muted">${esc([f.fecha,f.num,f.payee,money2(f.monto)].filter(Boolean).join(" · "))}</p>
    ${fs.length?`<div class="ax-fotos">${fs.map(x=>fotoThumb(x)).join("")}</div>`:""}
    ${zonaFoto({ correccion_id:id, tipo:"Correccion" })}
    <div class="modal-actions"><button class="btn primary" id="ff-ok">Listo</button></div>`);
  $("#ff-ok").addEventListener("click",closeModal);
  bindFotos($("#modal-body"),()=>fotoFila(id));
  setTimeout(()=>$("#modal-body .ax-zona")?.focus(),50);
}

/* ---- Mail al cliente: se ve como va a salir, con la foto de QuickBooks y la del extracto ---- */
const MES_EN=["January","February","March","April","May","June","July","August","September","October","November","December"];
/* Va al mail el punto con destino CLIENTE y cualquier otro que tenga pedido escrito (botón «Pedir al cliente» de la Revisión). */
const pideCliente = (h)=>h.codigo==="A01"?h.destino==="CLIENTE":h.destino==="CLIENTE"||!!String(h.mail_texto||"").trim();
/* Documento faltante (código A01): Matías elige por qué falta. Falta acceso = se pide al cliente; error nuestro = lo corrige el equipo. */
function faltaHtml(h){
  if(h.codigo!=="A01"||!HALL_ABIERTO(h)) return "";
  const cli=h.destino==="CLIENTE";
  return `<div class="rv-falta"><b>Falta este documento. ¿Por qué?</b>
    <button type="button" class="rv-dbtn cambiar ${cli?"on":""}" data-falta="${h.id}" data-fval="CLIENTE" aria-pressed="${cli}">El cliente no dio acceso</button>
    <button type="button" class="rv-dbtn sacar ${cli?"":"on"}" data-falta="${h.id}" data-fval="AJUSTE" aria-pressed="${!cli}">Error nuestro</button>
    <span class="muted">${cli?"Va en el mail al cliente.":"Lo resuelve el equipo; no va al mail."}</span></div>`;
}
async function elegirFalta(hid,destino){
  const h=A.exp.hallazgos.find(x=>x.id===hid);
  if(h.destino===destino) return;
  const patch={ destino };
  if(destino==="CLIENTE"&&!String(h.mail_texto||"").trim()) patch.mail_texto="We do not have this document yet. Please grant us access or send us a copy.";
  try{ await aapi("aud_hallazgo_save",{ id:hid, patch, quien:quien() }); await recargarCliente(); toast(destino==="CLIENTE"?"Se pide al cliente ✓":"Marcado como error nuestro ✓"); }catch(ex){ toast(ex.message,true); }
}
const puntosMail = (run)=>puntosDe(run.id).filter(h=>pideCliente(h)&&HALL_ABIERTO(h));
const fotoMail = (h,t)=>fotosDe(x=>x.hallazgo_id===h.id&&x.tipo===t);
function faltanMail(run){ return puntosMail(run).filter(h=>!String(h.mail_texto||"").trim()||!fotoMail(h,"QuickBooks").length||!fotoMail(h,"Extracto").length); }
function periodoEn(r){ const d=String(r.periodo_desde||""), h=String(r.periodo_hasta||""); if(!h) return "";
  const a=+d.slice(5,7), b=+h.slice(5,7); return `${d&&a!==b?MES_EN[a-1]+"–":""}${MES_EN[b-1]} ${h.slice(0,4)}`; }
function hastaEn(r){ const h=String(r.periodo_hasta||""); return h?`${MES_EN[+h.slice(5,7)-1]} ${+h.slice(8,10)}, ${h.slice(0,4)}`:""; }
const filasMail = (h)=>filasDe(h.id).filter(f=>f.estado!=="Ya no aparece");
function mailDatos(run){
  const cli=cliDe(A.cid).nombre, per=periodoEn(run), hasta=hastaEn(run);
  return { asunto:`${cli} — Items needed${per?` for ${per}`:""}`,
    intro:`We are reviewing your books${hasta?` through ${hasta}`:""} and need your help with the items below. For each one we include how it looks in your books and in your bank statement. Please reply at your earliest convenience.`,
    cierre:"Please reply to this email with the information.", firma:["Thank you,","","Dennis Chermisqui, CPA","Chermisqui & Associates"],
    items:puntosMail(run).map((h,i)=>({ n:i+1, h, texto:String(h.mail_texto||"").trim(), filas:filasMail(h), qb:fotoMail(h,"QuickBooks"), ext:fotoMail(h,"Extracto") })) };
}
function tabMail(root){
  const run=runSel(); if(!run){ root.innerHTML=`<div class="empty">Todavía no hay auditorías de este cliente.</div>`; return; }
  const M=mailDatos(run);
  if(!M.items.length){ root.innerHTML=`<div class="empty">En esta auditoría no hay nada para pedirle al cliente.</div>`; return; }
  const slot=(it,t,tit)=>{ const fs=t==="QuickBooks"?it.qb:it.ext; return `<div class="ml-slot ${fs.length?"":"falta"}"><div class="ml-slot-t">${tit}${fs.length?"":' <span class="ml-falta">falta</span>'}</div>
      ${fs.length?`<div class="ax-fotos">${fs.map(f=>fotoThumb(f)).join("")}</div>`:""}${zonaFoto({ hallazgo_id:it.h.id, tipo:t })}</div>`; };
  root.innerHTML=`
    <div class="ml-bar chart-card wide">
      <div id="ml-estado"></div>
      <div class="ml-acts"><button class="btn ghost" id="ml-copy">📋 Copiar mail</button><button class="btn primary" id="ml-eml">⬇ Abrir en Outlook</button></div>
    </div>
    <div class="ml-mail">
      <div class="ml-asunto"><span>Subject</span> ${esc(M.asunto)}</div>
      <p>Hi,</p><p>${esc(M.intro)}</p>
      ${M.items.map(it=>`<div class="ml-item" id="ml-h${it.h.id}">
        <div class="ml-ref" title="Solo lo ves vos, no sale en el mail">Punto ${esc(it.h.ref)} · ${esc(it.h.titulo)}</div>
        <div class="ml-texto"><b>${it.n}.</b> <textarea rows="2" data-mt="${it.h.id}" placeholder="Write the request in English. Example: Please let us know what this payment is for.">${esc(it.texto)}</textarea></div>
        ${it.filas.length?`<table class="ml-tabla"><thead><tr><th>Date</th><th>Description</th><th class="r">Amount</th><th>Your answer</th></tr></thead><tbody>${it.filas.map(f=>`<tr><td>${esc(f.fecha||"")}</td><td>${esc([f.num,f.payee].filter(Boolean).join(" · "))}</td><td class="r">${money2(f.monto)}</td><td></td></tr>`).join("")}</tbody></table>`:""}
        <div class="ml-slots">${slot(it,"QuickBooks","In your books (QuickBooks)")}${slot(it,"Extracto","In your bank statement")}</div>
      </div>`).join("")}
      <p>${esc(M.cierre)}</p><p class="ml-firma">${M.firma.map(esc).join("<br>")}</p>
    </div>
    ${run.mail_cliente?`<details class="ml-ant"><summary class="muted">Texto armado antes para este mail (para copiar lo que sirva)</summary><pre class="ax-rep">${esc(run.mail_cliente)}</pre></details>`:""}`;
  const pintaEstado=()=>{ const fal=faltanMail(run);
    $("#ml-estado",root).innerHTML=fal.length?`<b class="ml-warn">⚠ Faltan fotos o texto en ${fal.length} de ${M.items.length} puntos:</b> ${fal.map(h=>`<a href="#ml-h${h.id}" data-mgo="${h.id}">${esc(h.ref)}</a>`).join(", ")}`
      :`<b class="ml-ok">✔ Listo para enviar.</b> <span class="muted">Lo manda Breana.</span>`;
    $$("[data-mgo]",root).forEach(a=>a.addEventListener("click",e=>{ e.preventDefault(); $("#ml-h"+a.dataset.mgo)?.scrollIntoView({behavior:"smooth",block:"start"}); })); };
  pintaEstado();
  $$("[data-mt]",root).forEach(t=>{ const alto=()=>{ t.style.height="auto"; t.style.height=t.scrollHeight+"px"; }; alto(); t.addEventListener("input",alto);
    t.addEventListener("change",async ()=>{ const id=+t.dataset.mt, v=t.value.trim();
      try{ await aapi("aud_hallazgo_save",{ id, patch:{ mail_texto:v||null } }); const h=A.exp.hallazgos.find(x=>x.id===id); h.mail_texto=v||null; pintaEstado(); }
      catch(ex){ toast(ex.message,true); } }); });
  bindFotos(root);
  const seguir=()=>{ const n=faltanMail(run).length; return !n||confirm(`A ${n} punto${n===1?"":"s"} le${n===1?"":"s"} falta foto o texto. ¿Armar el mail igual?`); };
  $("#ml-copy",root).addEventListener("click",async ()=>{ if(!seguir()) return;
    try{ toast("Armando el mail…"); const m=await mailListo(run);
      const html=mailHtml(m,f=>f.data), txt=mailTxt(m);
      await navigator.clipboard.write([new ClipboardItem({ "text/html":new Blob([html],{type:"text/html"}), "text/plain":new Blob([txt],{type:"text/plain"}) })]);
      toast("Mail copiado ✓ Pegalo en el correo con Ctrl+V"); }
    catch(ex){ toast("No se pudo copiar: "+ex.message,true); } });
  $("#ml-eml",root).addEventListener("click",async ()=>{ if(!seguir()) return;
    try{ toast("Armando el mail…"); const m=await mailListo(run); bajarEml(m); toast("Abrí el archivo: se abre en Outlook listo para enviar"); }
    catch(ex){ toast("No se pudo armar: "+ex.message,true); } });
}
/* Baja las fotos para meterlas dentro del mail (las URLs firmadas vencen, por eso se recarga antes). */
async function mailListo(run){
  A.exp=await aapi("aud_cliente",{ cliente_id:A.cid });
  const m=mailDatos(run);
  for(const it of m.items) for(const f of [...it.qb,...it.ext]){
    if(!f.url) throw new Error("no se pudo leer la foto "+f.nombre);
    const blob=await (await fetch(f.url)).blob();
    f.data=await new Promise((ok,mal)=>{ const r=new FileReader(); r.onload=()=>ok(r.result); r.onerror=mal; r.readAsDataURL(blob); });
    f.b64=f.data.split(",")[1]; f.tipoMime=blob.type||f.mime||"image/png";
    try{ const b=await createImageBitmap(blob); f.ancho=Math.min(b.width,640); b.close(); }catch(_){ f.ancho=640; }
  }
  return m;
}
function mailHtml(m, src){
  const td='style="border:1px solid #bbb;padding:5px 8px"', th='style="border:1px solid #bbb;padding:5px 8px;background:#eee;text-align:left"';
  const fotos=(t,fs)=>fs.length?`<p style="margin:10px 0 4px"><b>${t}</b></p>${fs.map(f=>`<p style="margin:0 0 8px"><img src="${src(f)}" width="${f.ancho||640}" alt="${esc(t)}" style="border:1px solid #bbb;max-width:100%"></p>`).join("")}`:"";
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000"><p>Hi,</p><p>${esc(m.intro)}</p>`+
    m.items.map(it=>`<p style="margin-top:18px"><b>${it.n}.</b> ${esc(it.texto).replace(/\n/g,"<br>")}</p>
      ${it.filas.length?`<table style="border-collapse:collapse;font-size:10pt"><tr><th ${th}>Date</th><th ${th}>Description</th><th ${th}>Amount</th><th ${th}>Your answer</th></tr>${it.filas.map(f=>`<tr><td ${td}>${esc(f.fecha||"")}</td><td ${td}>${esc([f.num,f.payee].filter(Boolean).join(" · "))}</td><td ${td} align="right">${money2(f.monto)}</td><td ${td}>&nbsp;</td></tr>`).join("")}</table>`:""}
      ${fotos("In your books (QuickBooks)",it.qb)}${fotos("In your bank statement",it.ext)}`).join("")+
    `<p style="margin-top:18px">${esc(m.cierre)}</p><p>${m.firma.map(esc).join("<br>")}</p></div>`;
}
function mailTxt(m){
  return ["Hi,","",m.intro,"",...m.items.flatMap(it=>[`${it.n}. ${it.texto}`,...it.filas.map(f=>`   ${[f.fecha,f.num,f.payee,money2(f.monto)].filter(Boolean).join(" | ")}`),""]),m.cierre,"",...m.firma].join("\r\n");
}
function b64Utf8(s){ return btoa(unescape(encodeURIComponent(s))); }
const lineas76 = (s)=>s.replace(/(.{76})/g,"$1\r\n");
/* .eml sin enviar (X-Unsent): Outlook lo abre como mail nuevo, con las fotos adentro. */
function bajarEml(m,armar=mailHtml){
  const lim="=_qb_"+Date.now(), fotos=m.items.flatMap(it=>[...it.qb,...it.ext]);
  fotos.forEach((f,i)=>{ f.cid=`foto${i+1}@chermisqui`; });
  const html=armar(m,f=>"cid:"+f.cid);
  const partes=[`--${lim}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${lineas76(b64Utf8(html))}`,
    ...fotos.map((f,i)=>`--${lim}\r\nContent-Type: ${f.tipoMime}; name="foto${i+1}"\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <${f.cid}>\r\nContent-Disposition: inline; filename="foto${i+1}"\r\n\r\n${lineas76(f.b64)}`)];
  const eml=`X-Unsent: 1\r\nSubject: =?UTF-8?B?${b64Utf8(m.asunto)}?=\r\nMIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${lim}"\r\n\r\n${partes.join("\r\n")}\r\n--${lim}--\r\n`;
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([eml],{type:"message/rfc822"}));
  a.download=`Mail - ${cliDe(A.cid).nombre.replace(/[\\/:*?"<>|]/g,"")}${m.archivo||""}.eml`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),5000);
}

/* ---- Mail a Dennis: los puntos «Consultar con Dennis». Es un aviso: no bloquea nada. ---- */
const puntosDennis = (run)=>puntosDe(run.id).filter(h=>h.destino==="DEFINIR"&&HALL_ABIERTO(h));
function dennisDatos(run){
  const cli=cliDe(A.cid).nombre, per=periodoRev(run);
  return { archivo:" - Dennis", asunto:`${cli} – Consultas ${per}`,
    intro:`Te consulto estos puntos de la revisión de ${cli} (${per}).`,
    items:puntosDennis(run).map((h,i)=>({ n:i+1, h, filas:filasMail(h), qb:[], ext:[] })), firma:["Gracias,",quien()||"Matías Romero"] };
}
const descFila = (f)=>[f.num,f.payee].filter(Boolean).join(" · ");
function dennisHtml(m){
  const td='style="border:1px solid #bbb;padding:5px 8px"', th='style="border:1px solid #bbb;padding:5px 8px;background:#eee;text-align:left"';
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000"><p>Hola Dennis,</p><p>${esc(m.intro)}</p>`+
    m.items.map(it=>`<p style="margin:18px 0 4px"><b>${it.n}. ${esc(it.h.titulo)}</b></p><p style="margin:0 0 4px">${esc(it.h.detalle||"")}</p><p style="margin:0 0 8px"><b>Consulta:</b> ${esc(it.h.recomendacion||"")}</p>
      ${it.filas.length?`<table style="border-collapse:collapse;font-size:10pt"><tr><th ${th}>Fecha</th><th ${th}>Detalle</th><th ${th}>Monto</th><th ${th}>Está en</th></tr>${it.filas.map(f=>`<tr><td ${td}>${esc(f.fecha||"")}</td><td ${td}>${esc(descFila(f))}</td><td ${td} align="right">${money2(f.monto)}</td><td ${td}>${esc(f.de||"")}</td></tr>`).join("")}</table>`:""}`).join("")+
    `<p style="margin-top:18px">${m.firma.map(esc).join("<br>")}</p></div>`;
}
function dennisTxt(m){
  return ["Hola Dennis,","",m.intro,"",...m.items.flatMap(it=>[`${it.n}. ${it.h.titulo}`,it.h.detalle||"",`Consulta: ${it.h.recomendacion||""}`,...it.filas.map(f=>`   ${[f.fecha,descFila(f),money2(f.monto),f.de].filter(Boolean).join(" | ")}`),""]),...m.firma].join("\r\n");
}
function tabDennis(root){
  const run=runSel(); if(!run){ root.innerHTML=`<div class="empty">Todavía no hay auditorías de este cliente.</div>`; return; }
  const M=dennisDatos(run);
  if(!M.items.length){ root.innerHTML=`<div class="empty">En esta auditoría no hay nada para consultar con Dennis.</div>`; return; }
  root.innerHTML=`<div class="ml-bar chart-card wide"><div><b>${M.items.length} punto${M.items.length===1?"":"s"} para consultar.</b> <span class="muted">Es un aviso: nada queda bloqueado. Lo que conteste se anota en cada punto de la Revisión.</span></div>
      <div class="ml-acts"><button class="btn ghost" id="md-copy">📋 Copiar mail</button><button class="btn primary" id="md-eml">⬇ Abrir en Outlook</button></div></div>
    <div class="ml-mail"><div class="ml-asunto"><span>Asunto</span> ${esc(M.asunto)}</div><p>Hola Dennis,</p><p>${esc(M.intro)}</p>
      ${M.items.map(it=>`<div class="ml-item"><div class="ml-ref" title="Solo lo ves vos, no sale en el mail">Punto ${esc(it.h.ref)}</div>
        <p><b>${it.n}. ${esc(it.h.titulo)}</b></p><p>${esc(it.h.detalle||"")}</p><p><b>Consulta:</b> ${esc(it.h.recomendacion||"")}</p>
        ${it.filas.length?`<table class="ml-tabla"><thead><tr><th>Fecha</th><th>Detalle</th><th class="r">Monto</th><th>Está en</th></tr></thead><tbody>${it.filas.map(f=>`<tr><td>${esc(f.fecha||"")}</td><td>${esc(descFila(f))}</td><td class="r">${money2(f.monto)}</td><td>${esc(f.de||"")}</td></tr>`).join("")}</tbody></table>`:""}</div>`).join("")}
      <p class="ml-firma">${M.firma.map(esc).join("<br>")}</p></div>`;
  $("#md-copy",root).addEventListener("click",async ()=>{
    try{ await navigator.clipboard.write([new ClipboardItem({ "text/html":new Blob([dennisHtml(M)],{type:"text/html"}), "text/plain":new Blob([dennisTxt(M)],{type:"text/plain"}) })]); toast("Mail copiado ✓ Pegalo en el correo con Ctrl+V"); }
    catch(ex){ toast("No se pudo copiar: "+ex.message,true); } });
  $("#md-eml",root).addEventListener("click",()=>{ bajarEml(M,dennisHtml); toast("Abrí el archivo: se abre en Outlook listo para enviar"); });
}

/* ---- Historial: qué se corrigió, quién y cuándo ---- */
function fechaHora(t){ if(!t) return "—"; const d=new Date(t); return isNaN(d)?String(t):d.toLocaleString("es-AR",{ day:"2-digit", month:"2-digit", year:"2-digit", hour:"2-digit", minute:"2-digit" }); }
function tabHistorial(root){
  const run=runSel(); if(!run){ root.innerHTML=`<div class="empty">Todavía no hay auditorías de este cliente.</div>`; return; }
  const todos=(A.exp.log||[]).filter(l=>l.run_id===run.id);
  const gente=[...new Set(todos.map(l=>l.quien||"Sin nombre"))].sort();
  if(A.hq&&!gente.includes(A.hq)) A.hq="";
  const lista=todos.filter(l=>!A.hq||(l.quien||"Sin nombre")===A.hq);
  const dia=l=>String(fechaHora(l.creado_at)).split(",")[0];
  const dias=[...new Set(lista.map(dia))];
  root.innerHTML=`<div class="ax-bar"><span class="muted">${lista.length} movimiento${lista.length===1?"":"s"} de esta auditoría, del más nuevo al más viejo.</span>
      ${gente.length>1?`<label class="ax-inl">Persona <select id="hx-q"><option value="">Todos</option>${gente.map(g=>`<option ${g===A.hq?"selected":""}>${esc(g)}</option>`).join("")}</select></label>`:""}</div>
    ${lista.length?dias.map(d=>`<div class="hx-dia">${esc(d)}</div><div class="hx-lista">${lista.filter(l=>dia(l)===d).map(l=>{ const fs=l.correccion_id?fotosDe(x=>x.correccion_id===l.correccion_id):[];
      return `<div class="hx-fila"><span class="hx-hora">${esc(String(fechaHora(l.creado_at)).split(", ")[1]||"")}</span>
        <span class="hx-acc ${/Corregido/.test(l.accion)?"ok":/pendiente|quitada/i.test(l.accion)?"off":""}">${esc(l.accion)}</span>
        <div class="hx-det">${l.ref?`<b>${esc(l.ref)}</b> `:""}${esc(l.fila||"")}${l.monto!=null?` <span class="muted">· ${money2(l.monto)}</span>`:""}${l.nota?`<div class="rv-nota">${esc(l.nota)}</div>`:""}</div>
        ${l.accion!=="Foto quitada"&&fs.length?`<div class="ax-fotos sm">${fs.map(f=>fotoThumb(f,false)).join("")}</div>`:""}
        <span class="hx-quien">${esc(l.quien||"Sin nombre")}</span></div>`; }).join("")}</div>`).join("")
      :`<div class="empty">Todavía no se corrigió nada en esta auditoría. Cada fila que se tilde en la Revisión va a quedar acá.</div>`}`;
  $("#hx-q",root)?.addEventListener("change",e=>{ A.hq=e.target.value; renderExp(); });
  bindFotos(root);
}

/* ---- Revisión: qué corregir, fila por fila ----
   Lo mismo que la parte 1 del Word «Revisión», pero cada tilde se guarda en
   la base al instante (quién y cuándo). Un punto pasa a Resuelto solo cuando
   todas sus filas están resueltas (lo hace qb-api). Abajo, la respuesta a
   Dennis armada con lo tildado. */
const runsConRevision = ()=>(A.exp?.runs||[]).filter(r=>A.exp.hallazgos.some(h=>h.run_id===r.id&&h.ref));
const quien = ()=>localStorage.getItem("qb_aud_quien")||"";
const money2 = (v)=>v==null||v===""?"":"$"+Number(v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const filasDe = (hid)=>(A.exp.correcciones||[]).filter(f=>f.hallazgo_id===hid);
const hecha = (f)=>CORR_HECHAS.includes(f.estado);
const filasRev = (hs)=>hs.flatMap(h=>filasDe(h.id).filter(f=>HALL_ABIERTO(h)||f.estado!=="Pendiente"));
function periodoRev(r){ const m=String(r.reporte_dennis||"").split("\n")[0].match(/Revisi[oó]n (.+)$/); return m?m[1].trim():periodoTxt(r); }

/* Vistas de la Revisión, según lo que hay que hacer con cada punto. Un punto con pedido escrito sale también en «Pedir al cliente». */
const VISTAS = [["corregir","Corregir"],["cliente","Pedir al cliente"],["dennis","Consultar con Dennis"],["otros","Otros"]];
const enVista = (h,v)=>v==="cliente"?pideCliente(h):v==="dennis"?["DEFINIR","DEFINIDO"].includes(h.destino):v==="otros"?["CONTROL","CIERRE ANUAL"].includes(h.destino):!["CLIENTE","DEFINIR","DEFINIDO","CONTROL","CIERRE ANUAL"].includes(h.destino);
const vistaDe = (h)=>VISTAS.map(v=>v[0]).find(v=>v!=="cliente"&&enVista(h,v))||"cliente";
function tabRevision(root){
  const run=runSel();
  const hs=run?puntosDe(run.id):[];
  if(!hs.length){ root.innerHTML=`<div class="empty">Esta auditoría todavía no tiene la Revisión cargada (los puntos a corregir con sus filas). La carga el skill al guardar la auditoría.</div>`; return; }
  const filas=filasRev(hs);
  const nOk=filas.filter(hecha).length, pctF=filas.length?Math.round(nOk*100/filas.length):0;
  const resueltos=hs.filter(h=>!HALL_ABIERTO(h)).length;
  const visible=(h)=>A.rfil==="todo"||HALL_ABIERTO(h)||(A.rmodo&&!!h.revision_estado);
  const aRevisar=hs.filter(h=>h.revision_estado||HALL_ABIERTO(h)), revisados=aRevisar.filter(h=>h.revision_estado).length;
  const vis=(h)=>visible(h)&&enVista(h,A.rvis);
  const hayVisibles=hs.some(vis);
  root.innerHTML=`
    <div class="rv-top chart-card wide">
      <div class="rv-top-l">
        <div class="rv-prog"><div class="rv-bar"><i style="width:${pctF}%"></i></div>
          <span><b>${nOk}</b> de ${filas.length} filas · <b>${resueltos}</b> de ${hs.length} puntos resueltos${A.rmodo?` · <b>${revisados}</b> de ${aRevisar.length} revisados`:""}</span></div>
      </div>
      <div class="rv-top-r">
        <label class="ax-inl">Trabajando como <input type="text" id="rv-quien" list="rv-equipo" placeholder="Tu nombre" value="${esc(quien())}"></label>
        <datalist id="rv-equipo">${["Matías Romero","Sebastián Pita","Manuel Criscuoli","Edward","Nicolás","Martín"].map(n=>`<option value="${n}">`).join("")}</datalist>
        <button class="tab ${A.rmodo?"active":""}" id="rv-modo" title="Muestra en cada punto: OK, Sacar, Cambiar y Ya lo sé">Modo revisión</button>
        <div class="ax-seg">${[["pend","Pendientes"],["todo","Todo"]].map(s=>`<button class="tab ${A.rfil===s[0]?"active":""}" data-rf="${s[0]}">${s[1]}</button>`).join("")}</div>
      </div>
    </div>
    <div class="rv-vistas">
      <div class="ax-seg">${VISTAS.map(v=>{ const n=hs.filter(h=>visible(h)&&enVista(h,v[0])).length; return `<button class="tab ${A.rvis===v[0]?"active":""}" data-rvis="${v[0]}">${v[1]} <span class="rv-n">${n}</span></button>`; }).join("")}</div>
      ${hayVisibles?`<div class="rv-plegar"><button class="btn ghost sm" data-rtodos="1">Abrir todos</button><button class="btn ghost sm" data-rtodos="0">Plegar todos</button></div>`:""}
    </div>
    <div class="rr-note">${A.rmodo?"Decidí cada punto: <b>OK</b> queda como está, <b>Sacar</b> lo descarta, <b>Cambiar</b> deja qué corregir y <b>Ya lo sé</b> lo descarta y propone el criterio para la memoria. Tocá de nuevo la opción elegida para deshacerla.":"Abrí un punto y tildá cada fila cuando la corrijas en QuickBooks. Usá <b>📷</b> para la foto y <b>⋯</b> si la hiciste distinto o no corresponde."}</div>
    ${PASO_ORDEN.map(k=>{ const g=hs.filter(h=>(h.paso||"otros")===k&&vis(h)); if(!g.length) return "";
      return `<div class="rv-paso"><div class="rv-paso-tit">${k==="otros"?"Otros controles":`Paso ${esc(k)} · ${esc(PASOS_DENNIS[k]||"")}`}</div>${g.map(puntoCard).join("")}</div>`; }).join("")
      || `<div class="empty">${hs.some(visible)?"✔ No queda nada pendiente en esta vista.":"✔ No queda nada pendiente en esta auditoría."}</div>`}`;
  bindRevision(root, run);
  bindFotos(root);
}

function puntoCard(h){
  const fs=filasDe(h.id), ok=fs.filter(hecha).length;
  const marca=MARCA[h.destino];
  const est = h.estado==="Resuelto" ? `<span class="rv-est ok">✔ Resuelto${h.resuelto_fecha?` · ${fechaCorta(h.resuelto_fecha)}`:""}</span>`
    : h.estado==="Descartado" ? `<span class="rv-est off">Descartado</span>`
    : fs.length ? `<span class="rv-est">${ok} de ${fs.length}</span>` : `<span class="rv-est">Abierto</span>`;
  const abierto=A.rab.has(h.id);
  const marcaVisible=marca&&!(A.rvis==="cliente"&&h.destino==="CLIENTE")&&!(A.rvis==="dennis"&&h.destino==="DEFINIR");
  return `<div class="rv-punto ${HALL_ABIERTO(h)?"":"cerrado"} ${abierto?"abierto":""}" id="rv-h${h.id}">
    <div class="rv-head" role="button" tabindex="0" aria-expanded="${abierto}" data-rab="${h.id}"><span class="rv-caret" aria-hidden="true">▸</span><span class="rv-ref">${esc(h.ref)}</span>
      <div class="rv-h-tit"><b>${esc(h.titulo)}</b>
        ${marcaVisible?` <span class="rv-marca ${marca[1]}">${marca[0]}</span>`:""}${h.destino!=="CLIENTE"&&pideCliente(h)&&A.rvis!=="cliente"?` <span class="rv-marca cli">También al cliente</span>`:""}</div>
      ${h.monto!=null?`<span class="rv-monto">${money2(h.monto)}</span>`:""}${est}
      ${A.rmodo?`<span class="rv-dec">${REV_BOTONES.map(b=>`<button type="button" class="rv-dbtn ${b[1]} ${h.revision_estado===b[0]?"on":""}" data-rev="${h.id}" data-rtipo="${b[0]}" aria-pressed="${h.revision_estado===b[0]}">${b[0]}</button>`).join("")}</span>`:h.revision_estado?`<span class="rv-marca rev">${esc(h.revision_estado)}</span>`:""}</div>
    <div class="rv-cuerpo">${faltaHtml(h)}${h.revision_estado?`<div class="rv-revnota"><b>Revisión: ${esc(h.revision_estado)}${h.revision_por?` · ${esc(h.revision_por)}`:""}</b>${h.revision_nota?` — ${esc(h.revision_nota)}`:""}</div>`:""}<div class="rv-txt"><div><b>Qué pasa:</b> ${esc(h.detalle||"—")}</div><div><b>Qué hacer:</b> ${esc(h.recomendacion||"—")}</div>
      ${h.respuesta_dennis?`<div class="rv-dennis"><b>Dennis:</b> ${esc(h.respuesta_dennis)}</div>`:""}</div>
    ${fs.length?`<div class="ax-scroll"><table class="ip-table rv-tabla"><thead><tr><th>✓</th><th>Fecha</th><th>Num</th><th class="l">Payee</th><th class="r">Monto</th><th class="l">Está en</th><th class="l">Pasar a / qué hacer</th><th class="l">Estado</th><th></th></tr></thead><tbody>
      ${fs.map(f=>`<tr class="${hecha(f)?"rv-ok":""} ${f.estado==="Ya no aparece"?"rv-ya":""}">
        <td data-label="✓">${f.estado==="Pendiente"||f.estado==="Corregido"
          ?`<input type="checkbox" class="rv-chk" data-fid="${f.id}" ${f.estado==="Corregido"?"checked":""} title="Corregido">`
          :`<span class="rv-ico" title="${esc(f.estado)}">${CORR_ICONO[f.estado]}</span>`}</td>
        <td data-label="Fecha">${esc(f.fecha||"")}</td><td data-label="Num">${esc(f.num||"")}</td>
        <td class="l" data-label="Payee">${esc(f.payee||"")}${f.nueva?` <span class="rv-nueva" title="Apareció al volver a correr la auditoría">nueva</span>`:""}${f.origen==="Manual"?` <span class="rv-nueva man">a mano</span>`:""}</td>
        <td class="r" data-label="Monto">${money2(f.monto)}</td>
        <td class="l" data-label="Está en">${esc(f.de||"")}</td>
        <td class="l" data-label="Pasar a">${esc(f.a||"")}${f.a_editado&&f.origen!=="Manual"?` <span class="muted" title="Cambiado a mano">✎</span>`:""}</td>
        <td class="l rv-quien" data-label="Estado">${f.estado==="Pendiente"?'<span class="muted">Pendiente</span>'
          :`${esc(f.estado)}${f.hecho_por?` · ${esc(f.hecho_por)}`:""}${f.hecho_at?` · ${fechaCorta(String(f.hecho_at).slice(0,10))}`:""}${f.nota?`<div class="rv-nota">${esc(f.nota)}</div>`:""}`}
          ${(()=>{ const ft=fotosDe(x=>x.correccion_id===f.id); return ft.length?`<div class="ax-fotos sm">${ft.map(x=>fotoThumb(x,false)).join("")}</div>`:""; })()}</td>
        <td class="rv-bts">${["Corregido","Hecho distinto"].includes(f.estado)?`<button class="btn ghost sm" data-ffoto="${f.id}" title="Agregar la foto de la corrección">📷</button>`:""}<button class="btn ghost sm" data-fmas="${f.id}" title="Hecho distinto, no corresponde, cambiar destino">⋯</button></td></tr>`).join("")}
    </tbody></table></div>`:""}
    <div class="rv-acts">
      <button class="btn ghost sm" data-fadd="${h.id}">+ Agregar fila</button>
      ${["DEFINIR","DEFINIDO"].includes(h.destino)?`<button class="btn ghost sm" data-dennis="${h.id}">📝 ${h.respuesta_dennis?"Editar":"Anotar"} lo que dijo Dennis</button>`:""}
      ${!fs.length?(HALL_ABIERTO(h)?`<button class="btn primary sm" data-hok="${h.id}">✔ Marcar resuelto</button>`:`<button class="btn ghost sm" data-hreab="${h.id}">Reabrir</button>`):""}
      ${HALL_ABIERTO(h)&&h.destino!=="CLIENTE"?`<button class="btn ghost sm" data-hcli="${h.id}" title="${pideCliente(h)?"Editar o quitar el pedido al cliente":"Agrega este punto al mail al cliente, sin cambiar lo que hay que corregir"}">✉️ ${pideCliente(h)?"Pedido al cliente":"Pedir al cliente"}</button>`:""}
      <button class="btn ghost sm" data-hedit="${h.id}" title="Cambiar el destino o descartar el punto">⋯ Punto</button>
    </div></div></div>`;
}

/* Respuesta a Dennis (su plantilla HECHA) armada con lo tildado. */
function textoRespuesta(run, hs){
  const cli=cliDe(A.cid).nombre, per=periodoRev(run);
  const base={}; String(run.reporte_dennis||"").split("\n").forEach(l=>{ const m=l.match(/^(✅|❌)\s*([0-9]+|T)\./); if(m) base[m[2]]=m[1]; });
  const refs=(g)=>g.map(h=>h.ref+(HALL_ABIERTO(h)?" pendiente":"")).join(", ");
  const L=[`Asunto: ${cli} – Revisión ${per} – HECHA`,"","Hola Dennis,","",
    `Revisión de ${cli} (${per}) terminada. ✅ = revisado sin problemas · ❌ = corregido (detalle en los puntos).`,"","Checklist"];
  Object.keys(PASOS_DENNIS).forEach(k=>{ const g=hs.filter(h=>h.paso===k); const err=g.length>0||base[k]==="❌";
    L.push(`${err?"❌":"✅"} ${k}. ${PASOS_DENNIS[k]}${CAPTURA[k]?` → 📷 ${CAPTURA[k]}`:""}${g.length?`  (${refs(g)})`:""}`); });
  const otros=hs.filter(h=>(h.paso||"otros")==="otros"); if(otros.length) L.push(`❌ Otros controles  (${refs(otros)})`);
  L.push("","Capturas",...Object.keys(CAPTURA).map(k=>`[${k}. ${PASOS_DENNIS[k]}: pegar la captura acá]`));
  const def=hs.filter(h=>h.destino==="DEFINIR"&&HALL_ABIERTO(h)); if(def.length) L.push("","Para consultar con vos",...def.map(h=>`• ${h.ref} ${h.titulo}: ${h.recomendacion||""}`));
  const yaDef=hs.filter(h=>h.respuesta_dennis); if(yaDef.length) L.push("","Lo que me dijiste (aplicado)",...yaDef.map(h=>`• ${h.ref} ${h.titulo}: ${h.respuesta_dennis}`));
  const cl=hs.filter(h=>pideCliente(h)&&HALL_ABIERTO(h)); if(cl.length) L.push("","Pendiente del cliente",...cl.map(h=>`• ${h.ref} ${h.titulo}`));
  L.push("","Saludos,",quien()||"");
  return L.join("\n");
}
function respuestaCard(run, hs){
  const falta=hs.filter(h=>HALL_ABIERTO(h)&&["AJUSTE","DEFINIR","DEFINIDO","CONTROL",null,undefined].includes(h.destino));
  return `<div class="chart-card wide rv-resp"><h3>📨 Respuesta a Dennis <span class="muted">· su plantilla HECHA, armada con lo tildado</span>
      <button class="btn ghost sm" id="rv-copy">Copiar</button></h3>
    ${falta.length?`<div class="rv-falta">⚠ Faltan corregir ${falta.length} punto${falta.length===1?"":"s"}: ${falta.map(h=>`<a href="#rv-h${h.id}" class="rv-go" data-go="${h.id}">${esc(h.ref)}</a>`).join(", ")}. Salen como «pendiente» en la respuesta.</div>`
      :`<div class="rv-listo">✔ Todo lo que depende del equipo está corregido.</div>`}
    <pre class="ax-rep" id="rv-texto">${esc(textoRespuesta(run, hs))}</pre></div>`;
}

function pedirQuien(){
  if(quien()) return true;
  toast("Escribí tu nombre en «Trabajando como» antes de tildar",true); $("#rv-quien")?.focus(); return false;
}
async function guardarFila(id, patch){
  const ab=$("#ax-body"), y=ab?ab.scrollTop:0;
  try{
    const d=await aapi("aud_correccion_save",{ id, patch, quien:quien() });
    const i=A.exp.correcciones.findIndex(f=>f.id===id); if(i>=0) A.exp.correcciones[i]=d.fila;
    if(d.hallazgo){ const j=A.exp.hallazgos.findIndex(h=>h.id===d.hallazgo.id); if(j>=0) A.exp.hallazgos[j]={...A.exp.hallazgos[j],...d.hallazgo}; }
    if(d.log) (A.exp.log=A.exp.log||[]).unshift(d.log);
    renderExp(); const nb=$("#ax-body"); if(nb) nb.scrollTop=y;
    if(d.hallazgo?.estado==="Resuelto") toast(`Punto ${A.exp.hallazgos.find(h=>h.id===d.hallazgo.id)?.ref||""} resuelto ✔`);
    return true;
  }catch(ex){ toast(ex.message,true); renderExp(); const nb=$("#ax-body"); if(nb) nb.scrollTop=y; return false; }
}
function editarFila(id){
  const f=A.exp.correcciones.find(x=>x.id===id), h=A.exp.hallazgos.find(x=>x.id===f.hallazgo_id);
  const ests=["Pendiente","Corregido","Hecho distinto","No corresponde"].concat(f.estado==="Ya no aparece"?["Ya no aparece"]:[]);
  openModal(`${h.ref} · ${f.payee||f.num||"Fila"}`,`
    <p class="muted">${esc([f.fecha,f.num,money2(f.monto),f.de].filter(Boolean).join(" · "))}</p>
    <label>Estado</label><div class="rv-radios">${ests.map(e=>`<label><input type="radio" name="rv-e" value="${e}" ${e===f.estado?"checked":""}> ${CORR_ICONO[e]} ${e}</label>`).join("")}</div>
    <label>Pasar a / qué hacer</label><input type="text" id="rv-a" value="${esc(f.a||"")}">
    <label>Nota <span class="muted">(obligatoria si es «Hecho distinto» o «No corresponde»)</span></label><textarea id="rv-n" rows="3" placeholder="Ej: 2082 → Commissions, confirmado con Dennis">${esc(f.nota||"")}</textarea>
    <div class="modal-actions">${f.origen==="Manual"?`<button class="btn ghost ax-danger" id="rv-del">Quitar fila</button>`:""}<button class="btn ghost" id="rv-cancel">Cancelar</button><button class="btn primary" id="rv-save">Guardar</button></div>`);
  $("#rv-cancel").addEventListener("click",closeModal);
  $("#rv-del")?.addEventListener("click",async ()=>{ try{ const d=await aapi("aud_correccion_del",{ id }); closeModal(); await recargarCliente(); toast("Fila quitada"); }catch(ex){ toast(ex.message,true); } });
  $("#rv-save").addEventListener("click",async ()=>{
    const estado=($("input[name=rv-e]:checked")||{}).value||f.estado, nota=$("#rv-n").value.trim(), a=$("#rv-a").value.trim();
    if(["Hecho distinto","No corresponde"].includes(estado)&&!nota) return toast("Escribí la nota: qué se hizo o por qué no corresponde",true);
    if(estado!==f.estado&&estado!=="Pendiente"&&!pedirQuien()) return closeModal();
    const patch={ nota }; if(estado!==f.estado) patch.estado=estado; if(a!==(f.a||"")) patch.a=a;
    if(await guardarFila(id,patch)) closeModal();
  });
}
function agregarFila(hid){
  const h=A.exp.hallazgos.find(x=>x.id===hid);
  openModal(`${h.ref} · agregar transacción`,`
    <div class="row2"><div><label>Fecha (MM/DD/AAAA)</label><input type="text" id="rf-fecha"></div><div><label>Num</label><input type="text" id="rf-num"></div></div>
    <div class="row2"><div><label>Payee</label><input type="text" id="rf-payee"></div><div><label>Monto</label><input type="text" id="rf-monto" inputmode="decimal"></div></div>
    <label>Está en</label><input type="text" id="rf-de"><label>Pasar a / qué hacer</label><input type="text" id="rf-a"><label>Nota</label><input type="text" id="rf-nota">
    <div class="modal-actions"><button class="btn ghost" id="rf-cancel">Cancelar</button><button class="btn primary" id="rf-ok">Agregar</button></div>`);
  $("#rf-cancel").addEventListener("click",closeModal);
  $("#rf-ok").addEventListener("click",async ()=>{
    const v=(i)=>$(i).value.trim();
    try{ await aapi("aud_correccion_add",{ hallazgo_id:hid, quien:quien(), fila:{ fecha:v("#rf-fecha"), num:v("#rf-num"), payee:v("#rf-payee"),
        monto:v("#rf-monto").replace(/[$,]/g,""), de:v("#rf-de"), a:v("#rf-a"), nota:v("#rf-nota") } });
      closeModal(); await recargarCliente(); toast("Fila agregada ✓"); }
    catch(ex){ toast(ex.message,true); }
  });
}
function respuestaDennis(hid){
  const h=A.exp.hallazgos.find(x=>x.id===hid);
  openModal(`${h.ref} · lo que dijo Dennis`,`<p><b>${esc(h.titulo)}</b></p><p class="muted">${esc(h.recomendacion||"")}</p>
    <label>Qué dijo Dennis</label><textarea id="rd-txt" rows="4" placeholder="Ej: el #1913 es de diciembre 2025, cambiar la fecha a 12/31/2025">${esc(h.respuesta_dennis||"")}</textarea>
    <p class="muted ax-small">Queda escrito en el punto. Si cambia adónde va alguna fila, editala con ⋯.</p>
    <div class="modal-actions"><button class="btn ghost" id="rd-cancel">Cancelar</button><button class="btn primary" id="rd-ok">Guardar</button></div>`);
  $("#rd-cancel").addEventListener("click",closeModal);
  $("#rd-ok").addEventListener("click",async ()=>{ const t=$("#rd-txt").value.trim(); if(!t) return toast("Escribí lo que dijo Dennis",true);
    try{ await aapi("aud_hallazgo_save",{ id:hid, patch:{ respuesta_dennis:t } }); closeModal(); await recargarCliente(); toast("Guardado ✓"); }
    catch(ex){ toast(ex.message,true); } });
}
/* ---- Revisión con criterio: la decisión del revisor sobre cada punto ---- */
const REV_BOTONES = [["OK","ok"],["Sacar","sacar"],["Cambiar","cambiar"],["Ya lo sé","yalose"]];
const REV_PIDE = { "Sacar":["Motivo","Por qué sale este punto"], "Cambiar":["Qué hay que cambiar","Qué corregir en este punto"], "Ya lo sé":["Criterio","Queda como propuesta en la Memoria del cliente. Ejemplo: los pagos de piscina van a Repairs."] };
const REV_SALE = (e)=>e==="Sacar"||e==="Ya lo sé";
async function guardarRevision(h,tipo,nota){
  const antes=h.revision_estado, patch={ revision_estado:tipo, revision_nota:nota||null, revision_por:tipo?quien():null, revision_at:tipo?new Date().toISOString():null, revision_memoria_id:null };
  const mem=(A.exp.memoria||[]).find(m=>m.id===h.revision_memoria_id);
  if(mem&&mem.estado==="Propuesta") await aapi("aud_memoria_del",{ id:mem.id });
  else if(mem) patch.revision_memoria_id=tipo==="Ya lo sé"?mem.id:null;
  if(tipo==="Ya lo sé"&&!patch.revision_memoria_id){
    const d=await aapi("aud_memoria_save",{ cliente_id:A.cid, patch:{ tema:"Criterio", contenido:nota, estado:"Propuesta", origen:quien(), control:h.codigo||null } });
    patch.revision_memoria_id=d.memoria.id;
  }
  if(REV_SALE(tipo)&&HALL_ABIERTO(h)) patch.estado="Descartado";
  else if(!REV_SALE(tipo)&&REV_SALE(antes)&&h.estado==="Descartado") patch.estado="Abierto";
  await aapi("aud_hallazgo_save",{ id:h.id, patch, quien:quien() });
  await recargarCliente();
}
function revisarPunto(hid,tipo){
  if(!pedirQuien()) return;
  const h=A.exp.hallazgos.find(x=>x.id===hid);
  const fallo=(ex)=>toast(ex.message,true);
  if(h.revision_estado===tipo) return guardarRevision(h,null,null).then(()=>toast("Decisión deshecha")).catch(fallo);
  if(tipo==="OK") return guardarRevision(h,"OK",null).catch(fallo);
  const [etq,ayuda]=REV_PIDE[tipo];
  openModal(`${h.ref} · ${tipo}`,`<p><b>${esc(h.titulo)}</b></p><label>${etq}</label><textarea id="rp-txt" rows="3" placeholder="${esc(ayuda)}"></textarea>
    <div class="modal-actions"><button class="btn ghost" id="rp-cancel">Cancelar</button><button class="btn primary" id="rp-ok">Guardar</button></div>`);
  $("#rp-cancel").addEventListener("click",closeModal);
  $("#rp-ok").addEventListener("click",async ()=>{ const v=$("#rp-txt").value.trim(); if(!v) return toast(`Escribí: ${etq.toLowerCase()}`,true);
    try{ await guardarRevision(h,tipo,v); closeModal(); toast(tipo==="Ya lo sé"?"Punto descartado y criterio propuesto en Memoria ✓":"Decisión guardada ✓"); }catch(ex){ fallo(ex); } });
  setTimeout(()=>$("#rp-txt")?.focus(),50);
}
function pedirAlCliente(hid){
  const h=A.exp.hallazgos.find(x=>x.id===hid), ya=pideCliente(h);
  openModal(`${h.ref} · pedir al cliente`,`<p><b>${esc(h.titulo)}</b></p>
    <p class="muted">Se suma al mail al cliente con sus filas. El punto sigue como está en la Revisión.</p>
    <label>Qué se le pide (en inglés)</label><textarea id="pc-txt" rows="3" placeholder="Please let us know what these payments are for.">${esc(h.mail_texto||"")}</textarea>
    <div class="modal-actions">${ya?'<button class="btn ghost" id="pc-del">Quitar del mail</button>':""}<button class="btn ghost" id="pc-cancel">Cancelar</button><button class="btn primary" id="pc-ok">Guardar</button></div>`);
  const guardar=async (v)=>{ try{ await aapi("aud_hallazgo_save",{ id:hid, patch:{ mail_texto:v } }); closeModal(); await recargarCliente(); toast(v?"Agregado al mail al cliente ✓":"Quitado del mail al cliente"); }catch(ex){ toast(ex.message,true); } };
  $("#pc-cancel").addEventListener("click",closeModal);
  $("#pc-del")?.addEventListener("click",()=>guardar(null));
  $("#pc-ok").addEventListener("click",()=>{ const v=$("#pc-txt").value.trim(); if(!v) return toast("Escribí qué se le pide al cliente",true); guardar(v); });
  setTimeout(()=>$("#pc-txt")?.focus(),50);
}
function editarPunto(hid){
  const h=A.exp.hallazgos.find(x=>x.id===hid);
  openModal(`${h.ref} · ${h.titulo}`,`
    <label>Qué es este punto</label><select id="hp-dest"><option value="">Corregir</option>${DESTINOS.filter(d=>d!=="AJUSTE").map(d=>`<option value="${d}" ${d===h.destino?"selected":""}>${esc(MARCA[d]?.[0]||(d==="CONTROL"?"Control":d))}</option>`).join("")}</select>
    <label>Estado</label><select id="hp-est">${HALL_ESTADOS.map(e=>`<option ${e===h.estado?"selected":""}>${e}</option>`).join("")}</select>
    <div class="modal-actions"><button class="btn ghost" id="hp-cancel">Cancelar</button><button class="btn primary" id="hp-ok">Guardar</button></div>`);
  $("#hp-cancel").addEventListener("click",closeModal);
  $("#hp-ok").addEventListener("click",async ()=>{ const patch={ destino:$("#hp-dest").value||"AJUSTE" }; const est=$("#hp-est").value; if(est!==h.estado) patch.estado=est;
    if(h.destino==="CLIENTE"&&patch.destino!=="CLIENTE") patch.mail_texto=null;
    try{ await aapi("aud_hallazgo_save",{ id:hid, patch, quien:quien() }); closeModal(); await recargarCliente(); toast("Punto actualizado ✓"); }catch(ex){ toast(ex.message,true); } });
}
function bindRevision(root, run){
  $("#rv-quien",root).addEventListener("change",e=>{ try{ localStorage.setItem("qb_aud_quien",e.target.value.trim()); }catch(_){} renderExp(); });
  $$("[data-rf]",root).forEach(b=>b.addEventListener("click",()=>{ A.rfil=b.dataset.rf; renderExp(); }));
  $$("[data-rvis]",root).forEach(b=>b.addEventListener("click",()=>{ A.rvis=b.dataset.rvis; renderExp(); }));
  $("#rv-modo",root)?.addEventListener("click",()=>{ A.rmodo=!A.rmodo; renderExp(); });
  $$("[data-rev]",root).forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); revisarPunto(+b.dataset.rev,b.dataset.rtipo); }));
  const plegar=(h,abrir)=>{ const id=+h.dataset.rab; abrir?A.rab.add(id):A.rab.delete(id); h.parentElement.classList.toggle("abierto",abrir); h.setAttribute("aria-expanded",abrir); };
  $$("[data-rab]",root).forEach(h=>{ h.addEventListener("click",()=>plegar(h,!A.rab.has(+h.dataset.rab)));
    h.addEventListener("keydown",e=>{ if(e.target===h&&(e.key==="Enter"||e.key===" ")){ e.preventDefault(); plegar(h,!A.rab.has(+h.dataset.rab)); } }); });
  $$("[data-rtodos]",root).forEach(b=>b.addEventListener("click",()=>$$("[data-rab]",root).forEach(h=>plegar(h,b.dataset.rtodos==="1"))));
  $$(".rv-chk",root).forEach(c=>c.addEventListener("change",()=>{
    if(!pedirQuien()){ c.checked=!c.checked; return; }
    guardarFila(+c.dataset.fid,{ estado:c.checked?"Corregido":"Pendiente" }); }));
  $$("[data-fmas]",root).forEach(b=>b.addEventListener("click",()=>editarFila(+b.dataset.fmas)));
  $$("[data-ffoto]",root).forEach(b=>b.addEventListener("click",()=>{ if(pedirQuien()) fotoFila(+b.dataset.ffoto); }));
  $$("[data-hedit]",root).forEach(b=>b.addEventListener("click",()=>editarPunto(+b.dataset.hedit)));
  $$("[data-hcli]",root).forEach(b=>b.addEventListener("click",()=>pedirAlCliente(+b.dataset.hcli)));
  $$("[data-falta]",root).forEach(b=>b.addEventListener("click",()=>elegirFalta(+b.dataset.falta,b.dataset.fval)));
  $$("[data-fadd]",root).forEach(b=>b.addEventListener("click",()=>agregarFila(+b.dataset.fadd)));
  $$("[data-dennis]",root).forEach(b=>b.addEventListener("click",()=>respuestaDennis(+b.dataset.dennis)));
  $$("[data-hok]",root).forEach(b=>b.addEventListener("click",async ()=>{ if(!pedirQuien()) return;
    try{ await aapi("aud_hallazgo_save",{ id:+b.dataset.hok, patch:{ estado:"Resuelto" }, quien:quien() }); await recargarCliente(); toast("Punto resuelto ✔"); }catch(ex){ toast(ex.message,true); } }));
  $$("[data-hreab]",root).forEach(b=>b.addEventListener("click",async ()=>{
    try{ await aapi("aud_hallazgo_save",{ id:+b.dataset.hreab, patch:{ estado:"Abierto" }, quien:quien() }); await recargarCliente(); toast("Punto reabierto"); }catch(ex){ toast(ex.message,true); } }));
}

/* ---- Auditoría: la documentación y el reporte para Dennis ---- */
function tabAuditorias(root){
  const E=A.exp, r=runSel();
  if(!r){ root.innerHTML=`<div class="ax-bar"><span class="muted">Se cargan solas cuando el skill termina una revisión.</span><button class="btn ghost" id="ax-nueva">+ Nueva auditoría</button></div><div class="empty">Todavía no hay auditorías de este cliente.</div>`;
    $("#ax-nueva").addEventListener("click",()=>editarRun(null)); return; }
  const arch=E.archivos.filter(a=>a.run_id===r.id), ins=arch.filter(a=>a.rol==="input"), outs=arch.filter(a=>a.rol==="output");
  const cs=(E.controles||[]).filter(c=>c.run_id===r.id), malos=cs.filter(c=>c.estado==="DIFERENCIA").length;
  const hs=puntosDe(r.id), met=Object.entries(r.metricas||{});
  root.innerHTML=`
    <div class="ax-run-acts ax-aud-top">
      <span>${semDot(r.semaforo)} <b>${esc(r.tipo||"Integral")}</b> <span class="muted">· ${esc(r.auditor||"")}</span></span>
      <label class="ax-inl">Estado <select data-run-estado="${r.id}">${RUN_ESTADOS.map(e=>`<option ${e===r.estado?"selected":""}>${e}</option>`).join("")}</select></label>
      <span class="ax-aud-acts"><button class="btn ghost sm" data-run-edit="${r.id}">Editar</button><button class="btn ghost sm" id="ax-nueva">+ Nueva</button><button class="btn ghost sm ax-danger" data-run-del="${r.id}">Eliminar</button></span>
    </div>
    ${r.resumen?`<div class="rr-note">${esc(r.resumen)}</div>`:""}
    <div class="ax-cols">
      <div>${hs.length?respuestaCard(r,hs):`<div class="chart-card wide"><h3>📨 Reporte para Dennis ${r.reporte_dennis?`<button class="btn ghost sm ax-copy" data-copy="reporte_dennis" data-run="${r.id}">Copiar</button>`:""}</h3>
          ${r.reporte_dennis?`<pre class="ax-rep">${esc(r.reporte_dennis)}</pre>`:'<p class="muted">Todavía no se armó el reporte para Dennis.</p>'}</div>`}</div>
      <div class="chart-card"><h3>Documentación</h3>
        ${archivosLista("📥 Entrada (lo que se revisó)",ins)}
        ${archivosLista("📤 Salida (reportes y mails)",outs)}
        <div class="ax-up">
          <select data-up-rol="${r.id}"><option value="input">Entrada</option><option value="output">Salida</option></select>
          <select data-up-tipo="${r.id}">${AUD_TIPOS_IN.map(t=>`<option>${t}</option>`).join("")}</select>
          <label class="btn ghost sm ax-file">📎 Subir archivo<input type="file" data-up-file="${r.id}" hidden></label>
        </div>
      </div>
    </div>
    ${r.conclusiones||met.length||(hs.length&&r.reporte_dennis)?`<details class="chart-card wide ax-mas" ${A.detMas?"open":""} data-det="detMas"><summary><b>Conclusiones y cifras</b></summary>
      ${r.conclusiones?`<div class="ax-concl">${esc(r.conclusiones)}</div>`:""}
      ${met.length?`<div class="ax-met">${met.map(([k,v])=>`<div><span>${esc(k)}</span><b>${metricaVal(v)}</b></div>`).join("")}</div>`:""}
      ${hs.length&&r.reporte_dennis?`<h3 style="margin-top:14px">Reporte original <button class="btn ghost sm ax-copy" data-copy="reporte_dennis" data-run="${r.id}">Copiar</button></h3><pre class="ax-rep">${esc(r.reporte_dennis)}</pre>`:""}
    </details>`:""}
    ${cs.length?`<details class="chart-card wide ax-mas" ${A.detCtrl?"open":""} data-det="detCtrl"><summary><b>Controles</b> <span class="muted">· ${cs.length}${malos?` · ${malos} con diferencia`:""}</span></summary>${controlesCard(cs)}</details>`:""}`;
  $("#ax-nueva",root).addEventListener("click",()=>editarRun(null));
  $$("[data-det]",root).forEach(d=>d.addEventListener("toggle",()=>{ A[d.dataset.det]=d.open; }));
  bindRun(root);
  $$("[data-go]",root).forEach(a=>a.addEventListener("click",e=>{ e.preventDefault(); const h=A.exp.hallazgos.find(x=>x.id===+a.dataset.go); A.rfil="todo"; A.tab="revision"; if(h){ A.rvis=vistaDe(h); A.rab.add(h.id); } renderExp(); $("#rv-h"+a.dataset.go)?.scrollIntoView({behavior:"smooth",block:"start"}); }));
  $("#rv-copy",root)?.addEventListener("click",async ()=>{
    try{ await navigator.clipboard.writeText($("#rv-texto").textContent); toast("Respuesta copiada ✓ — pegala en el mail a Dennis"); }catch(ex){ toast("No se pudo copiar",true); } });
}
const slugEst = (e)=>String(e||"").replace(/\s+/g,"-");

/* ---- Controles del catálogo (todos; el auditor los puede corregir) ---- */
function controlesCard(cs){
  if(!cs.length) return `<div class="chart-card wide"><h3>Controles</h3><p class="muted">Esta auditoría no tiene controles cargados. Los carga el skill al terminar la revisión.</p></div>`;
  const cnt={}; cs.forEach(c=>cnt[c.estado]=(cnt[c.estado]||0)+1);
  const dennis=cs.filter(c=>c.paso_dennis);
  const vis = A.cfil==="dennis" ? dennis : A.cfil==="problemas" ? cs.filter(c=>c.estado!=="OK"&&c.estado!=="N/A") : cs;
  const mods=[...new Set(vis.map(c=>(c.codigo||"?")[0]))].sort();
  const seg=[["todos",`Todos (${cs.length})`],["dennis",`Pasos de Dennis (${dennis.length})`],["problemas",`Con diferencia o sin dato (${cs.length-(cnt.OK||0)-(cnt["N/A"]||0)})`]];
  return `<div class="chart-card wide"><h3>Controles <span class="muted">· todos los del catálogo; cambiá el estado o el detalle si encontrás un error</span></h3>
    <div class="ax-cchips">${CTRL_ESTADOS.filter(e=>cnt[e]).map(e=>`<span class="ax-ce ax-ce-${slugEst(e)}">${esc(e)} · ${cnt[e]}</span>`).join("")}</div>
    <div class="ax-seg ax-cseg">${seg.map(s=>`<button class="tab ${A.cfil===s[0]?"active":""}" data-cf="${s[0]}">${s[1]}</button>`).join("")}</div>
    ${vis.length?`<div class="ax-scroll"><table class="ip-table ax-ctrl"><thead><tr><th>Código</th><th class="l">Control</th><th>Paso Dennis</th><th>Resultado</th><th class="l">Detalle</th><th></th></tr></thead><tbody>
      ${mods.map(m=>`<tr class="ax-mod"><td colspan="6">${esc(MODULOS[m]||m)}</td></tr>`+vis.filter(c=>(c.codigo||"?")[0]===m).map(c=>`<tr>
        <td data-label="Código"><b>${esc(c.codigo)}</b></td>
        <td class="l" data-label="Control">${esc(c.control)}${c.criterio?`<div class="muted ax-small">${esc(c.criterio)}</div>`:""}</td>
        <td data-label="Paso Dennis">${c.paso_dennis?`<span class="ax-paso">${esc(c.paso_dennis)}</span>`:'<span class="muted">—</span>'}</td>
        <td data-label="Resultado"><select class="ax-cest ax-ce-${slugEst(c.estado)}" data-cid="${c.id}">${CTRL_ESTADOS.map(e=>`<option ${e===c.estado?"selected":""}>${e}</option>`).join("")}</select>
          ${c.editado?`<div class="ax-small ax-edit" title="Lo cambió el auditor a mano">✎ editado</div>`:""}</td>
        <td class="l" data-label="Detalle">${c.detalle?esc(c.detalle):'<span class="muted">—</span>'}${c.fuente?`<div class="muted ax-small">Fuente: ${esc(c.fuente)}</div>`:""}</td>
        <td><button class="btn ghost sm" data-cedit="${c.id}" title="Editar resultado y detalle">✎</button></td></tr>`).join("")).join("")}
    </tbody></table></div>`:`<p class="muted">Ningún control en este filtro.</p>`}</div>`;
}
function editarControl(id){
  const c=A.exp.controles.find(x=>x.id===id);
  openModal(`${c.codigo} · ${c.control}`,`
    ${c.criterio?`<p class="muted">${esc(c.criterio)}</p>`:""}
    <label>Resultado</label><select id="xc-est">${CTRL_ESTADOS.map(e=>`<option ${e===c.estado?"selected":""}>${e}</option>`).join("")}</select>
    <label>Detalle</label><textarea id="xc-det" rows="5">${esc(c.detalle||"")}</textarea>
    <label>Fuente (con qué se verificó)</label><input id="xc-fue" value="${esc(c.fuente||"")}">
    <div class="modal-actions"><button class="btn ghost" id="xc-cancel">Cancelar</button><button class="btn primary" id="xc-save">Guardar</button></div>`);
  $("#xc-cancel").addEventListener("click",closeModal);
  $("#xc-save").addEventListener("click",async ()=>{
    try{ await aapi("aud_control_save",{ id, patch:{ estado:$("#xc-est").value, detalle:$("#xc-det").value.trim()||null, fuente:$("#xc-fue").value.trim()||null } });
      closeModal(); await recargarCliente(); toast("Control actualizado ✓"); }
    catch(ex){ toast(ex.message,true); }
  });
}
function archivosLista(tit, list){
  return `<div class="ax-arch-tit">${tit}</div>`+(list.length?`<ul class="ax-arch">${list.map(a=>`<li>
      <span class="ax-tipo">${esc(a.tipo)}</span><span class="ax-nom" title="${esc(a.nombre)}">${esc(a.nombre)}</span>
      <span class="muted">${pesoTxt(a.bytes)}</span>
      <button class="btn ghost sm" data-dl="${a.id}" title="Descargar">⬇</button>
      <button class="btn ghost sm ax-danger" data-arch-del="${a.id}" title="Quitar archivo">✕</button></li>`).join("")}</ul>`
    :`<p class="muted ax-vacio">Nada cargado.</p>`);
}
function bindRun(root){
  $$("[data-run-edit]",root).forEach(b=>b.addEventListener("click",()=>editarRun(+b.dataset.runEdit)));
  $$("[data-run-estado]",root).forEach(s=>s.addEventListener("change",()=>guardarRun(+s.dataset.runEstado,{ estado:s.value })));
  $$("[data-run-del]",root).forEach(b=>b.addEventListener("click",()=>borrarRun(+b.dataset.runDel)));
  $$("[data-dl]",root).forEach(b=>b.addEventListener("click",()=>descargar(+b.dataset.dl)));
  $$("[data-arch-del]",root).forEach(b=>b.addEventListener("click",()=>borrarArchivo(+b.dataset.archDel)));
  $$("[data-up-rol]",root).forEach(s=>s.addEventListener("change",()=>{
    $(`[data-up-tipo="${s.dataset.upRol}"]`,root).innerHTML=(s.value==="input"?AUD_TIPOS_IN:AUD_TIPOS_OUT).map(t=>`<option>${t}</option>`).join(""); }));
  $$("[data-copy]",root).forEach(b=>b.addEventListener("click",async (e)=>{ e.stopPropagation();
    const r=A.exp.runs.find(x=>x.id===+b.dataset.run);
    try{ await navigator.clipboard.writeText(r[b.dataset.copy]||""); toast("Copiado ✓"); }catch(ex){ toast("No se pudo copiar",true); } }));
  $$("[data-cf]",root).forEach(b=>b.addEventListener("click",()=>{ A.cfil=b.dataset.cf; A.detCtrl=true; renderExp(); }));
  $$(".ax-cest",root).forEach(s=>s.addEventListener("change",async ()=>{
    try{ await aapi("aud_control_save",{ id:+s.dataset.cid, patch:{ estado:s.value } }); await recargarCliente(); toast("Control actualizado ✓"); }
    catch(ex){ toast(ex.message,true); } }));
  $$("[data-cedit]",root).forEach(b=>b.addEventListener("click",()=>editarControl(+b.dataset.cedit)));
  $$("[data-up-file]",root).forEach(inp=>inp.addEventListener("change",()=>{ const id=+inp.dataset.upFile;
    subirArchivo(id, inp.files[0], $(`[data-up-rol="${id}"]`,root).value, $(`[data-up-tipo="${id}"]`,root).value); }));
}
function editarRun(id){
  const r = id ? A.exp.runs.find(x=>x.id===id) : { fecha:todayStr(), estado:"En curso", tipo:"Integral" };
  openModal(id?"Editar auditoría":"Nueva auditoría",`
    <div class="row2"><div><label>Tipo</label><select id="xr-tipo">${RUN_TIPOS.map(t=>`<option ${t===(r.tipo||"Integral")?"selected":""}>${t}</option>`).join("")}</select></div>
      <div><label>Estado</label><select id="xr-est">${RUN_ESTADOS.map(e=>`<option ${e===r.estado?"selected":""}>${e}</option>`).join("")}</select></div></div>
    <div class="row2"><div><label>Período desde</label><input type="date" id="xr-desde" value="${esc(r.periodo_desde||"")}"></div>
      <div><label>Período hasta</label><input type="date" id="xr-hasta" value="${esc(r.periodo_hasta||"")}"></div></div>
    <div class="row2"><div><label>Fecha de la auditoría</label><input type="date" id="xr-fecha" value="${esc(r.fecha||todayStr())}"></div>
      <div><label>Semáforo</label><select id="xr-sem"><option value="">—</option>${Object.keys(SEMAFORO).map(k=>`<option value="${k}" ${r.semaforo===k?"selected":""}>${k} · ${SEMAFORO[k][1]}</option>`).join("")}</select></div></div>
    <label>Resumen (2–3 líneas)</label><textarea id="xr-res" rows="2">${esc(r.resumen||"")}</textarea>
    <label>Reporte para Dennis (resumido)</label><textarea id="xr-rep" rows="8">${esc(r.reporte_dennis||"")}</textarea>
    <label>Conclusiones internas</label><textarea id="xr-con" rows="5">${esc(r.conclusiones||"")}</textarea>
    <label>Mail al cliente (inglés)</label><textarea id="xr-mail" rows="5">${esc(r.mail_cliente||"")}</textarea>
    <div class="modal-actions"><button class="btn ghost" id="xr-cancel">Cancelar</button><button class="btn primary" id="xr-save">Guardar</button></div>`);
  $("#xr-cancel").addEventListener("click",closeModal);
  $("#xr-save").addEventListener("click",async ()=>{
    const patch={ tipo:$("#xr-tipo").value, estado:$("#xr-est").value,
      periodo_desde:$("#xr-desde").value||null, periodo_hasta:$("#xr-hasta").value||null, fecha:$("#xr-fecha").value||todayStr(),
      semaforo:$("#xr-sem").value||null, resumen:$("#xr-res").value.trim()||null, conclusiones:$("#xr-con").value.trim()||null,
      reporte_dennis:$("#xr-rep").value.trim()||null, mail_cliente:$("#xr-mail").value.trim()||null };
    if(id) return guardarRun(id,patch,true);
    try{ const d=await aapi("aud_run_save",{ run:{ ...patch, cliente_id:A.cid } }); closeModal(); A.rrun=d.run.id; A.tab="auditorias"; await recargarCliente(); toast("Auditoría creada ✓"); }
    catch(ex){ toast(ex.message,true); }
  });
}
async function guardarRun(id, patch, modal=false){
  try{ await aapi("aud_run_save",{ id, run:patch }); if(modal) closeModal(); await recargarCliente(); toast("Guardado ✓"); }
  catch(ex){ toast(ex.message,true); }
}
function borrarRun(id){
  const r=A.exp.runs.find(x=>x.id===id); const n=A.exp.archivos.filter(a=>a.run_id===id).length;
  openModal("Eliminar auditoría",`<p>Se borra la auditoría del <b>${fechaCorta(r.fecha)}</b> con sus puntos${n?` y sus <b>${n} archivo${n===1?"":"s"}</b>`:""}. No se puede deshacer.</p>
    <div class="modal-actions"><button class="btn ghost" id="xd-cancel">Cancelar</button><button class="btn primary ax-danger-bg" id="xd-ok">Eliminar</button></div>`);
  $("#xd-cancel").addEventListener("click",closeModal);
  $("#xd-ok").addEventListener("click",async ()=>{
    try{ await aapi("aud_run_del",{ id }); closeModal(); if(A.rrun===id) A.rrun=null; await recargarCliente(); toast("Auditoría eliminada"); }
    catch(ex){ toast(ex.message,true); }
  });
}
async function subirArchivo(runId, file, rol, tipo){
  if(!file) return;
  if(file.size>50*1048576) return toast("El archivo pasa los 50 MB",true);
  toast("Subiendo "+file.name+"…");
  try{
    const u=await aapi("aud_upload_url",{ run_id:runId, rol, nombre:file.name });
    const res=await fetch(u.url,{ method:"PUT", headers:{ "Content-Type":file.type||"application/octet-stream", "x-upsert":"false" }, body:file });
    if(!res.ok) throw new Error("No se pudo subir ("+res.status+")");
    await aapi("aud_archivo_add",{ run_id:runId, rol, tipo, nombre:file.name, path:u.path, bytes:file.size, mime:file.type||null });
    await recargarCliente(); toast("Archivo subido ✓");
  }catch(ex){ toast(ex.message,true); }
}
async function descargar(id){
  try{ const d=await aapi("aud_download_url",{ id }); const a=document.createElement("a"); a.href=d.url; a.rel="noopener"; document.body.appendChild(a); a.click(); a.remove(); }
  catch(ex){ toast(ex.message,true); }
}
async function borrarArchivo(id){
  const a=A.exp.archivos.find(x=>x.id===id);
  if(!confirm(`¿Quitar «${a?a.nombre:"archivo"}» del expediente? Se borra del almacenamiento.`)) return;
  try{ await aapi("aud_archivo_del",{ id }); await recargarCliente(); toast("Archivo quitado"); }
  catch(ex){ toast(ex.message,true); }
}

/* ---- Memoria del cliente ---- */
function tabMemoria(root){
  const M=A.exp.memoria; const prop=M.filter(m=>m.estado==="Propuesta"), vig=M.filter(m=>m.estado==="Vigente"), arch=M.filter(m=>m.estado==="Archivada");
  const temas=[...new Set(vig.map(m=>m.tema))].sort();
  const origen=(m)=>[m.origen,m.control].filter(Boolean).map(esc).join(" · ");
  const item=(m,acts,tema=true)=>`<li class="ax-mem"><div>${tema?`<span class="ax-tema">${esc(m.tema)}</span> `:""}${esc(m.contenido)}${origen(m)?` <span class="muted ax-small">(${origen(m)})</span>`:""}</div><div class="ax-mem-acts">${acts}</div></li>`;
  root.innerHTML=`<div class="rr-note">Datos firmes del cliente que cada auditoría nueva tiene que tener en cuenta (cómo opera, cuentas especiales, criterios acordados). El skill propone; vos aprobás.</div>
    ${prop.length?`<div class="chart-card wide ax-prop"><h3>Propuestas del skill para revisar <span class="muted">· ${prop.length}</span></h3><ul class="ax-mem-list">
      ${prop.map(m=>item(m,`<button class="btn primary sm" data-mem-ok="${m.id}">✓ Aprobar</button><button class="btn ghost sm" data-mem-edit="${m.id}">Editar</button><button class="btn ghost sm" data-mem-arch="${m.id}">Descartar</button>`)).join("")}</ul></div>`:""}
    <div class="chart-card wide"><h3>Memoria vigente <span class="muted">· ${vig.length}</span></h3>
      ${vig.length?temas.map(t=>`<div class="ax-arch-tit">${esc(t)}</div><ul class="ax-mem-list">${vig.filter(m=>m.tema===t).map(m=>item(m,
        `<button class="btn ghost sm" data-mem-edit="${m.id}">Editar</button><button class="btn ghost sm" data-mem-arch="${m.id}">Archivar</button>`,false)).join("")}</ul>`).join("")
        :'<p class="muted">Todavía no hay nada en la memoria de este cliente.</p>'}
      <div class="ax-mem-add"><input id="xm-tema" placeholder="Tema (ej: Payroll, Bancos)" list="xm-temas"><datalist id="xm-temas">${temas.map(t=>`<option value="${esc(t)}">`).join("")}</datalist>
        <input id="xm-cont" placeholder="Dato a recordar (ej: el payroll se procesa por Gusto)"><button class="btn primary" id="xm-add">Agregar</button></div>
    </div>
    ${arch.length?`<details class="ax-archivadas"><summary class="muted">Archivadas (${arch.length})</summary><ul class="ax-mem-list">${arch.map(m=>item(m,
      `<button class="btn ghost sm" data-mem-rest="${m.id}">Restaurar</button><button class="btn ghost sm ax-danger" data-mem-del="${m.id}">Borrar</button>`)).join("")}</ul></details>`:""}`;
  const save=async (id,patch,msg)=>{ try{ await aapi("aud_memoria_save",{ id, patch }); await recargarCliente(); toast(msg); }catch(ex){ toast(ex.message,true); } };
  $$("[data-mem-ok]",root).forEach(b=>b.addEventListener("click",()=>save(+b.dataset.memOk,{estado:"Vigente"},"Agregado a la memoria ✓")));
  $$("[data-mem-arch]",root).forEach(b=>b.addEventListener("click",()=>save(+b.dataset.memArch,{estado:"Archivada"},"Archivado")));
  $$("[data-mem-rest]",root).forEach(b=>b.addEventListener("click",()=>save(+b.dataset.memRest,{estado:"Vigente"},"Restaurado ✓")));
  $$("[data-mem-del]",root).forEach(b=>b.addEventListener("click",async ()=>{ if(!confirm("¿Borrar este dato para siempre?")) return;
    try{ await aapi("aud_memoria_del",{ id:+b.dataset.memDel }); await recargarCliente(); toast("Borrado"); }catch(ex){ toast(ex.message,true); } }));
  $$("[data-mem-edit]",root).forEach(b=>b.addEventListener("click",()=>{ const m=M.find(x=>x.id===+b.dataset.memEdit);
    openModal("Editar dato de memoria",`<label>Tema</label><input id="xe-tema" value="${esc(m.tema)}"><label>Contenido</label><textarea id="xe-cont" rows="4">${esc(m.contenido)}</textarea>
      <div class="modal-actions"><button class="btn ghost" id="xe-cancel">Cancelar</button><button class="btn primary" id="xe-save">Guardar</button></div>`);
    $("#xe-cancel").addEventListener("click",closeModal);
    $("#xe-save").addEventListener("click",async ()=>{ const contenido=$("#xe-cont").value.trim(); if(!contenido) return;
      closeModal(); await save(m.id,{ tema:$("#xe-tema").value.trim()||"General", contenido },"Guardado ✓"); }); }));
  $("#xm-add").addEventListener("click",async ()=>{
    const contenido=$("#xm-cont").value.trim(); if(!contenido) return toast("Escribí el dato a recordar",true);
    try{ await aapi("aud_memoria_save",{ cliente_id:A.cid, patch:{ tema:$("#xm-tema").value.trim()||"General", contenido, estado:"Vigente" } }); await recargarCliente(); toast("Agregado a la memoria ✓"); }
    catch(ex){ toast(ex.message,true); }
  });
}

/* ---- Notas ---- */
function tabNotas(root){
  const N=A.exp.notas;
  root.innerHTML=`<div class="chart-card wide"><h3>Nueva nota</h3>
      <textarea id="xn-txt" rows="3" placeholder="Lo que quieras dejar anotado de este cliente…"></textarea>
      <div class="modal-actions"><button class="btn primary" id="xn-add">Agregar nota</button></div></div>
    ${N.length?`<ul class="ax-notas">${N.map(n=>`<li><div class="ax-nota-h"><b>${fechaCorta(n.fecha)}</b>${n.autor?` <span class="muted">· ${esc(n.autor)}</span>`:""}
      <button class="btn ghost sm ax-danger" data-nota-del="${n.id}" title="Borrar nota">✕</button></div><div class="ax-nota-t">${esc(n.texto)}</div></li>`).join("")}</ul>`
      :'<div class="empty">Sin notas todavía.</div>'}`;
  $("#xn-add").addEventListener("click",async ()=>{
    const texto=$("#xn-txt").value.trim(); if(!texto) return;
    try{ await aapi("aud_nota_add",{ cliente_id:A.cid, texto }); await recargarCliente(); toast("Nota agregada ✓"); }catch(ex){ toast(ex.message,true); }
  });
  $$("[data-nota-del]",root).forEach(b=>b.addEventListener("click",async ()=>{ if(!confirm("¿Borrar esta nota?")) return;
    try{ await aapi("aud_nota_del",{ id:+b.dataset.notaDel }); await recargarCliente(); toast("Nota borrada"); }catch(ex){ toast(ex.message,true); } }));
}

/* ---- entradas desde la solapa Auditorías ---- */
$("#panel").addEventListener("click",(e)=>{
  if(e.target.closest("#audit-exp")){ abrirExpedientes(null); return; }
  const a=e.target.closest(".aud-open");
  if(a){ e.preventDefault(); abrirExpedientes(+a.dataset.cid); }
});
