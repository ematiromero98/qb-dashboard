"use strict";
/* ===== Pestaña «Auditorías» del tablero =====
   Como Procesamiento, pero para auditorías: tarjetas, solapas con conteo, filtros
   y una fila por empresa con la última auditoría, el atraso y el estado:
   Pendiente de corregir · Pendiente info cliente (con la fecha de la consulta y el
   seguimiento) · Pendiente confirmación de Dennis · Falta enviar a Dennis ·
   Lista para cerrar · Cerrada · Sin auditar.
   Los datos salen de los expedientes (aud_resumen + aud_estado), que piden el PIN de expedientes.
   El seguimiento al cliente se guarda como nota del expediente («Seguimiento al cliente: …»).
   La agenda vieja (frecuencia y tildes por mes) sigue en la solapa «Agenda». */
const AP = { sub:"todas", prio:"", est:"", orden:"atraso", datos:null, cargando:false, err:"", det:{}, cargandoDet:false };
const AP_EST = {
  "Pendiente de corregir":           { c:"var(--amber)",  d:"Quedan filas o puntos por corregir en la Revisión" },
  "Pendiente info cliente":          { c:"var(--blue)",   d:"Hay puntos que solo puede contestar el cliente" },
  "Pendiente confirmación de Dennis":{ c:"var(--violet)", d:"Hay puntos marcados «Consultar con Dennis»" },
  "Falta enviar a Dennis":           { c:"var(--pink)",   d:"El equipo terminó: falta mandarle la respuesta HECHA a Dennis" },
  "Lista para cerrar":               { c:"var(--cyan)",   d:"No queda nada abierto y ya se le mandó a Dennis: se puede cerrar" },
  "Cerrada":                         { c:"var(--menta)",  d:"Auditoría cerrada" },
  "Sin auditar":                     { c:"var(--muted2)", d:"Nunca se auditó" },
};
const AP_ORDEN_EST = Object.keys(AP_EST);
const AP_SUBS = [["todas","Todas"],["aud","Auditadas"],["Cerrada","Cerradas"],["Pendiente de corregir","Pendientes de corregir"],
  ["Pendiente info cliente","Pendiente info cliente"],["Pendiente confirmación de Dennis","Pendiente confirmación de Dennis"],
  ["Falta enviar a Dennis","Falta enviar a Dennis"],["Lista para cerrar","Lista para cerrar"],["sin","Sin auditar"],["atras","Atrasadas"],
  ["bk","Por bookkeeper"],["mes","Mes a mes"],["agenda","Agenda"]];
const AP_SEG = "Seguimiento al cliente: ";

const apPin = ()=>A.pin||sessionStorage.getItem("qb_pin_aud")||"";
const apMes = (d)=>d?String(d).slice(0,7):"";
const apFecha = (d)=>{ if(!d) return "—"; const p=String(d).slice(0,10).split("-"); return `${p[1]}/${p[2]}/${p[0]}`; };
const apDias = (d)=>d?Math.max(0,Math.round((new Date(todayStr()+"T00:00:00")-new Date(String(d).slice(0,10)+"T00:00:00"))/86400000)):null;
// Mes que tendría que estar auditado: el último mes cerrado.
const apObjetivo = ()=>mesAdd(mesActual(),-1);
const apEsCliente = (h)=>h.destino==="CLIENTE"||(h.codigo!=="A01"&&String(h.mail_texto||"").trim());

