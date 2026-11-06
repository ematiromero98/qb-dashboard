"use strict";
/* ===== Pestaña «Auditorías» del tablero =====
   Como Procesamiento, pero para auditorías: tarjetas, solapas con conteo, filtros
   y una fila por empresa con la última auditoría, el atraso y el estado:
   Sin auditar · Pendiente corrección · Mail al cliente · Consultar con Dennis ·
   Mail a Dennis · Esperando al cliente · Correcto.
   Los datos salen de los expedientes (aud_resumen + aud_estado), que piden el PIN de expedientes.
   La agenda vieja (frecuencia y tildes por mes) sigue en la solapa «Agenda». */
const AP = { sub:"todas", prio:"", est:"", orden:"atraso", datos:null, cargando:false, err:"" };
const AP_EST = {
  "Sin auditar":         { c:"var(--muted2)", d:"Nunca se auditó" },
  "Pendiente corrección":{ c:"var(--amber)",  d:"Quedan filas o puntos por corregir en la Revisión" },
  "Mail al cliente":     { c:"var(--blue)",   d:"Hay puntos para el cliente que todavía no se le pidieron a Breana" },
  "Consultar con Dennis":{ c:"var(--violet)", d:"Hay puntos marcados «Consultar con Dennis»" },
  "Mail a Dennis":       { c:"var(--pink)",   d:"El equipo terminó: falta mandarle la respuesta HECHA a Dennis" },
  "Esperando al cliente":{ c:"var(--cyan)",   d:"Ya se le pidió al cliente; falta que conteste" },
  "Correcto":            { c:"var(--menta)",  d:"Todo corregido y enviado a Dennis" },
};
const AP_ORDEN_EST = Object.keys(AP_EST);
const AP_SUBS = [["todas","Todas"],["sin","Sin auditar"],["atras","Atrasadas"],["Pendiente corrección","Pendiente corrección"],["Mail al cliente","Mail al cliente"],
  ["Consultar con Dennis","Consultar con Dennis"],["Mail a Dennis","Mail a Dennis"],["Esperando al cliente","Esperando al cliente"],["Correcto","Correctas"],
  ["bk","Por bookkeeper"],["mes","Mes a mes"],["agenda","Agenda"]];

