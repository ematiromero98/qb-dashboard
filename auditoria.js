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
const A = { pin:"", view:"lista", cid:null, tab:"auditorias", q:"", runs:[], abiertos:[], exp:null, open:null, hfil:"Abierto", cfil:"todos", rrun:null, rfil:"todo" };
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
const MARCA = { DEFINIR:["Definir con Dennis","def"], CLIENTE:["Pedir al cliente · va en el mail","cli"], "CIERRE ANUAL":["Al cierre","cie"], DEFINIDO:["Definido por Dennis","ok"] };

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
async function cargarResumen(){ const d=await aapi("aud_resumen"); A.runs=d.runs; A.abiertos=d.abiertos; }
async function verCliente(cid){
  A.cid=cid; A.view="cliente"; A.open=null;
  A.exp=await aapi("aud_cliente",{ cliente_id:cid });
  if(A.exp.runs.length) A.open=A.exp.runs[0].id;
  A.rrun=runsConRevision()[0]?.id ?? null;
  if(A.rrun && A.tab==="auditorias") A.tab="revision";
  renderExp();
}
async function recargarCliente(){ const keep=A.open, y=$("#ax-body")?.scrollTop||0; A.exp=await aapi("aud_cliente",{ cliente_id:A.cid }); A.open=keep; await cargarResumen(); renderExp(); const b=$("#ax-body"); if(b) b.scrollTop=y; }

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

/* ================= LISTA DE CLIENTES ================= */
function renderLista(body){
  const ultima={}, cant={}, abiertos={}, altas={};
  A.runs.forEach(r=>{ cant[r.cliente_id]=(cant[r.cliente_id]||0)+1; if(!ultima[r.cliente_id]) ultima[r.cliente_id]=r; });
  A.abiertos.forEach(h=>{ abiertos[h.cliente_id]=(abiertos[h.cliente_id]||0)+1; });
  const q=A.q.toLowerCase();
  const cli=S.clientes.filter(c=>c.activo!==false && (!q || c.nombre.toLowerCase().includes(q)))
    .sort((a,b)=>(cant[b.id]?1:0)-(cant[a.id]?1:0) || PRIO_RANK[a.prioridad||"Media"]-PRIO_RANK[b.prioridad||"Media"] || a.nombre.localeCompare(b.nombre));
  const anio=String(new Date().getFullYear());
  const nAnio=A.runs.filter(r=>String(r.fecha).startsWith(anio)).length;
  const nCli=Object.keys(cant).length;
  body.innerHTML=`
    <div class="ax-kpis">
      <div class="ax-kpi"><b>${nCli}</b><span>clientes con expediente</span></div>
      <div class="ax-kpi"><b>${nAnio}</b><span>auditorías en ${anio}</span></div>
      <div class="ax-kpi"><b style="color:var(--amber)">${A.abiertos.length}</b><span>hallazgos abiertos</span></div>
    </div>
    <div class="ax-bar"><input id="ax-q" type="search" placeholder="Buscar cliente…" value="${esc(A.q)}">
      <span class="muted">Hacé clic en un cliente para ver su expediente.</span></div>
    <div class="ax-scroll"><table class="audit-table ax-lista"><thead><tr>
      <th>Empresa</th><th>Bookkeeper</th><th>Prioridad</th><th>Frecuencia</th><th>Última auditoría</th><th>Auditorías</th><th>Hallazgos abiertos</th><th>Próxima</th>
    </tr></thead><tbody>${cli.map(c=>{ const u=ultima[c.id]; const p=PRIOS.includes(c.prioridad)?c.prioridad:"Media"; const prox=proxAuditoria(c);
      return `<tr class="ax-row" data-cid="${c.id}">
        <td><b>${esc(c.nombre)}</b></td><td>${esc(c.bookkeeper_default||"—")}</td>
        <td><span class="prio-badge prio-${prioSlug(p)}">${esc(p)}</span></td>
        <td>${esc(c.audit_freq||"—")}</td>
        <td>${u?`${semDot(u.semaforo)} ${fechaCorta(u.fecha)} <span class="muted">· ${esc(u.estado)}</span>`:'<span class="muted">Sin auditorías</span>'}</td>
        <td class="tc">${cant[c.id]||'<span class="muted">0</span>'}</td>
        <td class="tc">${abiertos[c.id]?`<b style="color:var(--amber)">${abiertos[c.id]}</b>`:'<span class="muted">—</span>'}</td>
        <td>${prox?mesLabel(prox):'<span class="muted">—</span>'}</td></tr>`; }).join("")}
    </tbody></table></div>`;
  const qi=$("#ax-q");
  qi.addEventListener("input",()=>{ A.q=qi.value; const pos=qi.selectionStart; renderLista(body); const n=$("#ax-q"); n.focus(); n.setSelectionRange(pos,pos); });
  $$(".ax-row",body).forEach(tr=>tr.addEventListener("click",()=>verCliente(+tr.dataset.cid).catch(ex=>toast(ex.message,true))));
}