async function apCargar(force){
  if(AP.cargando||(AP.datos&&!force)) return;
  if(!apPin()) return;
  A.pin=apPin(); AP.cargando=true; AP.err="";
  try{
    const [r,e]=await Promise.all([aapi("aud_resumen"),aapi("aud_estado")]);
    AP.datos={ runs:r.runs||[], avance:r.avance||[], est:e.runs||[], abiertos:e.abiertos||[] }; AP.t=Date.now();
  }catch(ex){ AP.err=ex.message; if(/PIN/i.test(ex.message)){ sessionStorage.removeItem("qb_pin_aud"); A.pin=""; } }
  AP.cargando=false;
  if(S.view==="auditorias") renderView();
}
// Detalle (quién pidió y seguimientos) de las empresas que esperan al cliente o a Dennis: un aud_cliente por empresa.
async function apCargarDet(cids){
  const faltan=cids.filter(c=>!AP.det[c]); if(!faltan.length||AP.cargandoDet) return;
  AP.cargandoDet=true;
  try{
    for(let i=0;i<faltan.length;i+=6){
      const rs=await Promise.all(faltan.slice(i,i+6).map(c=>aapi("aud_cliente",{ cliente_id:c }).then(x=>[c,x])));
      rs.forEach(([c,x])=>{ AP.det[c]={ hallazgos:x.hallazgos||[], notas:(x.notas||[]) }; });
    }
  }catch(ex){ toast(ex.message,true); }
  AP.cargandoDet=false;
  if(S.view==="auditorias") renderView();
}
function apLogin(){
  openModal("🔒 Estado de las auditorías",`
    <p class="muted">Para ver el estado de cada empresa hace falta el PIN de expedientes.</p>
    <label>PIN de expedientes</label><input id="ap-pin" type="password" autocomplete="off">
    <div id="ap-err" class="gate-err"></div>
    <div class="modal-actions"><button class="btn ghost" id="ap-cancel">Cancelar</button><button class="btn primary" id="ap-ok">Entrar</button></div>`);
  const go=async ()=>{ A.pin=$("#ap-pin").value.trim();
    try{ await aapi("aud_login"); sessionStorage.setItem("qb_pin_aud",A.pin); closeModal(); AP.datos=null; apCargar(true); }
    catch(ex){ $("#ap-err").textContent=ex.message; A.pin=""; } };
  $("#ap-cancel").addEventListener("click",closeModal);
  $("#ap-ok").addEventListener("click",go);
  $("#ap-pin").addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); go(); } });
  setTimeout(()=>$("#ap-pin").focus(),50);
}