const apPin = ()=>A.pin||sessionStorage.getItem("qb_pin_aud")||"";
const apMes = (d)=>d?String(d).slice(0,7):"";
const apFecha = (d)=>{ if(!d) return "—"; const p=String(d).slice(0,10).split("-"); return `${p[1]}/${p[2]}/${p[0]}`; };
// Mes que tendría que estar auditado: el último mes cerrado.
const apObjetivo = ()=>mesAdd(mesActual(),-1);

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
    const base={ c, run, runs:rs, prio:p, bk:c.bookkeeper_default||"(sin asignar)" };
    if(!run) return { ...base, estados:["Sin auditar"], estado:"Sin auditar", atraso:null, hasta:"" };
    const hasta=rs.reduce((m,r)=>apMes(r.periodo_hasta)>m?apMes(r.periodo_hasta):m,"");
    const atraso=Math.max(0, mesIdx(obj)-mesIdx(hasta||apMes(run.fecha)));
    const hs=ab.get(run.id)||[], a=av.get(run.id)||{}, e=es.get(run.id)||{};
    const cli=hs.filter(h=>h.destino==="CLIENTE"||(h.codigo!=="A01"&&String(h.mail_texto||"").trim()));
    const den=hs.filter(h=>h.destino==="DEFINIR");
    const corr=hs.filter(h=>!["CLIENTE","DEFINIR","DEFINIDO","CONTROL","CIERRE ANUAL"].includes(h.destino)&&(h.pendientes>0||!h.filas));
    const enviada=["Enviada a Dennis","Hecho","Cerrada"].includes(run.estado);
    const L=[];
    if(corr.length) L.push("Pendiente corrección");
    if(cli.some(h=>!h.pedido_breana_at)) L.push("Mail al cliente");
    if(den.length) L.push("Consultar con Dennis");
    if(!corr.length&&!enviada) L.push("Mail a Dennis");
    if(cli.length&&cli.every(h=>h.pedido_breana_at)) L.push("Esperando al cliente");
    if(!L.length) L.push("Correcto");
    return { ...base, estados:L, estado:L[0], atraso, hasta,
      filas:Number(e.filas||a.filas||0), hechas:Number(e.hechas||0), abiertos:hs.length, nCli:cli.length, quien:e.quien||"", ultimo:e.ultimo_tilde||a.ultimo_tilde||null };
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
const apEnSub=(x,s)=>s==="todas"||["bk","mes"].includes(s)?true:s==="sin"?!x.run:s==="atras"?(!!x.run&&x.atraso>0):x.estados.includes(s);
function apOrdenar(r){
  const by={ atraso:(a,b)=>(b.atraso??99)-(a.atraso??99)||PRIO_RANK[a.prio]-PRIO_RANK[b.prio]||a.c.nombre.localeCompare(b.c.nombre),
    empresa:(a,b)=>a.c.nombre.localeCompare(b.c.nombre),
    ultima:(a,b)=>String(a.run?.fecha||"").localeCompare(String(b.run?.fecha||""))||a.c.nombre.localeCompare(b.c.nombre),
    estado:(a,b)=>AP_ORDEN_EST.indexOf(a.estado)-AP_ORDEN_EST.indexOf(b.estado)||a.c.nombre.localeCompare(b.c.nombre),
    bk:(a,b)=>a.bk.localeCompare(b.bk)||a.c.nombre.localeCompare(b.c.nombre),
    prio:(a,b)=>PRIO_RANK[a.prio]-PRIO_RANK[b.prio]||a.c.nombre.localeCompare(b.c.nombre) };
  return r.slice().sort(by[AP.orden]||by.atraso);
}
const apChip=(e,small)=>`<span class="ap-chip${small?" sm":""}" style="--c:${AP_EST[e].c}" title="${esc(AP_EST[e].d)}">${esc(e)}</span>`;
function apAtraso(x){
  if(!x.run) return `<span class="ap-atr ap-late">Nunca</span>`;
  return x.atraso>0?`<span class="ap-atr ${x.atraso>1?"ap-late":"ap-warn"}">${x.atraso} ${x.atraso===1?"mes":"meses"}</span>`:`<span class="ap-atr ap-ok">Al día</span>`;
}