/* ================= EXPEDIENTE DE UN CLIENTE ================= */
function renderCliente(body){
  const c=cliDe(A.cid), E=A.exp; const p=PRIOS.includes(c.prioridad)?c.prioridad:"Media";
  const abiertos=E.hallazgos.filter(HALL_ABIERTO);
  const propuestas=E.memoria.filter(m=>m.estado==="Propuesta");
  const vigentes=E.memoria.filter(m=>m.estado==="Vigente");
  const u=E.runs[0]; const prox=proxAuditoria(c);
  const pend=(E.correcciones||[]).filter(f=>f.estado==="Pendiente"&&(E.hallazgos.find(h=>h.id===f.hallazgo_id)||{}).run_id===A.rrun).length;
  const tabs=[["revision",`Revisión ${pend?`<span class="cnt" title="Filas pendientes de corregir">${pend}</span>`:""}`],
    ["auditorias",`Auditorías <span class="cnt">${E.runs.length}</span>`],
    ["hallazgos",`Hallazgos ${abiertos.length?`<span class="cnt">${abiertos.length}</span>`:""}`],
    ["memoria",`Memoria ${propuestas.length?`<span class="cnt ax-cnt-prop" title="Propuestas para revisar">${propuestas.length}</span>`:""}`],
    ["notas",`Notas ${E.notas.length?`<span class="cnt">${E.notas.length}</span>`:""}`]];
  body.innerHTML=`
    <div class="ax-head">
      <div class="ax-head-l">
        <div class="ax-cli">${esc(c.nombre)}</div>
        <div class="rr-meta"><span class="prio-badge prio-${prioSlug(p)}">${esc(p)}</span>
          <span class="rr-badge">${esc(c.bookkeeper_default||"Sin bookkeeper")}</span>
          <span class="rr-badge">Auditoría ${esc(c.audit_freq||"sin frecuencia")}</span>
          ${prox?`<span class="rr-badge">Próxima: ${mesLabel(prox)}</span>`:""}</div>
      </div>
      <div class="ax-kpis sm">
        <div class="ax-kpi"><b>${u?`${semDot(u.semaforo)} ${fechaCorta(u.fecha)}`:"—"}</b><span>última auditoría</span></div>
        <div class="ax-kpi"><b style="color:var(--amber)">${abiertos.length}</b><span>hallazgos abiertos</span></div>
        <div class="ax-kpi"><b>${vigentes.length}</b><span>datos en memoria</span></div>
      </div>
    </div>
    <div class="ax-tabs">${tabs.map(t=>`<button class="rr-tab ${A.tab===t[0]?"active":""}" data-t="${t[0]}">${t[1]}</button>`).join("")}</div>
    <div id="ax-tab"></div>`;
  $$(".ax-tabs .rr-tab",body).forEach(b=>b.addEventListener("click",()=>{ A.tab=b.dataset.t; renderExp(); }));
  const t=$("#ax-tab",body);
  if(A.tab==="revision") tabRevision(t);
  else if(A.tab==="auditorias") tabAuditorias(t);
  else if(A.tab==="hallazgos") tabHallazgos(t);
  else if(A.tab==="memoria") tabMemoria(t);
  else tabNotas(t);
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
const bloqueado = (h)=>h.destino==="DEFINIR";
function periodoRev(r){ const m=String(r.reporte_dennis||"").split("\n")[0].match(/Revisi[oó]n (.+)$/); return m?m[1].trim():periodoTxt(r); }

function tabRevision(root){
  const runs=runsConRevision();
  if(!runs.length){ root.innerHTML=`<div class="empty">Esta auditoría todavía no tiene la Revisión cargada (los puntos a corregir con sus filas). La carga el skill al guardar la auditoría.</div>`; return; }
  if(!runs.some(r=>r.id===A.rrun)) A.rrun=runs[0].id;
  const run=runs.find(r=>r.id===A.rrun);
  const hs=A.exp.hallazgos.filter(h=>h.run_id===run.id&&h.ref).sort((a,b)=>(a.orden??999)-(b.orden??999)||a.id-b.id);
  const filas=hs.flatMap(h=>filasDe(h.id));
  const nOk=filas.filter(hecha).length, pctF=filas.length?Math.round(nOk*100/filas.length):0;
  const resueltos=hs.filter(h=>h.estado==="Resuelto"||h.estado==="Descartado").length;
  const vis=(h)=>A.rfil==="todo"||(A.rfil==="pend"?HALL_ABIERTO(h):!HALL_ABIERTO(h));
  root.innerHTML=`
    <div class="rv-top chart-card wide">
      <div class="rv-top-l">
        ${runs.length>1?`<label class="ax-inl">Auditoría <select id="rv-run">${runs.map(r=>`<option value="${r.id}" ${r.id===run.id?"selected":""}>${fechaCorta(r.fecha)} · ${esc(periodoRev(r))}</option>`).join("")}</select></label>`
          :`<div class="rv-tit">Revisión ${esc(periodoRev(run))} <span class="muted">· auditoría del ${fechaCorta(run.fecha)}</span></div>`}
        <div class="rv-prog"><div class="rv-bar"><i style="width:${pctF}%"></i></div>
          <span><b>${nOk}</b> de ${filas.length} filas · <b>${resueltos}</b> de ${hs.length} puntos resueltos</span></div>
      </div>
      <div class="rv-top-r">
        <label class="ax-inl">Trabajando como <input type="text" id="rv-quien" list="rv-equipo" placeholder="Tu nombre" value="${esc(quien())}"></label>
        <datalist id="rv-equipo">${["Matías Romero","Sebastián Pita","Manuel Criscuoli","Edward","Nicolás","Martín"].map(n=>`<option value="${n}">`).join("")}</datalist>
        <div class="ax-seg">${[["todo","Todo"],["pend","Pendientes"],["ok","Resueltos"]].map(s=>`<button class="tab ${A.rfil===s[0]?"active":""}" data-rf="${s[0]}">${s[1]}</button>`).join("")}</div>
      </div>
    </div>
    <div class="rr-note">Tildá cada fila cuando la corrijas en QuickBooks. Si la hiciste distinto o no corresponde, usá <b>⋯</b> y dejá la nota. Lo marcado <b>Definir con Dennis</b> se habilita cuando cargás su respuesta.</div>
    ${PASO_ORDEN.map(k=>{ const g=hs.filter(h=>(h.paso||"otros")===k&&vis(h)); if(!g.length) return "";
      return `<div class="rv-paso"><div class="rv-paso-tit">${k==="otros"?"Otros controles":`Paso ${esc(k)} · ${esc(PASOS_DENNIS[k]||"")}`}</div>${g.map(puntoCard).join("")}</div>`; }).join("")
      || `<div class="empty">Nada en este filtro.</div>`}
    ${respuestaCard(run, hs)}`;
  bindRevision(root, run);
}

function puntoCard(h){
  const fs=filasDe(h.id), ok=fs.filter(hecha).length, lock=bloqueado(h);
  const marca=MARCA[h.destino];
  const est = h.estado==="Resuelto" ? `<span class="rv-est ok">✔ Resuelto${h.resuelto_fecha?` · ${fechaCorta(h.resuelto_fecha)}`:""}</span>`
    : h.estado==="Descartado" ? `<span class="rv-est off">Descartado</span>`
    : fs.length ? `<span class="rv-est">${ok} de ${fs.length}</span>` : `<span class="rv-est">Abierto</span>`;
  return `<div class="rv-punto ${HALL_ABIERTO(h)?"":"cerrado"}" id="rv-h${h.id}">
    <div class="rv-head"><span class="rv-ref">${esc(h.ref)}</span>
      <div class="rv-h-tit"><b>${esc(h.titulo)}</b>${h.monto!=null&&!String(h.titulo).includes("$")?` <span class="muted">— ${money2(h.monto)}</span>`:""}
        ${marca?` <span class="rv-marca ${marca[1]}">${marca[0]}</span>`:""}</div>${est}</div>
    <div class="rv-txt"><div><b>Qué pasa:</b> ${esc(h.detalle||"—")}</div><div><b>Qué hacer:</b> ${esc(h.recomendacion||"—")}</div>
      ${h.respuesta_dennis?`<div class="rv-dennis"><b>Dennis:</b> ${esc(h.respuesta_dennis)}</div>`:""}</div>
    ${lock?`<div class="rv-lock">⏸ Espera la definición de Dennis: no se toca hasta su respuesta. <button class="btn primary sm" data-dennis="${h.id}">Cargar respuesta de Dennis</button></div>`:""}
    ${fs.length?`<div class="ax-scroll"><table class="ip-table rv-tabla"><thead><tr><th>✓</th><th>Fecha</th><th>Num</th><th class="l">Payee</th><th class="r">Monto</th><th class="l">Está en</th><th class="l">Pasar a / qué hacer</th><th class="l">Estado</th><th></th></tr></thead><tbody>
      ${fs.map(f=>`<tr class="${hecha(f)?"rv-ok":""} ${f.estado==="Ya no aparece"?"rv-ya":""}">
        <td data-label="✓">${f.estado==="Pendiente"||f.estado==="Corregido"
          ?`<input type="checkbox" class="rv-chk" data-fid="${f.id}" ${f.estado==="Corregido"?"checked":""} ${lock?"disabled":""} title="${lock?"Espera a Dennis":"Corregido"}">`
          :`<span class="rv-ico" title="${esc(f.estado)}">${CORR_ICONO[f.estado]}</span>`}</td>
        <td data-label="Fecha">${esc(f.fecha||"")}</td><td data-label="Num">${esc(f.num||"")}</td>
        <td class="l" data-label="Payee">${esc(f.payee||"")}${f.nueva?` <span class="rv-nueva" title="Apareció al volver a correr la auditoría">nueva</span>`:""}${f.origen==="Manual"?` <span class="rv-nueva man">a mano</span>`:""}</td>
        <td class="r" data-label="Monto">${money2(f.monto)}</td>
        <td class="l" data-label="Está en">${esc(f.de||"")}</td>
        <td class="l" data-label="Pasar a">${esc(f.a||"")}${f.a_editado&&f.origen!=="Manual"?` <span class="muted" title="Cambiado a mano">✎</span>`:""}</td>
        <td class="l rv-quien" data-label="Estado">${f.estado==="Pendiente"?'<span class="muted">Pendiente</span>'
          :`${esc(f.estado)}${f.hecho_por?` · ${esc(f.hecho_por)}`:""}${f.hecho_at?` · ${fechaCorta(String(f.hecho_at).slice(0,10))}`:""}${f.nota?`<div class="rv-nota">${esc(f.nota)}</div>`:""}`}</td>
        <td><button class="btn ghost sm" data-fmas="${f.id}" title="Hecho distinto, no corresponde, cambiar destino">⋯</button></td></tr>`).join("")}
    </tbody></table></div>`:""}
    <div class="rv-acts">
      ${!lock?`<button class="btn ghost sm" data-fadd="${h.id}">+ Agregar fila</button>`:""}
      ${!fs.length&&!lock?(HALL_ABIERTO(h)?`<button class="btn primary sm" data-hok="${h.id}">✔ Marcar resuelto</button>`:`<button class="btn ghost sm" data-hreab="${h.id}">Reabrir</button>`):""}
    </div></div>`;
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
  const def=hs.filter(h=>h.destino==="DEFINIR"); if(def.length) L.push("","Para definir con vos",...def.map(h=>`• ${h.ref} ${h.titulo}: ${h.recomendacion||""}`));
  const yaDef=hs.filter(h=>h.respuesta_dennis); if(yaDef.length) L.push("","Lo que definiste (aplicado)",...yaDef.map(h=>`• ${h.ref} ${h.titulo}: ${h.respuesta_dennis}`));
  const cl=hs.filter(h=>h.destino==="CLIENTE"&&HALL_ABIERTO(h)); if(cl.length) L.push("","Pendiente del cliente",...cl.map(h=>`• ${h.ref} ${h.titulo}`));
  L.push("","Saludos,",quien()||"");
  return L.join("\n");
}
function respuestaCard(run, hs){
  const falta=hs.filter(h=>HALL_ABIERTO(h)&&["AJUSTE","DEFINIDO","CONTROL",null,undefined].includes(h.destino));
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
    <label>Estado</label><div class="rv-radios">${ests.map(e=>`<label><input type="radio" name="rv-e" value="${e}" ${e===f.estado?"checked":""} ${bloqueado(h)&&e!=="Pendiente"?"disabled":""}> ${CORR_ICONO[e]} ${e}</label>`).join("")}</div>
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
  openModal(`${h.ref} · respuesta de Dennis`,`<p><b>${esc(h.titulo)}</b></p><p class="muted">${esc(h.recomendacion||"")}</p>
    <label>Qué definió Dennis</label><textarea id="rd-txt" rows="4" placeholder="Ej: el #1913 es de diciembre 2025, cambiar la fecha a 12/31/2025">${esc(h.respuesta_dennis||"")}</textarea>
    <p class="muted ax-small">Al guardar, el punto pasa a «Definido por Dennis» y se habilitan sus filas. Si cambia el destino de alguna, editala con ⋯.</p>
    <div class="modal-actions"><button class="btn ghost" id="rd-cancel">Cancelar</button><button class="btn primary" id="rd-ok">Guardar</button></div>`);
  $("#rd-cancel").addEventListener("click",closeModal);
  $("#rd-ok").addEventListener("click",async ()=>{ const t=$("#rd-txt").value.trim(); if(!t) return toast("Escribí lo que definió Dennis",true);
    try{ await aapi("aud_hallazgo_save",{ id:hid, patch:{ respuesta_dennis:t } }); closeModal(); await recargarCliente(); toast("Respuesta de Dennis guardada ✓"); }
    catch(ex){ toast(ex.message,true); } });
}
function bindRevision(root, run){
  $("#rv-run",root)?.addEventListener("change",e=>{ A.rrun=+e.target.value; renderExp(); });
  $("#rv-quien",root).addEventListener("change",e=>{ try{ localStorage.setItem("qb_aud_quien",e.target.value.trim()); }catch(_){} renderExp(); });
  $$("[data-rf]",root).forEach(b=>b.addEventListener("click",()=>{ A.rfil=b.dataset.rf; renderExp(); }));
  $$(".rv-chk",root).forEach(c=>c.addEventListener("change",()=>{
    if(!pedirQuien()){ c.checked=!c.checked; return; }
    guardarFila(+c.dataset.fid,{ estado:c.checked?"Corregido":"Pendiente" }); }));
  $$("[data-fmas]",root).forEach(b=>b.addEventListener("click",()=>editarFila(+b.dataset.fmas)));
  $$("[data-fadd]",root).forEach(b=>b.addEventListener("click",()=>agregarFila(+b.dataset.fadd)));
  $$("[data-dennis]",root).forEach(b=>b.addEventListener("click",()=>respuestaDennis(+b.dataset.dennis)));
  $$("[data-hok]",root).forEach(b=>b.addEventListener("click",async ()=>{ if(!pedirQuien()) return;
    try{ await aapi("aud_hallazgo_save",{ id:+b.dataset.hok, patch:{ estado:"Resuelto" } }); await recargarCliente(); toast("Punto resuelto ✔"); }catch(ex){ toast(ex.message,true); } }));
  $$("[data-hreab]",root).forEach(b=>b.addEventListener("click",async ()=>{
    try{ await aapi("aud_hallazgo_save",{ id:+b.dataset.hreab, patch:{ estado:"Abierto" } }); await recargarCliente(); toast("Punto reabierto"); }catch(ex){ toast(ex.message,true); } }));
  $$("[data-go]",root).forEach(a=>a.addEventListener("click",e=>{ e.preventDefault(); A.rfil="todo"; renderExp(); $("#rv-h"+a.dataset.go)?.scrollIntoView({behavior:"smooth",block:"start"}); }));
  $("#rv-copy",root)?.addEventListener("click",async ()=>{
    try{ await navigator.clipboard.writeText($("#rv-texto").textContent); toast("Respuesta copiada ✓ — pegala en el mail a Dennis"); }catch(ex){ toast("No se pudo copiar",true); } });
}

/* ---- Auditorías (historial) ---- */
function tabAuditorias(root){
  const E=A.exp;
  root.innerHTML=`<div class="ax-bar"><span class="muted">Cada auditoría guarda lo que se revisó (entrada), lo que salió y las conclusiones.</span>
      <button class="btn ghost" id="ax-nueva">+ Nueva auditoría</button></div>`+
    (E.runs.length ? E.runs.map(r=>runCard(r)).join("") : `<div class="empty">Todavía no hay auditorías de este cliente. Se cargan solas cuando el skill de Claude Code termina una revisión, o a mano con «+ Nueva auditoría».</div>`);
  $("#ax-nueva").addEventListener("click",()=>editarRun(null));
  $$(".ax-run-head",root).forEach(h=>h.addEventListener("click",()=>{ const id=+h.dataset.id; A.open = A.open===id?null:id; renderExp(); }));
  bindRun(root);
}
function runCard(r){
  const E=A.exp; const hs=E.hallazgos.filter(h=>h.run_id===r.id); const ab=hs.filter(HALL_ABIERTO).length;
  const arch=E.archivos.filter(a=>a.run_id===r.id); const ins=arch.filter(a=>a.rol==="input"), outs=arch.filter(a=>a.rol==="output");
  const res=E.hallazgos.filter(h=>h.resuelto_run_id===r.id && h.run_id!==r.id);
  const cs=(E.controles||[]).filter(c=>c.run_id===r.id);
  const malos=cs.filter(c=>c.estado==="DIFERENCIA").length;
  const open=A.open===r.id;
  const head=`<div class="ax-run-head" data-id="${r.id}">
      ${semDot(r.semaforo)}
      <div class="ax-run-tit"><b>${fechaCorta(r.fecha)}</b> <span class="muted">· ${esc(r.tipo||"Integral")} · período ${periodoTxt(r)}</span>
        <div class="ax-run-res">${esc(r.resumen||"Sin resumen")}</div></div>
      <div class="ax-run-chips">
        <span class="ax-est ax-est-${esc(slugEst(r.estado))}">${esc(r.estado)}</span>
        ${cs.length?`<span class="rr-badge">${cs.length} controles${malos?` · <b style="color:var(--red)">${malos} con diferencia</b>`:""}</span>`:""}
        <span class="rr-badge">${hs.length} hallazgo${hs.length===1?"":"s"}${ab?` · ${ab} abierto${ab===1?"":"s"}`:""}</span>
        <span class="rr-badge">📥 ${ins.length} · 📤 ${outs.length}</span>
        <span class="ax-chev">${open?"▾":"▸"}</span></div></div>`;
  if(!open) return `<div class="ax-run">${head}</div>`;
  const met=Object.entries(r.metricas||{});
  return `<div class="ax-run open">${head}
    <div class="ax-run-body">
      <div class="ax-run-acts">
        <button class="btn ghost sm" data-run-edit="${r.id}">Editar</button>
        <label class="ax-inl">Estado <select data-run-estado="${r.id}">${RUN_ESTADOS.map(e=>`<option ${e===r.estado?"selected":""}>${e}</option>`).join("")}</select></label>
        <button class="btn ghost sm ax-danger" data-run-del="${r.id}">Eliminar</button>
        <span class="muted ax-meta">${r.skill_version?`Skill ${esc(r.skill_version)}`:""}${r.auditor?` · ${esc(r.auditor)}`:""}</span>
      </div>
      <div class="ax-cols">
        <div class="chart-card"><h3>📨 Reporte para Dennis
            ${r.reporte_dennis?`<button class="btn ghost sm ax-copy" data-copy="reporte_dennis" data-run="${r.id}">Copiar</button>`:""}</h3>
          ${r.reporte_dennis?`<pre class="ax-rep">${esc(r.reporte_dennis)}</pre>`:'<p class="muted">Todavía no se armó el reporte para Dennis.</p>'}
          ${r.conclusiones?`<h3 style="margin-top:14px">Conclusiones internas</h3><div class="ax-concl">${esc(r.conclusiones)}</div>`:""}
          ${met.length?`<h3 style="margin-top:14px">Cifras clave</h3><div class="ax-met">${met.map(([k,v])=>`<div><span>${esc(k)}</span><b>${metricaVal(v)}</b></div>`).join("")}</div>`:""}
        </div>
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
      ${controlesCard(cs)}
      <div class="chart-card wide"><h3>Hallazgos de esta auditoría <span class="muted">· ${hs.length}${hs.length?` · el detalle fila por fila está en la pestaña Revisión`:""}</span></h3>
        ${hs.length?hallazgosTabla(hs,false):'<p class="muted">Sin hallazgos.</p>'}
        ${res.length?`<p class="muted ax-resueltos">✓ Verificó resueltos ${res.length} hallazgo${res.length===1?"":"s"} de auditorías anteriores: ${res.map(h=>esc(h.titulo)).join(" · ")}</p>`:""}
      </div>
      ${r.mail_cliente?`<details class="chart-card wide ax-mail"><summary><b>✉️ Mail al cliente</b> <span class="muted">· en inglés, lo envía Breana</span></summary>
        <div class="ax-mail-acts"><button class="btn ghost sm ax-copy" data-copy="mail_cliente" data-run="${r.id}">Copiar</button></div>
        <pre class="ax-rep">${esc(r.mail_cliente)}</pre></details>`:""}
    </div></div>`;
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
  $$("[data-cf]",root).forEach(b=>b.addEventListener("click",()=>{ A.cfil=b.dataset.cf; renderExp(); }));
  $$(".ax-cest",root).forEach(s=>s.addEventListener("change",async ()=>{
    try{ await aapi("aud_control_save",{ id:+s.dataset.cid, patch:{ estado:s.value } }); await recargarCliente(); toast("Control actualizado ✓"); }
    catch(ex){ toast(ex.message,true); } }));
  $$("[data-cedit]",root).forEach(b=>b.addEventListener("click",()=>editarControl(+b.dataset.cedit)));
  $$("[data-up-file]",root).forEach(inp=>inp.addEventListener("change",()=>{ const id=+inp.dataset.upFile;
    subirArchivo(id, inp.files[0], $(`[data-up-rol="${id}"]`,root).value, $(`[data-up-tipo="${id}"]`,root).value); }));
  bindHallazgos(root);
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
    try{ const d=await aapi("aud_run_save",{ run:{ ...patch, cliente_id:A.cid } }); closeModal(); A.open=d.run.id; A.tab="auditorias"; await recargarCliente(); toast("Auditoría creada ✓"); }
    catch(ex){ toast(ex.message,true); }
  });
}
async function guardarRun(id, patch, modal=false){
  try{ await aapi("aud_run_save",{ id, run:patch }); if(modal) closeModal(); await recargarCliente(); toast("Guardado ✓"); }
  catch(ex){ toast(ex.message,true); }
}
function borrarRun(id){
  const r=A.exp.runs.find(x=>x.id===id); const n=A.exp.archivos.filter(a=>a.run_id===id).length;
  openModal("Eliminar auditoría",`<p>Se borra la auditoría del <b>${fechaCorta(r.fecha)}</b> con sus hallazgos${n?` y sus <b>${n} archivo${n===1?"":"s"}</b>`:""}. No se puede deshacer.</p>
    <div class="modal-actions"><button class="btn ghost" id="xd-cancel">Cancelar</button><button class="btn primary ax-danger-bg" id="xd-ok">Eliminar</button></div>`);
  $("#xd-cancel").addEventListener("click",closeModal);
  $("#xd-ok").addEventListener("click",async ()=>{
    try{ await aapi("aud_run_del",{ id }); closeModal(); if(A.open===id) A.open=null; await recargarCliente(); toast("Auditoría eliminada"); }
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

/* ---- Hallazgos ---- */
function hallazgosTabla(hs, conAuditoria){
  const fechaRun=(id)=>{ const r=A.exp.runs.find(x=>x.id===id); return r?fechaCorta(r.fecha):"—"; };
  hs=hs.slice().sort((a,b)=>b.run_id-a.run_id||(a.orden??999)-(b.orden??999)||a.id-b.id);
  return `<div class="ax-scroll"><table class="ip-table ax-hall"><thead><tr><th>Nº</th><th class="l">Hallazgo</th><th class="l">Área / cuenta</th><th class="r">Monto</th>${conAuditoria?"<th>Auditoría</th>":""}<th>Destino</th><th>Estado</th></tr></thead><tbody>
    ${hs.map(h=>`<tr class="${HALL_ABIERTO(h)?"":"ax-cerrado"}">
      <td data-label="Nº">${h.ref?`<b>${esc(h.ref)}</b>`:'<span class="muted">—</span>'}</td>
      <td class="l" data-label="Hallazgo"><b>${esc(h.titulo)}</b>${h.codigo?` <span class="muted">${esc(h.codigo)}</span>`:""}
        ${h.detalle?`<div class="ax-det">${esc(h.detalle)}</div>`:""}${h.recomendacion?`<div class="ax-rec">→ ${esc(h.recomendacion)}</div>`:""}</td>
      <td class="l" data-label="Área / cuenta">${esc(h.area||"—")}${h.cuenta?`<div class="muted">${esc(h.cuenta)}</div>`:""}</td>
      <td class="r" data-label="Monto">${h.monto!=null?Number(h.monto).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):"—"}</td>
      ${conAuditoria?`<td data-label="Auditoría">${fechaRun(h.run_id)}</td>`:""}
      <td data-label="Destino"><select class="ax-hdest" data-hid="${h.id}"><option value="">—</option>${DESTINOS.map(d=>`<option ${d===h.destino?"selected":""}>${d}</option>`).join("")}</select></td>
      <td data-label="Estado"><select class="ax-hest ${h.estado==="Repetido"?"ax-rep-est":""}" data-hid="${h.id}">${HALL_ESTADOS.map(e=>`<option ${e===h.estado?"selected":""}>${e}</option>`).join("")}</select>
        ${!HALL_ABIERTO(h)&&h.resuelto_fecha?`<div class="muted ax-small">${fechaCorta(h.resuelto_fecha)}</div>`:""}</td>
    </tr>`).join("")}</tbody></table></div>`;
}
function bindHallazgos(root){
  $$(".ax-hest",root).forEach(s=>s.addEventListener("change",async ()=>{
    try{ await aapi("aud_hallazgo_save",{ id:+s.dataset.hid, patch:{ estado:s.value } }); await recargarCliente(); toast("Hallazgo "+s.value.toLowerCase()+" ✓"); }
    catch(ex){ toast(ex.message,true); }
  }));
  $$(".ax-hdest",root).forEach(s=>s.addEventListener("change",async ()=>{
    try{ await aapi("aud_hallazgo_save",{ id:+s.dataset.hid, patch:{ destino:s.value||null } }); await recargarCliente(); toast("Destino guardado ✓"); }
    catch(ex){ toast(ex.message,true); }
  }));
}
function tabHallazgos(root){
  const hs=A.exp.hallazgos.filter(h=>A.hfil==="Todos"||(A.hfil==="Abierto"?HALL_ABIERTO(h):h.estado===A.hfil));
  root.innerHTML=`<div class="ax-bar"><div class="ax-seg">${["Abierto","Resuelto","Descartado","Todos"].map(f=>
      `<button class="tab ${A.hfil===f?"active":""}" data-hf="${f}">${f==="Abierto"?"Abiertos":f==="Todos"?"Todos":f+"s"}</button>`).join("")}</div>
      <span class="muted">La próxima auditoría arranca revisando los abiertos.</span></div>
    ${hs.length?hallazgosTabla(hs,true):`<div class="empty">No hay hallazgos ${A.hfil==="Todos"?"":A.hfil.toLowerCase()+"s"}.</div>`}`;
  $$("[data-hf]",root).forEach(b=>b.addEventListener("click",()=>{ A.hfil=b.dataset.hf; renderExp(); }));
  bindHallazgos(root);
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