/* Una fila por empresa activa: su última auditoría, lo que cubre y el estado. */
function apFilas(){
  const D=AP.datos, obj=apObjetivo();
  const av=new Map(D.avance.map(x=>[x.run_id,x])), es=new Map(D.est.map(x=>[x.run_id,x]));
  const ab=new Map(); D.abiertos.forEach(h=>{ (ab.get(h.run_id)||ab.set(h.run_id,[]).get(h.run_id)).push(h); });
  const runsDe=new Map(); D.runs.forEach(r=>{ (runsDe.get(r.cliente_id)||runsDe.set(r.cliente_id,[]).get(r.cliente_id)).push(r); });
  return S.clientes.filter(c=>c.activo!==false).map(c=>{
    const rs=(runsDe.get(c.id)||[]).slice().sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha))||b.id-a.id);
    const run=rs[0]||null, p=PRIOS.includes(c.prioridad)?c.prioridad:"Media";
    const base={ c, run, runs:rs, prio:p, bk:c.bookkeeper_default||"(sin asignar)", cli:[], den:[], corr:[] };
    if(!run) return { ...base, estados:["Sin auditar"], estado:"Sin auditar", atraso:null, hasta:"" };
    const hasta=rs.reduce((m,r)=>apMes(r.periodo_hasta)>m?apMes(r.periodo_hasta):m,"");
    const atraso=Math.max(0, mesIdx(obj)-mesIdx(hasta||apMes(run.fecha)));
    const hs=ab.get(run.id)||[], a=av.get(run.id)||{}, e=es.get(run.id)||{};
    const cli=hs.filter(apEsCliente);
    const den=hs.filter(h=>h.destino==="DEFINIR");
    const corr=hs.filter(h=>!["CLIENTE","DEFINIR","DEFINIDO","CONTROL","CIERRE ANUAL"].includes(h.destino)&&(h.pendientes>0||!h.filas));
    const enviada=run.estado==="Enviada a Dennis", cerrada=["Hecho","Cerrada"].includes(run.estado);
    const L=[];
    if(cerrada) L.push("Cerrada");
    else{
      if(corr.length) L.push("Pendiente de corregir");
      if(cli.length) L.push("Pendiente info cliente");
      if(den.length) L.push("Pendiente confirmación de Dennis");
      if(!corr.length&&!enviada) L.push("Falta enviar a Dennis");
      if(!L.length) L.push("Lista para cerrar");
    }
    const pedidos=cli.map(h=>h.pedido_breana_at).filter(Boolean).sort();
    return { ...base, cli, den, corr, estados:L, estado:L[0], atraso, hasta,
      consultado:pedidos[0]||null, sinPedir:cli.filter(h=>!h.pedido_breana_at).length,
      filas:Number(e.filas||a.filas||0), hechas:Number(e.hechas||0), abiertos:hs.length, quien:e.quien||"", ultimo:e.ultimo_tilde||a.ultimo_tilde||null };
  });
}
function apFiltrar(rows){
  let r=rows;
  if(S.fbk) r=r.filter(x=>x.c.bookkeeper_default===S.fbk);
  if(S.q){ const q=S.q.toLowerCase(); r=r.filter(x=>(x.c.nombre||"").toLowerCase().includes(q)); }
  if(AP.prio) r=r.filter(x=>x.prio===AP.prio);
  if(AP.est) r=r.filter(x=>x.estados.includes(AP.est));
  return r;
}
const apEnSub=(x,s)=>["todas","bk","mes"].includes(s)?true:s==="aud"?!!x.run:s==="sin"?!x.run:s==="atras"?(!!x.run&&x.atraso>0):x.estados.includes(s);
function apOrdenar(r){
  const by={ atraso:(a,b)=>(b.atraso??99)-(a.atraso??99)||PRIO_RANK[a.prio]-PRIO_RANK[b.prio]||a.c.nombre.localeCompare(b.c.nombre),
    empresa:(a,b)=>a.c.nombre.localeCompare(b.c.nombre),
    ultima:(a,b)=>String(a.run?.fecha||"").localeCompare(String(b.run?.fecha||""))||a.c.nombre.localeCompare(b.c.nombre),
    estado:(a,b)=>AP_ORDEN_EST.indexOf(a.estado)-AP_ORDEN_EST.indexOf(b.estado)||a.c.nombre.localeCompare(b.c.nombre),
    consulta:(a,b)=>String(a.consultado||"9999").localeCompare(String(b.consultado||"9999"))||a.c.nombre.localeCompare(b.c.nombre),
    bk:(a,b)=>a.bk.localeCompare(b.bk)||a.c.nombre.localeCompare(b.c.nombre),
    prio:(a,b)=>PRIO_RANK[a.prio]-PRIO_RANK[b.prio]||a.c.nombre.localeCompare(b.c.nombre) };
  return r.slice().sort(by[AP.orden]||by.atraso);
}
const apChip=(e,small,extra)=>`<span class="ap-chip${small?" sm":""}" style="--c:${AP_EST[e].c}" title="${esc(AP_EST[e].d)}">${esc(e)}${extra?` <i>${extra}</i>`:""}</span>`;
function apConsulta(x){
  if(!x.cli.length) return "";
  if(!x.consultado) return "sin consultar";
  const d=apDias(x.consultado); return `consultado ${apFecha(x.consultado)} · ${d} d${x.sinPedir?` · ${x.sinPedir} sin consultar`:""}`;
}
function apEstadosHtml(x){
  return x.estados.map((e,i)=>apChip(e,i>0,e==="Pendiente info cliente"?esc(apConsulta(x)):"")).join(" ");
}
function apAtraso(x){
  if(!x.run) return `<span class="ap-atr ap-late">Nunca</span>`;
  return x.atraso>0?`<span class="ap-atr ${x.atraso>1?"ap-late":"ap-warn"}">${x.atraso} ${x.atraso===1?"mes":"meses"}</span>`:`<span class="ap-atr ap-ok">Al día</span>`;
}