function apTabla(rows){
  if(!rows.length) return `<div class="empty">Nada para este filtro.</div>`;
  return `<table class="emp-table ap-table"><thead><tr>
    <th>Empresa</th><th>Bookkeeper</th><th>Prioridad</th><th>Última auditoría</th><th>Período auditado</th><th>Atraso</th><th>Estado</th><th class="r">Avance</th><th class="r">Puntos abiertos</th><th>Corrigió</th></tr></thead><tbody>
    ${rows.map(x=>{ const pct=x.filas?Math.round(x.hechas*100/x.filas):null;
      return `<tr>
      <td data-label="Empresa"><a href="#" class="aud-open" data-cid="${x.c.id}" title="Abrir el expediente">${esc(x.c.nombre)}</a></td>
      <td data-label="Bookkeeper">${esc(x.c.bookkeeper_default||"—")}</td>
      <td data-label="Prioridad"><span class="prio-badge prio-${prioSlug(x.prio)}">${esc(x.prio)}</span></td>
      <td data-label="Última auditoría">${x.run?`${apFecha(x.run.fecha)} <span class="muted">· ${esc(x.run.estado||"")}</span>`:"—"}</td>
      <td data-label="Período">${x.run?`${apFecha(x.run.periodo_desde)} – ${apFecha(x.run.periodo_hasta)}`:"—"}</td>
      <td data-label="Atraso">${apAtraso(x)}</td>
      <td data-label="Estado" class="ap-ests">${x.estados.map((e,i)=>apChip(e,i>0)).join(" ")}</td>
      <td data-label="Avance" class="r">${pct==null?"—":`<span class="mini-prog"><i style="width:${pct}%"></i></span>${x.hechas}/${x.filas}`}</td>
      <td data-label="Abiertos" class="r">${x.run?(x.abiertos||"—"):""}${x.nCli?` <span class="muted">(${x.nCli} cliente)</span>`:""}</td>
      <td data-label="Corrigió">${esc(x.quien||"—")}${x.ultimo?` <span class="muted">· ${apFecha(x.ultimo)}</span>`:""}</td></tr>`; }).join("")}
    </tbody></table>`;
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
      <div class="bk-stat"><span>Auditadas al día (${mesLabel(apObjetivo())})</span><b style="color:var(--menta)">${aldia}</b></div>
      <div class="bk-stat"><span>Atrasadas</span><b style="color:var(--amber)">${xs.filter(x=>x.run&&x.atraso).length}</b></div>
      <div class="bk-stat"><span>Sin auditar</span><b style="color:var(--red)">${xs.filter(x=>!x.run).length}</b></div>
      ${["Pendiente corrección","Mail al cliente","Consultar con Dennis","Mail a Dennis","Correcto"].map(e=>`<div class="bk-stat"><span>${e}</span><b style="color:${AP_EST[e].c}">${cnt(e)||"—"}</b></div>`).join("")}
      <div class="bk-cli-head">Empresas</div>
      <div class="bk-clientes">${apOrdenar(xs).map(x=>`<div class="bk-cli ${x.estado==="Correcto"&&!x.atraso?"done":""}"><a href="#" class="aud-open nm" data-cid="${x.c.id}">${esc(x.c.nombre)}</a><span class="st">${apChip(x.estado,true)}</span></div>`).join("")}</div></div>`; }).join("");
  const eq=[...equipo.entries()].sort((a,b)=>b[1].emp.size-a[1].emp.size);
  return `<h3 class="ap-h">Por bookkeeper de QuickBooks</h3><div class="bk-panel">${cards}</div>
    <div class="chart-card wide"><h3>Quién corrigió en la Revisión <span class="muted">· según los tildes de cada auditoría</span></h3>
    ${eq.length?`<table class="emp-table ap-table"><thead><tr><th>Persona</th><th class="r">Empresas</th><th>Último tilde</th><th>Empresas</th></tr></thead><tbody>
      ${eq.map(([q,o])=>`<tr><td><b>${esc(q)}</b></td><td class="r">${o.emp.size}</td><td>${apFecha(o.ult)}</td><td class="muted">${esc([...o.emp].sort().join(", "))}</td></tr>`).join("")}</tbody></table>`
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
  const K=[[`${pct}%`,`Al día con ${mesLabel(obj)}`,"var(--menta)","todas",pct],[aldia,"Auditadas al día","var(--menta)","todas"],
    [todas.filter(x=>x.run&&x.atraso).length,"Atrasadas","var(--amber)","atras"],[todas.filter(x=>!x.run).length,"Sin auditar","var(--red)","sin"],
    [cnt("Pendiente corrección"),"Pendiente corrección",AP_EST["Pendiente corrección"].c,"Pendiente corrección"],
    [cnt("Mail al cliente"),"Mail al cliente",AP_EST["Mail al cliente"].c,"Mail al cliente"],
    [cnt("Mail a Dennis"),"Mail a Dennis",AP_EST["Mail a Dennis"].c,"Mail a Dennis"],
    [cnt("Correcto"),"Correctas",AP_EST["Correcto"].c,"Correcto"]];
  const rows=apOrdenar(todas.filter(x=>apEnSub(x,AP.sub)));
  const ests=AP_ORDEN_EST;
  const cuerpo=AP.sub==="bk"?apPorBookkeeper(todas):AP.sub==="mes"?apMesAMes(apOrdenar(todas)):`<div class="chart-card wide">${apTabla(rows)}</div>`;
  $("#panel").innerHTML=`
    <div class="ap-kpis">${K.map(k=>`<div class="kpi${k[4]!=null?" kpi-prog":""}" data-ap-sub="${k[3]}"><div class="n" style="color:${k[2]}">${k[0]}</div><div class="l">${k[1]}</div>${k[4]!=null?`<div class="prog-track"><div class="prog-fill" style="width:${k[4]}%"></div></div>`:""}</div>`).join("")}</div>
    ${nav}
    <div class="ap-filtros">
      <select id="ap-prio"><option value="">Todas las prioridades</option>${PRIOS.map(p=>`<option ${AP.prio===p?"selected":""}>${p}</option>`).join("")}</select>
      <select id="ap-est"><option value="">Todos los estados</option>${ests.map(e=>`<option ${AP.est===e?"selected":""}>${e}</option>`).join("")}</select>
      <label class="muted">Ordenar <select id="ap-orden">${[["atraso","Más atrasadas primero"],["ultima","Última auditoría (más vieja)"],["estado","Estado"],["prio","Prioridad"],["bk","Bookkeeper"],["empresa","Empresa"]].map(o=>`<option value="${o[0]}" ${AP.orden===o[0]?"selected":""}>${o[1]}</option>`).join("")}</select></label>
      <span class="muted">${S.fbk?`Bookkeeper: <b>${esc(S.fbk)}</b> · `:""}${todas.length} empresas · objetivo: auditadas hasta ${mesLabel(obj)}</span>
      <span class="ap-acts"><button class="btn ghost sm" id="ap-csv">Exportar CSV</button><button class="btn ghost sm" id="ap-refresh" title="Volver a leer los expedientes">↻</button><button class="btn ghost sm" id="audit-exp">📁 Expedientes</button></span>
    </div>
    ${cuerpo}`;
  AP_SUBS.forEach(([k])=>{ const el=$(`[data-ap-cnt="${k}"]`); if(!el||["bk","mes","agenda"].includes(k)) return; const n=todas.filter(x=>apEnSub(x,k)).length; el.textContent=n?` ${n}`:""; });
  apBind(todas);
}
function apBind(todas){
  $$("[data-ap-sub]").forEach(b=>b.addEventListener("click",()=>{ AP.sub=b.dataset.apSub; renderView(); $("#content").scrollTop=0; }));
  $("#ap-login")?.addEventListener("click",apLogin);
  $("#ap-retry")?.addEventListener("click",()=>{ AP.err=""; apCargar(true); });
  $("#ap-refresh")?.addEventListener("click",()=>{ AP.datos=null; apCargar(true); renderView(); });
  $("#ap-prio")?.addEventListener("change",e=>{ AP.prio=e.target.value; renderView(); });
  $("#ap-est")?.addEventListener("change",e=>{ AP.est=e.target.value; renderView(); });
  $("#ap-orden")?.addEventListener("change",e=>{ AP.orden=e.target.value; renderView(); });
  $("#ap-csv")?.addEventListener("click",()=>{
    const q=(v)=>`"${String(v??"").replace(/"/g,'""')}"`;
    const L=[["Empresa","Bookkeeper","Prioridad","Ultima auditoria","Desde","Hasta","Atraso (meses)","Estado","Filas hechas","Filas","Puntos abiertos","Corrigio"].map(q).join(",")]
      .concat(apOrdenar(todas||[]).map(x=>[x.c.nombre,x.c.bookkeeper_default,x.prio,x.run?.fecha,x.run?.periodo_desde,x.run?.periodo_hasta,x.run?x.atraso:"Nunca",x.estados.join(" + "),x.hechas,x.filas,x.abiertos,x.quien].map(q).join(",")));
    const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob(["﻿"+L.join("\r\n")],{ type:"text/csv" })); a.download=`auditorias_${mesActual()}.csv`; a.click();
  });
}