function apTabla(rows){
  if(!rows.length) return `<div class="empty">Nada para este filtro.</div>`;
  return `<table class="emp-table ap-table"><thead><tr>
    <th>Empresa</th><th>Bookkeeper</th><th>Prioridad</th><th>Última auditoría</th><th>Período auditado</th><th>Atraso</th><th>Estado</th><th class="r">Avance</th><th class="r">Abiertos</th><th>Corrigió</th><th></th></tr></thead><tbody>
    ${rows.map(x=>{ const pct=x.filas?Math.round(x.hechas*100/x.filas):null;
      return `<tr>
      <td data-label="Empresa"><a href="#" class="aud-open" data-cid="${x.c.id}" title="Abrir el expediente">${esc(x.c.nombre)}</a></td>
      <td data-label="Bookkeeper">${esc(x.c.bookkeeper_default||"—")}</td>
      <td data-label="Prioridad"><span class="prio-badge prio-${prioSlug(x.prio)}">${esc(x.prio)}</span></td>
      <td data-label="Última auditoría">${x.run?`${apFecha(x.run.fecha)} <span class="muted">· ${esc(x.run.estado||"")}</span>`:"—"}</td>
      <td data-label="Período">${x.run?`${apFecha(x.run.periodo_desde)} – ${apFecha(x.run.periodo_hasta)}`:"—"}</td>
      <td data-label="Atraso">${apAtraso(x)}</td>
      <td data-label="Estado" class="ap-ests">${apEstadosHtml(x)}</td>
      <td data-label="Avance" class="r">${pct==null?"—":`<span class="mini-prog"><i style="width:${pct}%"></i></span>${x.hechas}/${x.filas}`}</td>
      <td data-label="Abiertos" class="r">${x.run?(x.abiertos||"—"):""}</td>
      <td data-label="Corrigió">${esc(x.quien||"—")}${x.ultimo?` <span class="muted">· ${apFecha(x.ultimo)}</span>`:""}</td>
      <td>${x.estado==="Lista para cerrar"?`<button class="btn primary sm" data-ap-cerrar="${x.run.id}">Cerrar auditoría</button>`
        :x.estado==="Falta enviar a Dennis"?`<button class="btn ghost sm" data-ap-enviada="${x.run.id}" title="Marcar que ya se le mandó la respuesta HECHA">Enviada a Dennis</button>`:""}</td></tr>`; }).join("")}
    </tbody></table>`;
}

/* Pendiente info cliente / confirmación de Dennis: una tarjeta por empresa con sus puntos y el seguimiento. */
function apEspera(rows, tipo){
  const cliente=tipo==="cliente";
  const xs=rows.filter(x=>cliente?x.cli.length:x.den.length);
  if(!xs.length) return `<div class="empty">No hay empresas esperando ${cliente?"información del cliente":"la confirmación de Dennis"}.</div>`;
  apCargarDet(xs.map(x=>x.c.id));
  return `<div class="ap-esp">${xs.map(x=>{
    const pts=cliente?x.cli:x.den, det=AP.det[x.c.id];
    const hd=det?new Map(det.hallazgos.map(h=>[h.id,h])):null;
    const segs=det?det.notas.filter(n=>n.run_id===x.run.id&&String(n.texto).startsWith(cliente?AP_SEG:"Dennis: ")):[];
    const d=cliente&&x.consultado?apDias(x.consultado):null;
    return `<div class="chart-card ap-card">
      <div class="ap-card-h"><a href="#" class="aud-open" data-cid="${x.c.id}"><b>${esc(x.c.nombre)}</b></a>
        <span class="muted">${esc(x.c.bookkeeper_default||"—")} · auditoría ${apFecha(x.run.periodo_desde)}–${apFecha(x.run.periodo_hasta)}</span>
        ${cliente?(x.consultado?`<span class="ap-dias ${d>14?"ap-late":d>7?"ap-warn":"ap-ok"}">Consultado ${apFecha(x.consultado)} · ${d} días</span>`:`<span class="ap-dias ap-late">Sin consultar</span>`):""}</div>
      <table class="emp-table ap-table"><thead><tr><th>Punto</th><th>Qué se pregunta</th>${cliente?"<th>Consultado</th>":"<th>Qué se recomienda</th>"}</tr></thead><tbody>
      ${pts.map(p=>{ const h=hd?.get(p.id)||p; return `<tr><td class="nw"><b>${esc(p.ref||"")}</b></td>
        <td style="white-space:normal">${esc(p.titulo||"")}${cliente&&h.mail_texto?`<div class="muted ap-en">${esc(h.mail_texto)}</div>`:""}</td>
        ${cliente?`<td class="nw">${p.pedido_breana_at?`${apFecha(p.pedido_breana_at)}${h.pedido_breana_por?` · ${esc(h.pedido_breana_por)}`:""}`:'<span class="ap-late">Sin consultar</span>'}</td>`
          :`<td style="white-space:normal">${esc(h.recomendacion||"")}${h.respuesta_dennis?`<div class="ap-ok">Dennis: ${esc(h.respuesta_dennis)}</div>`:""}</td>`}</tr>`; }).join("")}
      </tbody></table>
      ${cliente?`<div class="ap-seg"><b>Seguimiento</b>${!det?' <span class="muted">cargando…</span>':segs.length?`<ul>${segs.map(n=>`<li><span class="nw">${apFecha(n.fecha)}</span>${n.autor?` · ${esc(n.autor)}`:""} — ${esc(String(n.texto).slice(AP_SEG.length))}</li>`).join("")}</ul>`:' <span class="muted">Sin seguimientos todavía.</span>'}</div>`:""}
      <div class="ap-card-acts">
        ${cliente&&x.sinPedir?`<button class="btn primary sm" data-ap-pedir="${x.run.id}">Marcar consultado hoy (${x.sinPedir})</button>`:""}
        ${cliente?`<button class="btn ghost sm" data-ap-seg="${x.c.id}" data-run="${x.run.id}">+ Seguimiento</button>`:""}
        <button class="btn ghost sm aud-open" data-cid="${x.c.id}">Abrir expediente</button></div></div>`; }).join("")}</div>`;
}

function apPorBookkeeper(rows){
  const g=new Map(); rows.forEach(x=>{ (g.get(x.bk)||g.set(x.bk,[]).get(x.bk)).push(x); });
  const equipo=new Map();
  rows.forEach(x=>String(x.quien||"").split(",").map(s=>s.trim()).filter(Boolean).forEach(q=>{
    const o=equipo.get(q)||{ emp:new Set(), ult:"" }; o.emp.add(x.c.nombre); if(x.ultimo&&x.ultimo>o.ult) o.ult=x.ultimo; equipo.set(q,o); }));
  const cards=[...g.entries()].sort((a,b)=>b[1].length-a[1].length).map(([bk,xs],i)=>{
    const col=BK_COLORS[i%BK_COLORS.length], aldia=xs.filter(x=>x.run&&!x.atraso).length, pct=Math.round(aldia*100/xs.length);
    const cnt=(e)=>xs.filter(x=>x.estados.includes(e)).length;
    return `<div class="bk-card"><h3><span>${esc(bk)}</span><span class="pct" style="color:${col}">${pct}%</span></h3>
      <div class="prog-track"><div class="prog-fill" style="width:${pct}%;background:${col}"></div></div>
      <div class="bk-stat" style="margin-top:8px"><span>Empresas</span><b>${xs.length}</b></div>
      <div class="bk-stat"><span>Auditadas</span><b>${xs.filter(x=>x.run).length}</b></div>
      <div class="bk-stat"><span>Al día (${mesLabel(apObjetivo())})</span><b style="color:var(--menta)">${aldia}</b></div>
      <div class="bk-stat"><span>Atrasadas</span><b style="color:var(--amber)">${xs.filter(x=>x.run&&x.atraso).length}</b></div>
      ${AP_ORDEN_EST.map(e=>`<div class="bk-stat"><span>${e}</span><b style="color:${AP_EST[e].c}">${cnt(e)||"—"}</b></div>`).join("")}
      <div class="bk-cli-head">Empresas</div>
      <div class="bk-clientes">${apOrdenar(xs).map(x=>`<div class="bk-cli ${x.estado==="Cerrada"?"done":""}"><a href="#" class="aud-open nm" data-cid="${x.c.id}">${esc(x.c.nombre)}</a><span class="st">${apChip(x.estado,true)}</span></div>`).join("")}</div></div>`; }).join("");
  const eq=[...equipo.entries()].sort((a,b)=>b[1].emp.size-a[1].emp.size);
  return `<h3 class="ap-h">Por bookkeeper de QuickBooks</h3><div class="bk-panel">${cards}</div>
    <div class="chart-card wide"><h3>Quién corrigió en la Revisión <span class="muted">· según los tildes de cada auditoría</span></h3>
    ${eq.length?`<table class="emp-table ap-table"><thead><tr><th>Persona</th><th class="r">Empresas</th><th>Último tilde</th><th>Empresas</th></tr></thead><tbody>
      ${eq.map(([q,o])=>`<tr><td><b>${esc(q)}</b></td><td class="r">${o.emp.size}</td><td>${apFecha(o.ult)}</td><td class="muted" style="white-space:normal">${esc([...o.emp].sort().join(", "))}</td></tr>`).join("")}</tbody></table>`
      :`<p class="muted">Todavía nadie tildó correcciones.</p>`}</div>`;
}

function apMesAMes(rows){
  const obj=apObjetivo(), meses=[]; for(let i=11;i>=0;i--) meses.push(mesAdd(obj,-i));
  const cubre=(x,m)=>x.runs.filter(r=>apMes(r.periodo_desde)<=m&&m<=apMes(r.periodo_hasta));
  const tot=meses.map(m=>rows.filter(x=>cubre(x,m).length).length);
  return `<div class="chart-card wide"><h3>Mes a mes <span class="muted">· ✓ = el mes está dentro de una auditoría · objetivo: todas las empresas, todos los meses</span></h3>
    <div class="ax-scroll"><table class="emp-table ap-mes"><thead><tr><th>Empresa</th><th>Bookkeeper</th>${meses.map(m=>`<th class="tc">${mesLabel(m)}</th>`).join("")}<th>Estado</th></tr></thead><tbody>
    ${rows.map(x=>`<tr><td><a href="#" class="aud-open" data-cid="${x.c.id}">${esc(x.c.nombre)}</a></td><td class="muted">${esc(x.c.bookkeeper_default||"—")}</td>
      ${meses.map(m=>{ const rs=cubre(x,m); return `<td class="tc ${rs.length?"ap-si":"ap-no"}" title="${rs.length?esc(rs.map(r=>`Auditoría del ${apFecha(r.fecha)} (${apFecha(r.periodo_desde)}–${apFecha(r.periodo_hasta)})`).join("\n")):"Sin auditar"}">${rs.length?"✓":""}</td>`; }).join("")}
      <td>${apChip(x.estado,true)}</td></tr>`).join("")}
    </tbody><tfoot><tr><td colspan="2"><b>Empresas auditadas</b></td>${tot.map(n=>`<td class="tc"><b>${n}</b><span class="muted">/${rows.length}</span></td>`).join("")}<td></td></tr></tfoot></table></div></div>`;
}

function renderAuditorias(){
  const nav=`<div class="ap-subs">${AP_SUBS.map(([k,t])=>`<button class="tab ${AP.sub===k?"active":""}" data-ap-sub="${k}">${t}<span class="cnt" data-ap-cnt="${k}"></span></button>`).join("")}</div>`;
  if(AP.sub==="agenda"){ renderAuditAgenda(); $("#panel").insertAdjacentHTML("afterbegin",nav); apBind(); return; }
  if(!apPin()){
    $("#panel").innerHTML=nav+`<div class="chart-card wide ap-lock"><h3>🔒 Estado de las auditorías</h3>
      <p class="muted">Para ver qué empresas se auditaron, cuándo y en qué estado está cada una, ingresá el PIN de expedientes. Se pide una sola vez por sesión.</p>
      <button class="btn primary" id="ap-login">Ingresar el PIN de expedientes</button></div>`;
    apBind(); return;
  }
  if(!AP.datos){
    $("#panel").innerHTML=nav+`<div class="empty">${AP.err?`No se pudo cargar: ${esc(AP.err)} <button class="btn ghost sm" id="ap-retry">Reintentar</button>`:"Cargando las auditorías…"}</div>`;
    apBind(); if(!AP.err) apCargar(); return;
  }
  if(Date.now()-(AP.t||0)>120000) apCargar(true);   // se refresca solo al volver a la pestaña
  const todas=apFiltrar(apFilas());
  const obj=apObjetivo(), aldia=todas.filter(x=>x.run&&!x.atraso).length, pct=todas.length?Math.round(aldia*100/todas.length):0;
  const cnt=(e)=>todas.filter(x=>x.estados.includes(e)).length;
  const K=[[`${pct}%`,`Al día con ${mesLabel(obj)}`,"var(--menta)","todas",pct],[todas.filter(x=>x.run).length,"Auditadas","var(--txt)","aud"],
    [cnt("Cerrada"),"Cerradas",AP_EST["Cerrada"].c,"Cerrada"],
    [cnt("Pendiente de corregir"),"Pendientes de corregir",AP_EST["Pendiente de corregir"].c,"Pendiente de corregir"],
    [cnt("Pendiente info cliente"),"Pendiente info cliente",AP_EST["Pendiente info cliente"].c,"Pendiente info cliente"],
    [cnt("Pendiente confirmación de Dennis"),"Pendiente confirmación de Dennis",AP_EST["Pendiente confirmación de Dennis"].c,"Pendiente confirmación de Dennis"],
    [todas.filter(x=>!x.run).length,"Sin auditar","var(--red)","sin"],[todas.filter(x=>x.run&&x.atraso).length,"Atrasadas","var(--amber)","atras"]];
  const rows=apOrdenar(todas.filter(x=>apEnSub(x,AP.sub)));
  const cuerpo=AP.sub==="bk"?apPorBookkeeper(todas):AP.sub==="mes"?apMesAMes(apOrdenar(todas))
    :AP.sub==="Pendiente info cliente"?apEspera(rows,"cliente"):AP.sub==="Pendiente confirmación de Dennis"?apEspera(rows,"dennis")
    :`<div class="chart-card wide">${apTabla(rows)}</div>`;
  $("#panel").innerHTML=`
    <div class="ap-kpis">${K.map(k=>`<div class="kpi${k[4]!=null?" kpi-prog":""}${AP.sub===k[3]&&k[4]==null?" ap-on":""}" data-ap-sub="${k[3]}"><div class="n" style="color:${k[2]}">${k[0]}</div><div class="l">${k[1]}</div>${k[4]!=null?`<div class="prog-track"><div class="prog-fill" style="width:${k[4]}%"></div></div>`:""}</div>`).join("")}</div>
    ${nav}
    <div class="ap-filtros">
      <select id="ap-prio"><option value="">Todas las prioridades</option>${PRIOS.map(p=>`<option ${AP.prio===p?"selected":""}>${p}</option>`).join("")}</select>
      <select id="ap-est"><option value="">Todos los estados</option>${AP_ORDEN_EST.map(e=>`<option ${AP.est===e?"selected":""}>${e}</option>`).join("")}</select>
      <label class="muted">Ordenar <select id="ap-orden">${[["atraso","Más atrasadas primero"],["consulta","Consulta al cliente más vieja"],["ultima","Última auditoría (más vieja)"],["estado","Estado"],["prio","Prioridad"],["bk","Bookkeeper"],["empresa","Empresa"]].map(o=>`<option value="${o[0]}" ${AP.orden===o[0]?"selected":""}>${o[1]}</option>`).join("")}</select></label>
      <span class="muted">${S.fbk?`Bookkeeper: <b>${esc(S.fbk)}</b> · `:""}${todas.length} empresas · objetivo: auditadas hasta ${mesLabel(obj)}</span>
      <span class="ap-acts"><button class="btn ghost sm" id="ap-csv">Exportar CSV</button><button class="btn ghost sm" id="ap-refresh" title="Volver a leer los expedientes">↻</button><button class="btn ghost sm" id="audit-exp">📁 Expedientes</button></span>
    </div>
    ${cuerpo}`;
  AP_SUBS.forEach(([k])=>{ const el=$(`[data-ap-cnt="${k}"]`); if(!el||["bk","mes","agenda","todas"].includes(k)) return; const n=todas.filter(x=>apEnSub(x,k)).length; el.textContent=n?` ${n}`:""; });
  apBind(todas);
}
async function apRun(id, patch, msg){
  try{ await aapi("aud_run_save",{ id, run:patch }); toast(msg); AP.t=0; await apCargar(true); }catch(ex){ toast(ex.message,true); }
}
function apSeguimiento(cid, runId){
  const yo=(typeof quien==="function"&&quien())||"";
  openModal("Seguimiento al cliente",`
    <p class="muted">${esc((S.clientes.find(c=>c.id===cid)||{}).nombre||"")} · queda en las notas del expediente.</p>
    <label>Fecha</label><input type="date" id="ap-sf" value="${todayStr()}">
    <label>Quién</label><input type="text" id="ap-sq" value="${esc(yo)}" placeholder="Tu nombre">
    <label>Qué se hizo / qué contestó</label><textarea id="ap-st" rows="3" placeholder="Ej: Breana le volvió a escribir; dice que manda las facturas el viernes"></textarea>
    <div class="modal-actions"><button class="btn ghost" id="ap-sc">Cancelar</button><button class="btn primary" id="ap-so">Guardar</button></div>`);
  $("#ap-sc").addEventListener("click",closeModal);
  $("#ap-so").addEventListener("click",async ()=>{ const t=$("#ap-st").value.trim(); if(!t) return toast("Escribí qué se hizo",true);
    try{ const d=await aapi("aud_nota_add",{ cliente_id:cid, run_id:runId, texto:AP_SEG+t, autor:$("#ap-sq").value.trim()||null, fecha:$("#ap-sf").value||todayStr() });
      if(AP.det[cid]) AP.det[cid].notas.unshift(d.nota); closeModal(); toast("Seguimiento guardado ✓"); renderView(); }catch(ex){ toast(ex.message,true); } });
  setTimeout(()=>$("#ap-st").focus(),50);
}
function apBind(todas){
  $$("[data-ap-sub]").forEach(b=>b.addEventListener("click",()=>{ AP.sub=b.dataset.apSub; if(AP.sub==="Pendiente info cliente") AP.orden="consulta"; renderView(); $("#content").scrollTop=0; }));
  $("#ap-login")?.addEventListener("click",apLogin);
  $("#ap-retry")?.addEventListener("click",()=>{ AP.err=""; apCargar(true); });
  $("#ap-refresh")?.addEventListener("click",()=>{ AP.datos=null; AP.det={}; apCargar(true); renderView(); });
  $("#ap-prio")?.addEventListener("change",e=>{ AP.prio=e.target.value; renderView(); });
  $("#ap-est")?.addEventListener("change",e=>{ AP.est=e.target.value; renderView(); });
  $("#ap-orden")?.addEventListener("change",e=>{ AP.orden=e.target.value; renderView(); });
  $$("[data-ap-cerrar]").forEach(b=>b.addEventListener("click",()=>apRun(+b.dataset.apCerrar,{ estado:"Cerrada" },"Auditoría cerrada ✓")));
  $$("[data-ap-enviada]").forEach(b=>b.addEventListener("click",()=>apRun(+b.dataset.apEnviada,{ estado:"Enviada a Dennis" },"Marcada como enviada a Dennis ✓")));
  $$("[data-ap-seg]").forEach(b=>b.addEventListener("click",()=>apSeguimiento(+b.dataset.apSeg,+b.dataset.run)));
  $$("[data-ap-pedir]").forEach(b=>b.addEventListener("click",async ()=>{
    const yo=(typeof quien==="function"&&quien())||prompt("¿Quién se lo pidió a Breana?")||"";
    if(!yo.trim()) return;
    try{ await aapi("aud_pedido_breana",{ run_id:+b.dataset.apPedir, marcar:true, quien:yo.trim() }); toast("Marcado como consultado hoy ✓"); const r=AP.datos.runs.find(x=>x.id===+b.dataset.apPedir); if(r) delete AP.det[r.cliente_id]; await apCargar(true); }catch(ex){ toast(ex.message,true); } }));
  $("#ap-csv")?.addEventListener("click",()=>{
    const q=(v)=>`"${String(v??"").replace(/"/g,'""')}"`;
    const L=[["Empresa","Bookkeeper","Prioridad","Ultima auditoria","Desde","Hasta","Estado auditoria","Atraso (meses)","Situacion","Consultado al cliente","Puntos cliente","Puntos Dennis","Filas hechas","Filas","Puntos abiertos","Corrigio"].map(q).join(",")]
      .concat(apOrdenar(todas||[]).map(x=>[x.c.nombre,x.c.bookkeeper_default,x.prio,x.run?.fecha,x.run?.periodo_desde,x.run?.periodo_hasta,x.run?.estado,x.run?x.atraso:"Nunca",x.estados.join(" + "),x.consultado?String(x.consultado).slice(0,10):"",x.cli.length,x.den.length,x.hechas,x.filas,x.abiertos,x.quien].map(q).join(",")));
    const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob(["﻿"+L.join("\r\n")],{ type:"text/csv" })); a.download=`auditorias_${mesActual()}.csv`; a.click();
  });
}
