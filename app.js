"use strict";
const CFG = window.QB_CONFIG;
const ESTADOS = ["Reconciliado","Pendiente de Hacer","Pendiente de Acceso","Escalar","Falta Documentacion","Nueva Cuenta","Inactive"];
const EST_COLOR = {
  "Reconciliado":"#2ee6a6","Pendiente de Hacer":"#ffb23e","Pendiente de Acceso":"#5aa9ff",
  "Escalar":"#ff6b6b","Falta Documentacion":"#ffd05a","Nueva Cuenta":"#b98bff","Inactive":"#6c8296",
};
// Checklist simplificado
const BOOLS = [["conciliado","Conciliado"],["revisado","Revisado"],["memos_checks","Memos"]];
const BK_COLORS = ["#2ee6a6","#5aa9ff","#b98bff","#ffb23e","#ff86c8","#46d5e6","#ff6b6b","#ffd05a"];

const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];

const S = { pin:"", periodos:[], periodo_id:null, clientes:[], filas:[], view:"todo",
            q:"", fbk:"", ftipo:"", festado:"", bookkeepers:[], timer:null, lastSig:"" };

/* ---------------- API ---------------- */
async function api(action, extra={}){
  const res = await fetch(`${CFG.URL}/functions/v1/${CFG.FN}`,{
    method:"POST",
    headers:{ apikey:CFG.ANON, Authorization:"Bearer "+CFG.ANON, "Content-Type":"application/json" },
    body: JSON.stringify({ pin:S.pin, action, ...extra }),
  });
  const data = await res.json().catch(()=>({error:"respuesta inválida"}));
  if(!res.ok) throw new Error(data.error || ("HTTP "+res.status));
  return data;
}

/* ---------------- LOGIN ---------------- */
$("#gate-form").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const pin=$("#pin").value.trim(); const btn=$("#gate-btn"); const err=$("#gate-err");
  err.textContent=""; btn.disabled=true; btn.textContent="Entrando…";
  try{
    S.pin=pin; await api("login");
    (($("#remember").checked)?localStorage:sessionStorage).setItem("qb_pin", pin);
    startApp();
  }catch(ex){ S.pin=""; err.textContent=ex.message; btn.disabled=false; btn.textContent="Entrar"; }
});
function tryAutoLogin(){
  const pin=localStorage.getItem("qb_pin")||sessionStorage.getItem("qb_pin");
  if(pin){ S.pin=pin; api("login").then(startApp).catch(()=>{ S.pin=""; localStorage.removeItem("qb_pin"); sessionStorage.removeItem("qb_pin"); }); }
}
async function startApp(){ $("#gate").classList.add("hidden"); $("#app").classList.remove("hidden"); await load(); scheduleRefresh(); }
$("#btn-salir").addEventListener("click", ()=>{ localStorage.removeItem("qb_pin"); sessionStorage.removeItem("qb_pin"); clearTimeout(S.timer); location.reload(); });

/* ---------------- LOAD / REFRESH ---------------- */
async function load(){
  const d=await api("bootstrap",{ periodo_id:S.periodo_id });
  S.periodos=d.periodos; S.periodo_id=d.periodo_id; S.clientes=d.clientes; S.filas=d.filas;
  const set=new Set();
  d.clientes.forEach(c=>c.bookkeeper_default&&set.add(c.bookkeeper_default));
  d.filas.forEach(f=>f.bookkeeper&&set.add(f.bookkeeper));
  S.bookkeepers=[...set].sort();
  renderAll();
}
function sig(){ return S.filas.map(f=>f.conc_id+":"+f.actualizado_at+":"+(f.manual?1:0)).join("|"); }
function scheduleRefresh(){
  clearTimeout(S.timer);
  S.timer=setTimeout(async ()=>{
    try{
      const editing=document.activeElement&&document.activeElement.closest&&document.activeElement.closest(".grid");
      const modalOpen=!$("#modal").classList.contains("hidden");
      if(!editing&&!modalOpen){
        const d=await api("bootstrap",{ periodo_id:S.periodo_id });
        S.filas=d.filas; S.clientes=d.clientes;
        if(sig()!==S.lastSig) renderAll();
      }
    }catch(e){}
    scheduleRefresh();
  }, CFG.REFRESH_MS);
}

/* ---------------- RENDER ROOT ---------------- */
function renderAll(){
  S.lastSig=sig();
  renderPeriodos(); renderKPIs(); renderTabs(); renderView();
}
function renderView(){
  const grid=$("#grid"), panel=$("#panel"), empty=$("#empty");
  const isGrid = ["todo","pendientes","acceso","escalar","falta","nueva"].includes(S.view);
  grid.classList.toggle("hidden", !isGrid);
  panel.classList.toggle("hidden", isGrid);
  empty.classList.add("hidden");
  if(isGrid) renderGrid();
  else if(S.view==="bookkeeper") renderBookkeeper();
  else if(S.view==="empresa") renderEmpresa();
  else if(S.view==="graficos") renderGraficos();
}
// scope global (bookkeeper + tipo): mueve KPIs y gráficos a la persona elegida
function scope(){
  let f=S.filas.slice();
  if(S.ftipo) f=f.filter(x=>x.tipo===S.ftipo);
  if(S.fbk)   f=f.filter(x=>x.bookkeeper===S.fbk || (!x.bookkeeper && x.bookkeeper_default===S.fbk));
  return f;
}

function renderPeriodos(){
  const cur=S.periodos.find(p=>p.id===S.periodo_id);
  $("#periodo-label").textContent = cur ? "· "+cur.etiqueta : "";
  $("#sel-periodo").innerHTML = S.periodos.map(p=>`<option value="${p.id}" ${p.id===S.periodo_id?"selected":""}>${p.etiqueta}${p.activo?"":" (cerrado)"}</option>`).join("");
  $("#f-bk").innerHTML = `<option value="">Todos los bookkeepers</option>`+S.bookkeepers.map(b=>`<option ${b===S.fbk?"selected":""}>${b}</option>`).join("");
}

const activas = (l)=>l.filter(f=>f.estado!=="Inactive");
function stats(list){
  const act=activas(list);
  const by=(e)=>list.filter(x=>x.estado===e).length;
  const rec=by("Reconciliado");
  return { total:list.length, act:act.length, rec, pend:by("Pendiente de Hacer"),
    acc:by("Pendiente de Acceso"), esc:by("Escalar"),
    manual:list.filter(x=>x.manual).length,
    pct: act.length?Math.round(rec/act.length*100):0,
    clientes:new Set(list.map(x=>x.cliente_id)).size };
}

/* ---- KPIs clickeables ---- */
function renderKPIs(){
  const s=stats(scope());
  const K=[
    {n:s.pct+"%", l:"Avance del período", c:"var(--menta)", go:()=>nav("graficos"), prog:s.pct},
    {n:s.rec, l:"Reconciliadas", c:"var(--menta)", go:()=>{ S.festado="Reconciliado"; nav("todo"); }},
    {n:s.pend, l:"Pend. de Hacer", c:"var(--amber)", go:()=>nav("pendientes")},
    {n:s.acc, l:"Pend. de Acceso", c:"var(--blue)", go:()=>nav("acceso")},
    {n:s.esc, l:"Escalar", c:"var(--red)", go:()=>nav("escalar")},
    {n:s.act, l:"Cuentas activas", c:"var(--txt)", go:()=>{ S.festado=""; nav("todo"); }},
    {n:s.clientes, l:"Clientes", c:"var(--txt)", go:()=>nav("empresa")},
    {n:s.manual, l:"Cuentas manuales", c:"var(--violet)", go:()=>drillManuales()},
  ];
  const box=$("#kpis"); box.innerHTML="";
  K.forEach((k,i)=>{
    const el=document.createElement("div");
    el.className="kpi"+(k.prog!==undefined?" kpi-prog":"");
    el.innerHTML=`<div class="n" style="color:${k.c}">${k.n}</div><div class="l">${k.l}</div>`+
      (k.prog!==undefined?`<div class="prog-track"><div class="prog-fill" style="width:${k.prog}%"></div></div>`:"");
    el.addEventListener("click", k.go);
    box.appendChild(el);
  });
}
function nav(view){ S.view=view; renderAll(); $("#content").scrollTop=0; }

const VIEWS={ pendientes:"Pendiente de Hacer", acceso:"Pendiente de Acceso", escalar:"Escalar", falta:"Falta Documentacion", nueva:"Nueva Cuenta" };
function renderTabs(){
  $$("#tabs .tab").forEach(t=>{
    const v=t.dataset.view; t.classList.toggle("active", v===S.view);
    t.querySelector(".cnt")?.remove();
    if(VIEWS[v]){ const c=S.filas.filter(f=>f.estado===VIEWS[v]).length; if(c) t.insertAdjacentHTML("beforeend",` <span class="cnt">${c}</span>`); }
  });
}

function filtered(){
  let f=S.filas.slice();
  if(VIEWS[S.view]) f=f.filter(x=>x.estado===VIEWS[S.view]);
  if(S.festado)     f=f.filter(x=>x.estado===S.festado);
  if(S.ftipo)       f=f.filter(x=>x.tipo===S.ftipo);
  if(S.fbk)         f=f.filter(x=>x.bookkeeper===S.fbk || (!x.bookkeeper && x.bookkeeper_default===S.fbk));
  if(S.q){ const q=S.q.toLowerCase(); f=f.filter(x=>(x.cliente||"").toLowerCase().includes(q)||(x.cuenta||"").toLowerCase().includes(q)); }
  return f;
}

/* ---------------- GRILLA ---------------- */
function estadoSelect(f){
  return `<select class="est" data-e="${f.estado}" data-id="${f.conc_id}" data-field="estado">`+
    ESTADOS.map(e=>`<option ${e===f.estado?"selected":""}>${e}</option>`).join("")+`</select>`;
}
function bkSelect(f){
  const opts=[""].concat(S.bookkeepers); const cur=f.bookkeeper||"";
  if(cur&&!S.bookkeepers.includes(cur)) opts.push(cur);
  return `<select class="bk-sel" data-id="${f.conc_id}" data-field="bookkeeper">`+
    opts.map(b=>`<option value="${b}" ${b===cur?"selected":""}>${b||"—"}</option>`).join("")+`</select>`;
}
function renderGrid(){
  const head=`<tr>
    <th class="l">Cuenta</th><th>Tipo</th><th title="Cuenta manual (sin importar de QuickBooks)">Manual</th><th>Estado</th><th>Fecha</th><th class="l">Bookkeeper</th>
    ${BOOLS.map(b=>`<th>${b[1]}</th>`).join("")}<th class="l">Notas</th></tr>`;
  $("#grid thead").innerHTML=head;
  const f=filtered();
  const groups=new Map();
  f.forEach(x=>{ if(!groups.has(x.cliente_id)) groups.set(x.cliente_id,[]); groups.get(x.cliente_id).push(x); });
  const ncols=6+BOOLS.length+1; let html="";
  for(const [cid,rows] of groups){
    const c=rows[0]; const rec=rows.filter(r=>r.estado==="Reconciliado").length;
    const cliRow=S.clientes.find(x=>x.id===cid)||{};
    const comTip=(cliRow.comentarios||"").trim();
    html+=`<tr class="cli-row"><td class="l" colspan="${ncols}">
      <span class="cli-name">${esc(c.cliente)}</span>
      <span class="cli-badge">${esc(c.bookkeeper_default||"—")}</span>
      ${comTip?`<span class="cli-com-ic" title="${esc(comTip)}">💬</span>`:""}
      <span class="cli-count">${rec}/${rows.length} reconciliadas</span></td></tr>`;
    for(const r of rows){
      html+=`<tr data-id="${r.conc_id}">
        <td class="l cuenta">${esc(r.cuenta)}${r.manual?'<span class="man-tag" title="Cuenta manual">M</span>':''}</td>
        <td><span class="tipo-tag ${r.tipo==='Credit Card'?'cc':'bank'}">${r.tipo==='Credit Card'?'CC':'Bank'}</span></td>
        <td><input type="checkbox" class="manual-ck" data-cuenta="${r.cuenta_id}" data-cfield="manual" ${r.manual?"checked":""} title="Marcar como manual"></td>
        <td>${estadoSelect(r)}</td>
        <td><input type="date" class="fecha" data-id="${r.conc_id}" data-field="fecha_completado" value="${r.fecha_completado||""}"></td>
        <td class="l">${bkSelect(r)}</td>
        ${BOOLS.map(b=>`<td><input type="checkbox" data-id="${r.conc_id}" data-field="${b[0]}" ${r[b[0]]?"checked":""}></td>`).join("")}
        <td class="l"><input type="text" class="notas" data-id="${r.conc_id}" data-field="notas" value="${esc(r.notas||"")}" placeholder="…"></td>
      </tr>`;
    }
  }
  $("#grid tbody").innerHTML=html;
  $("#empty").classList.toggle("hidden", f.length>0);
}

/* ---------------- RESUMEN POR BOOKKEEPER (con empresas) ---------------- */
function renderBookkeeper(){
  const src=filtered();
  const byBk=new Map();
  src.forEach(f=>{ const bk=f.bookkeeper||f.bookkeeper_default||"(sin asignar)"; (byBk.get(bk)||byBk.set(bk,[]).get(bk)).push(f); });
  if(!src.length){ $("#panel").innerHTML=`<div class="empty">Sin resultados para “${esc(S.q)}”.</div>`; return; }
  let html=`<div class="bk-panel">`;
  const _hoy=todayStr();
  [...byBk.entries()].sort((a,b)=>b[1].length-a[1].length).forEach(([bk,rows],i)=>{
    const s=stats(rows); const col=BK_COLORS[i%BK_COLORS.length];
    const hoy=rows.filter(r=>r.estado==="Reconciliado"&&r.fecha_completado===_hoy).length;
    // empresas de este bookkeeper
    const cliMap=new Map();
    rows.forEach(r=>{ const k=r.cliente; const o=cliMap.get(k)||{tot:0,rec:0}; o.tot++; if(r.estado==="Reconciliado")o.rec++; cliMap.set(k,o); });
    // empresas primero las que faltan, después alfabético
    const clis=[...cliMap.entries()].sort((a,b)=>{ const da=a[1].rec===a[1].tot, db=b[1].rec===b[1].tot; if(da!==db) return da?1:-1; return a[0].localeCompare(b[0]); });
    const doneCli=clis.filter(([,o])=>o.rec===o.tot).length;
    html+=`<div class="bk-card">
      <h3><span>${esc(bk)}</span><span class="pct" style="color:${col}">${s.pct}%</span></h3>
      <div class="prog-track"><div class="prog-fill" style="width:${s.pct}%;background:${col}"></div></div>
      <div class="bk-stat" style="margin-top:8px"><span>Empresas</span><b>${cliMap.size}</b></div>
      <div class="bk-stat"><span>Cuentas activas</span><b>${s.act}</b></div>
      <div class="bk-stat"><span>Reconciliadas</span><b style="color:var(--menta)">${s.rec}</b></div>
      <div class="bk-stat"><span>Reconciliadas hoy</span><b style="color:${hoy?'var(--menta)':'var(--muted2)'}">${hoy||"—"}</b></div>
      <div class="bk-stat"><span>Pend. de Hacer</span><b style="color:var(--amber)">${s.pend}</b></div>
      <div class="bk-stat"><span>Pend. de Acceso</span><b style="color:var(--blue)">${s.acc}</b></div>
      <div class="bk-cli-head">Empresas <span>${doneCli}/${cliMap.size} listas</span></div>
      <div class="bk-clientes">${clis.map(([nm,o])=>`
        <div class="bk-cli ${o.rec===o.tot?'done':''}"><span class="nm">${esc(nm)}</span><span class="st">${o.rec}/${o.tot}</span></div>`).join("")}</div>
    </div>`;
  });
  html+=`</div>`;
  $("#panel").innerHTML=html;
}

/* ---------------- RESUMEN POR EMPRESA / CUENTA ---------------- */
function renderEmpresa(){
  const src=filtered();
  const groups=new Map();
  src.forEach(x=>{ if(!groups.has(x.cliente_id)) groups.set(x.cliente_id,[]); groups.get(x.cliente_id).push(x); });
  const arr=[...groups.values()].sort((a,b)=>a[0].cliente.localeCompare(b[0].cliente));
  if(!arr.length){ $("#panel").innerHTML=`<div class="empty">Sin resultados para “${esc(S.q)}”.</div>`; return; }
  let html=`<table class="emp-table"><thead><tr>
    <th>Empresa / Cuenta</th><th>Bookkeeper</th><th>Tipo</th><th>Estado</th>
    <th class="r">Avance</th></tr></thead><tbody>`;
  for(const rows of arr){
    const c=rows[0]; const s=stats(rows);
    const cli=S.clientes.find(x=>x.id===c.cliente_id)||{};
    const com=cli.comentarios||"";
    html+=`<tr class="emp-cli"><td>${esc(c.cliente)} <span class="muted" style="font-weight:400">· ${rows.length} cuentas</span></td>
      <td>${esc(c.bookkeeper_default||"—")}</td><td></td><td></td>
      <td class="r"><span class="mini-prog"><i style="width:${s.pct}%"></i></span>${s.pct}%</td></tr>`;
    html+=`<tr class="emp-com"><td colspan="5"><span class="com-ic">💬</span>
      <input class="cli-com" data-cid="${c.cliente_id}" value="${esc(com)}" placeholder="Comentario del cliente (se mantiene mes a mes, visible para el equipo)…"></td></tr>`;
    rows.sort((a,b)=>a.cuenta.localeCompare(b.cuenta)).forEach(r=>{
      html+=`<tr class="emp-acc"><td><span class="cuenta">${esc(r.cuenta)}</span></td>
        <td>${esc(r.bookkeeper||"—")}</td>
        <td>${r.tipo==="Credit Card"?"CC":"Bank"}</td>
        <td><span class="dot" style="background:${EST_COLOR[r.estado]||'#888'}"></span>${esc(r.estado)}</td>
        <td class="r">${r.conciliado?"✓":""}</td></tr>`;
    });
  }
  html+=`</tbody></table>`;
  $("#panel").innerHTML=html;
}

/* ---------------- DASHBOARD DE GRÁFICOS ---------------- */
function donut(segs, size=150){
  const tot=segs.reduce((a,s)=>a+s.value,0)||1; const r=size/2, ir=r*0.62; let a0=-Math.PI/2; let paths="";
  segs.forEach(s=>{ if(s.value<=0)return; const a1=a0+s.value/tot*Math.PI*2;
    const x0=r+r*Math.cos(a0), y0=r+r*Math.sin(a0), x1=r+r*Math.cos(a1), y1=r+r*Math.sin(a1);
    const xi1=r+ir*Math.cos(a1), yi1=r+ir*Math.sin(a1), xi0=r+ir*Math.cos(a0), yi0=r+ir*Math.sin(a0);
    const large=(a1-a0)>Math.PI?1:0;
    paths+=`<path d="M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1} L${xi1} ${yi1} A${ir} ${ir} 0 ${large} 0 ${xi0} ${yi0} Z" fill="${s.color}"/>`;
    a0=a1; });
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${paths}
    <text x="${r}" y="${r-2}" text-anchor="middle" fill="#e6eef5" font-size="22" font-weight="700">${tot}</text>
    <text x="${r}" y="${r+16}" text-anchor="middle" fill="#8ba0b3" font-size="10">total</text></svg>`;
}
function legend(segs, kind){
  return `<div class="legend">`+segs.filter(s=>s.value>0).map(s=>
    `<span ${kind?`class="drill" data-drill="${kind}" data-key="${esc(s.key||s.label)}"`:""}><i style="background:${s.color}"></i>${esc(s.label)} · ${s.value}</span>`).join("")+`</div>`;
}
function hbars(items){
  const max=Math.max(1,...items.map(i=>i.value));
  return items.map(i=>`<div class="hbar-row ${i.drill?'drill':''}" ${i.drill?`data-drill="${i.drill}" data-key="${esc(i.key)}"`:''}>
    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(i.label)}">${esc(i.label)}</div>
    <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(i.value/max*100)}%;background:${i.color||'#2ee6a6'}"></div></div>
    <div class="hbar-val">${i.sfx?i.value+i.sfx:i.value}</div></div>`).join("");
}
// barras verticales en HTML (sin distorsión), altura en px
function vbars(items, color="#2ee6a6", maxH=150){
  if(!items.length) return '<p class="muted">Sin datos todavía.</p>';
  const max=Math.max(1,...items.map(i=>i.value));
  return `<div class="vbars">`+items.map(i=>`
    <div class="vbar-col" title="${esc(i.label)}: ${i.value}">
      <div class="vbar-num">${i.value||""}</div>
      <div class="vbar" style="height:${Math.max(4,Math.round(i.value/max*maxH))}px;background:${color}"></div>
      <div class="vbar-lbl">${esc(i.label)}</div>
    </div>`).join("")+`</div>`;
}
// semana ISO -> etiqueta con la fecha del lunes (dd/mm)
function isoWeek(d){
  const dt=new Date(d+"T00:00:00"); const day=(dt.getDay()+6)%7;
  const monday=new Date(dt); monday.setDate(dt.getDate()-day);
  const th=new Date(monday); th.setDate(monday.getDate()+3);
  const first=new Date(th.getFullYear(),0,4);
  const wk=1+Math.round(((th-first)/86400000-3+((first.getDay()+6)%7))/7);
  const key=th.getFullYear()+"-W"+String(wk).padStart(2,"0");
  const label=String(monday.getDate()).padStart(2,"0")+"/"+String(monday.getMonth()+1).padStart(2,"0");
  return { key, label };
}
// helpers de día (fecha_completado viene como "YYYY-MM-DD")
function todayStr(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function dayLabel(d){ const p=String(d).split("-"); return p[2]+"/"+p[1]; }
const DIAS=["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
function dayName(d){ return DIAS[new Date(d+"T00:00:00").getDay()]; }
function bkOf(x){ return x.bookkeeper||x.bookkeeper_default||"(s/a)"; }

// barras verticales APILADAS por persona (una columna por día)
function vbarsStacked(cols, keys, colorOf, maxH=170){
  if(!cols.length) return '<p class="muted">Sin datos todavía.</p>';
  const max=Math.max(1,...cols.map(c=>c.total));
  return `<div class="vbars stacked">`+cols.map(c=>{
    const segs=keys.filter(k=>c.by[k]).map(k=>{
      const h=Math.max(3,Math.round(c.by[k]/max*maxH));
      return `<div class="vseg" style="height:${h}px;background:${colorOf(k)}" title="${esc(k)}: ${c.by[k]} el ${esc(c.label)}"></div>`;
    }).join("");
    return `<div class="vbar-col" title="${esc(c.sub)} ${esc(c.label)}: ${c.total} reconciliadas">
      <div class="vbar-num">${c.total||""}</div>
      <div class="vstack" style="height:${maxH}px">${segs}</div>
      <div class="vbar-lbl"><b>${esc(c.sub)}</b><br>${esc(c.label)}</div>
    </div>`;
  }).join("")+`</div>`;
}
// matriz persona × día con totales
function matrixTable(rows, days, dayTotals, grandTotal){
  if(!rows.length) return '<p class="muted">Sin fechas de conciliación cargadas todavía.</p>';
  const head=`<tr><th class="l">Persona</th>${days.map(d=>`<th title="${esc(d)}"><span class="mx-dn">${dayName(d)}</span><span class="mx-df">${dayLabel(d)}</span></th>`).join("")}<th class="mx-tot">Hoy</th><th class="mx-tot">Total</th></tr>`;
  const body=rows.map(r=>`<tr>
    <td class="l"><span class="dot" style="background:${r.color}"></span>${esc(r.bk)}</td>
    ${r.cells.map(c=>`<td class="${c?'':'z'}">${c||"·"}</td>`).join("")}
    <td class="mx-tot ${r.hoy?'hot':''}">${r.hoy||"·"}</td>
    <td class="mx-tot"><b>${r.total}</b></td></tr>`).join("");
  const foot=`<tr class="mx-foot"><td class="l">Total del día</td>${dayTotals.map(t=>`<td>${t||"·"}</td>`).join("")}<td class="mx-tot"></td><td class="mx-tot"><b>${grandTotal}</b></td></tr>`;
  return `<div class="mx-wrap"><table class="mx-table"><tbody>${head}${body}${foot}</tbody></table></div>`;
}

function renderGraficos(){
  const f=scope();
  // 1) estados
  const estSeg=ESTADOS.map(e=>({label:e,value:f.filter(x=>x.estado===e).length,color:EST_COLOR[e]}));
  // 2) tipo
  const tipoSeg=[{label:"Bank",value:f.filter(x=>x.tipo==="Bank").length,color:"#5aa9ff"},
                 {label:"Credit Card",value:f.filter(x=>x.tipo==="Credit Card").length,color:"#b98bff"}];
  // color estable por bookkeeper (se reutiliza en todos los gráficos)
  const allBk=[...new Set(f.map(bkOf))].sort();
  const bkColor={}; allBk.forEach((b,i)=>bkColor[b]=BK_COLORS[i%BK_COLORS.length]);
  // 3) avance por bookkeeper
  const byBk=new Map(); f.forEach(x=>{ const b=bkOf(x); (byBk.get(b)||byBk.set(b,[]).get(b)).push(x); });
  const bkBars=[...byBk.entries()].map(([b,rows])=>{ const s=stats(rows); return {label:`${b} · ${s.rec}/${s.act}`,value:s.pct,sfx:"%",color:bkColor[b],drill:"bookkeeper",key:b}; }).sort((a,b)=>b.value-a.value);
  // 4) reconciliadas POR DÍA y POR PERSONA (fecha_completado)
  const doneRec=f.filter(x=>x.estado==="Reconciliado"&&x.fecha_completado);
  const daySet=[...new Set(doneRec.map(x=>x.fecha_completado))].sort();
  const days=daySet.slice(-12);
  const dayBkList=allBk.filter(b=>doneRec.some(x=>bkOf(x)===b));
  const dayCols=days.map(d=>{ const by={}; let total=0;
    doneRec.forEach(x=>{ if(x.fecha_completado===d){ const b=bkOf(x); by[b]=(by[b]||0)+1; total++; } });
    return { key:d, label:dayLabel(d), sub:dayName(d), by, total }; });
  const dayTotals=days.map(d=>doneRec.filter(x=>x.fecha_completado===d).length);
  const _hoy=todayStr();
  const matrixRows=dayBkList.map(b=>({
    bk:b, color:bkColor[b],
    cells: days.map(d=>doneRec.filter(x=>x.fecha_completado===d&&bkOf(x)===b).length),
    hoy: doneRec.filter(x=>x.fecha_completado===_hoy&&bkOf(x)===b).length,
    total: doneRec.filter(x=>bkOf(x)===b).length,
  })).sort((a,b)=>b.total-a.total);
  const dayLegend=`<div class="legend">`+dayBkList.map(b=>`<span class="drill" data-drill="bookkeeper" data-key="${esc(b)}"><i style="background:${bkColor[b]}"></i>${esc(b)} · ${doneRec.filter(x=>bkOf(x)===b).length}</span>`).join("")+`</div>`;
  // 5) clientes terminados
  const cliMap=new Map(); f.forEach(x=>{ const o=cliMap.get(x.cliente_id)||{tot:0,rec:0,inact:0}; o.tot++; if(x.estado==="Reconciliado")o.rec++; if(x.estado==="Inactive")o.inact++; cliMap.set(x.cliente_id,o); });
  let cliDone=0,cliParcial=0,cliCero=0;
  cliMap.forEach(o=>{ const activ=o.tot-o.inact; if(activ>0&&o.rec>=activ)cliDone++; else if(o.rec>0)cliParcial++; else cliCero++; });
  const cliSeg=[{label:"Terminados",value:cliDone,color:"#2ee6a6",key:"terminados"},{label:"En curso",value:cliParcial,color:"#ffb23e",key:"encurso"},{label:"Sin arrancar",value:cliCero,color:"#ff6b6b",key:"cero"}];
  // 6) top clientes por # cuentas
  const cntMap=new Map(); f.forEach(x=>cntMap.set(x.cliente,(cntMap.get(x.cliente)||0)+1));
  const topCli=[...cntMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([l,v])=>({label:l,value:v,color:"#46d5e6",drill:"cliente",key:l}));
  // 7) checklist (conciliado/revisado/memos)
  const chk=BOOLS.map((b,i)=>({label:b[1],value:f.filter(x=>x[b[0]]).length,color:BK_COLORS[i],drill:"check",key:b[0]}));
  // 8) avance por período (histórico) — usa el actual; si hubiera más, se agregan
  const curP=S.periodos.find(p=>p.id===S.periodo_id);
  const perBars=[{label:curP?curP.etiqueta.slice(2):"actual",value:stats(f).pct,sfx:"%",color:"#2ee6a6"}];

  const banner = S.fbk ? `<div class="scope-banner">Mostrando datos de <b>${esc(S.fbk)}</b> · <a href="#" id="scope-clear">ver todos</a></div>` : "";
  $("#panel").innerHTML=banner+`<div class="charts">
    <div class="chart-card"><h3>Estado de las cuentas</h3>
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">${donut(estSeg)}<div style="flex:1;min-width:150px">${legend(estSeg,'estado')}</div></div></div>

    <div class="chart-card"><h3>Cuentas por tipo</h3>
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">${donut(tipoSeg)}<div style="flex:1;min-width:120px">${legend(tipoSeg,'tipo')}</div></div></div>

    <div class="chart-card"><h3>Clientes terminados</h3>
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <div><div class="big-stat">${cliDone}</div><div class="big-sub">de ${cliMap.size} clientes</div></div>
        <div style="flex:1;min-width:140px">${legend(cliSeg,'cliente-bucket')}</div></div></div>

    <div class="chart-card wide"><h3>Avance por bookkeeper</h3>${hbars(bkBars)}</div>

    <div class="chart-card wide"><h3>Reconciliadas por día — por persona</h3>
      ${dayCols.length?vbarsStacked(dayCols,dayBkList,b=>bkColor[b])+dayLegend
        :'<p class="muted">Sin fechas de conciliación cargadas todavía. Cargá la <b>Fecha</b> al reconciliar cada cuenta para ver el trabajo por día.</p>'}</div>

    <div class="chart-card wide"><h3>Detalle diario por persona <span class="muted" style="font-weight:400;font-size:12px">· últimos ${days.length||0} días con actividad</span></h3>
      ${matrixTable(matrixRows,days,dayTotals,doneRec.length)}</div>

    <div class="chart-card"><h3>Checklist completado</h3>${hbars(chk.map(c=>({...c})))}</div>

    <div class="chart-card"><h3>Avance por mes</h3>${vbars(perBars.map(p=>({label:p.label,value:p.value})),"#2ee6a6",130)}
      <p class="muted" style="margin-top:6px">Cada mes nuevo suma una barra acá.</p></div>

    <div class="chart-card wide"><h3>Top 10 clientes por # de cuentas</h3>${hbars(topCli)}</div>
  </div>`;
  const sc=$("#scope-clear"); if(sc) sc.addEventListener("click",(e)=>{ e.preventDefault(); S.fbk=""; renderAll(); });
}

/* ---------------- EDICIÓN INLINE ---------------- */
$("#grid").addEventListener("change", onEdit);
$("#grid").addEventListener("keydown",(e)=>{ if(e.key==="Enter"&&e.target.classList.contains("notas")) e.target.blur(); });
async function onEdit(e){
  const el=e.target;
  if(el.dataset.cuenta && el.dataset.cfield) return onEditCuenta(el);
  const id=el.dataset.id, field=el.dataset.field; if(!id||!field) return;
  let val = el.type==="checkbox" ? el.checked : (field==="fecha_completado" ? (el.value||null) : el.value);
  const td=el.closest("td"); td?.classList.add("saving");
  try{
    await api("update_conc",{ id:Number(id), patch:{ [field]:val } });
    const fila=S.filas.find(f=>f.conc_id==id);
    if(fila){ fila[field]=val; fila.actualizado_at=new Date().toISOString();
      // conciliar auto-marca estado Reconciliado si tildan Conciliado
      if(field==="conciliado"&&val===true&&fila.estado!=="Reconciliado"){
        fila.estado="Reconciliado"; await api("update_conc",{id:Number(id),patch:{estado:"Reconciliado"}});
        const selEl=$(`select.est[data-id="${id}"]`); if(selEl){ selEl.value="Reconciliado"; selEl.dataset.e="Reconciliado"; }
      }
    }
    if(field==="estado"){ el.dataset.e=val; }
    renderKPIs(); renderTabs();
    if(field==="estado"&&VIEWS[S.view]) renderGrid();
    toast("Guardado ✓");
  }catch(ex){ toast(ex.message,true); }
  finally{ td?.classList.remove("saving"); S.lastSig=sig(); }
}
// edición a nivel CUENTA (ej: marca MANUAL) → tabla qb_cuentas
async function onEditCuenta(el){
  const cid=el.dataset.cuenta, field=el.dataset.cfield;
  const val = el.type==="checkbox" ? el.checked : el.value;
  const td=el.closest("td"); td?.classList.add("saving");
  try{
    await api("update_cuenta",{ id:Number(cid), patch:{ [field]:val } });
    S.filas.forEach(f=>{ if(f.cuenta_id==cid) f[field]=val; });
    const tag=el.closest("tr")?.querySelector(".cuenta");
    if(tag && field==="manual"){ tag.querySelector(".man-tag")?.remove();
      if(val) tag.insertAdjacentHTML("beforeend",'<span class="man-tag" title="Cuenta manual">M</span>'); }
    renderKPIs();
    toast("Guardado ✓");
  }catch(ex){ toast(ex.message,true); }
  finally{ td?.classList.remove("saving"); S.lastSig=sig(); }
}

/* ---------------- FILTROS / TABS ---------------- */
$("#tabs").addEventListener("click",(e)=>{ const t=e.target.closest(".tab"); if(!t)return; S.festado=""; nav(t.dataset.view); });
$("#q").addEventListener("input",(e)=>{ S.q=e.target.value; renderView(); });
$("#f-bk").addEventListener("change",(e)=>{ S.fbk=e.target.value; renderAll(); });
$("#f-tipo").addEventListener("change",(e)=>{ S.ftipo=e.target.value; renderAll(); });
$("#sel-periodo").addEventListener("change", async (e)=>{ S.periodo_id=Number(e.target.value); await load(); });
$("#btn-refresh").addEventListener("click", async ()=>{ await load(); toast("Actualizado ✓"); });

/* ---------------- COMENTARIOS por cliente ---------------- */
$("#panel").addEventListener("change", async (e)=>{
  const el=e.target; if(!el.classList.contains("cli-com")) return;
  const cid=Number(el.dataset.cid), val=el.value.trim();
  el.closest("td")?.classList.add("saving");
  try{
    await api("update_cliente",{ id:cid, patch:{ comentarios:val } });
    const cli=S.clientes.find(x=>x.id===cid); if(cli) cli.comentarios=val;
    toast("Comentario guardado ✓");
  }catch(ex){ toast(ex.message,true); }
  finally{ el.closest("td")?.classList.remove("saving"); }
});

/* ---------------- DRILL-DOWN desde los gráficos ---------------- */
$("#panel").addEventListener("click",(e)=>{
  const el=e.target.closest("[data-drill]"); if(!el) return;
  const kind=el.dataset.drill, key=el.dataset.key;
  if(kind==="bookkeeper"){ S.fbk=key; renderAll(); return; }   // barra bookkeeper → filtra a esa persona
  const f=scope();
  if(kind==="cliente-bucket"){
    const m=new Map();
    f.forEach(x=>{ const o=m.get(x.cliente_id)||{nm:x.cliente,bk:x.bookkeeper_default,tot:0,rec:0,inact:0};
      o.tot++; if(x.estado==="Reconciliado")o.rec++; if(x.estado==="Inactive")o.inact++; m.set(x.cliente_id,o); });
    const arr=[...m.values()].filter(o=>{ const activ=o.tot-o.inact;
      if(key==="terminados") return activ>0&&o.rec>=activ;
      if(key==="encurso")    return o.rec>0&&!(activ>0&&o.rec>=activ);
      return o.rec===0; }).sort((a,b)=>a.nm.localeCompare(b.nm));
    const titles={terminados:"Clientes terminados",encurso:"Clientes en curso",cero:"Clientes sin arrancar"};
    drillList(titles[key], arr.map(o=>`<span class="di-l"><b>${esc(o.nm)}</b> <span class="muted">${esc(o.bk||"—")}</span></span><span class="muted">${o.rec}/${o.tot-o.inact}</span>`));
    return;
  }
  let rows=[], title="";
  if(kind==="estado"){ title=`Cuentas · ${key}`; rows=f.filter(x=>x.estado===key); }
  else if(kind==="tipo"){ title=`Cuentas · ${key}`; rows=f.filter(x=>x.tipo===key); }
  else if(kind==="check"){ const lbl=(BOOLS.find(b=>b[0]===key)||[0,key])[1]; title=`${lbl} ✓`; rows=f.filter(x=>x[key]); }
  else if(kind==="cliente"){ title=key; rows=f.filter(x=>x.cliente===key); }
  rows.sort((a,b)=>a.cliente.localeCompare(b.cliente)||a.cuenta.localeCompare(b.cuenta));
  drillList(title, rows.map(x=>`<span class="di-l"><b>${esc(x.cuenta)}</b> <span class="muted">${esc(x.cliente)}</span></span><span class="di-r"><span class="dot" style="background:${EST_COLOR[x.estado]||'#888'}"></span>${esc(x.estado)}</span>`));
});
function drillList(title, lines){
  openModal(`${title} · ${lines.length}`,
    `<div class="drill-list">${lines.length?lines.map(l=>`<div class="drill-item">${l}</div>`).join(""):'<p class="muted">Nada acá.</p>'}</div>`);
}
function drillManuales(){
  const rows=scope().filter(x=>x.manual).sort((a,b)=>a.cliente.localeCompare(b.cliente)||a.cuenta.localeCompare(b.cuenta));
  drillList("Cuentas manuales (sin importar de QuickBooks)",
    rows.map(x=>`<span class="di-l"><b>${esc(x.cuenta)}</b> <span class="muted">${esc(x.cliente)}</span></span>`+
      `<span class="di-r"><span class="dot" style="background:${EST_COLOR[x.estado]||'#888'}"></span>${esc(x.estado)}</span>`));
}

/* ---------------- MODALES ---------------- */
function openModal(t,b){ $("#modal-title").textContent=t; $("#modal-body").innerHTML=b; $("#modal").classList.remove("hidden"); }
function closeModal(){ $("#modal").classList.add("hidden"); }
$("#modal-x").addEventListener("click", closeModal);
$("#modal").addEventListener("click",(e)=>{ if(e.target.id==="modal") closeModal(); });

$("#btn-add-cuenta").addEventListener("click", ()=>{
  const cliOpts=S.clientes.map(c=>`<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
  const bkOpts=[""].concat(S.bookkeepers).map(b=>`<option value="${b}">${b||"—"}</option>`).join("");
  openModal("Agregar cliente / cuenta",`
    <label>Cliente existente</label>
    <select id="m-cli"><option value="">— nuevo cliente —</option>${cliOpts}</select>
    <div id="m-newcli"><label>Nombre del cliente nuevo</label><input id="m-clinombre" placeholder="Razón social">
      <label>Bookkeeper asignado</label><select id="m-clibk">${bkOpts}</select></div>
    <hr style="border-color:var(--line);margin:16px 0">
    <div class="row2"><div><label>Nombre de la cuenta</label><input id="m-cuenta" placeholder="Ej: Chase 1234"></div>
      <div><label>Tipo</label><select id="m-tipo"><option>Bank</option><option>Credit Card</option></select></div></div>
    <label class="chk-line"><input type="checkbox" id="m-manual"> Cuenta <b>manual</b> (se concilia a mano, sin importar de QuickBooks)</label>
    <div class="modal-actions"><button class="btn ghost" id="m-cancel">Cancelar</button><button class="btn primary" id="m-save">Guardar</button></div>`);
  const toggle=()=>{ $("#m-newcli").style.display=$("#m-cli").value?"none":"block"; };
  $("#m-cli").addEventListener("change",toggle); toggle();
  $("#m-cancel").addEventListener("click",closeModal);
  $("#m-save").addEventListener("click",saveCuenta);
});
async function saveCuenta(){
  const cuenta=$("#m-cuenta").value.trim(); if(!cuenta) return toast("Falta el nombre de la cuenta",true);
  try{
    let cliente_id=$("#m-cli").value;
    if(!cliente_id){ const nombre=$("#m-clinombre").value.trim(); if(!nombre) return toast("Falta el nombre del cliente",true);
      const r=await api("add_cliente",{ nombre, bookkeeper_default:$("#m-clibk").value||null }); cliente_id=r.cliente.id; }
    await api("add_cuenta",{ cliente_id:Number(cliente_id), nombre:cuenta, tipo:$("#m-tipo").value, manual:$("#m-manual").checked, periodo_id:S.periodo_id });
    closeModal(); await load(); toast("Cuenta agregada ✓");
  }catch(ex){ toast(ex.message,true); }
}

$("#btn-nuevo-periodo").addEventListener("click", ()=>{
  const now=new Date(), y=now.getFullYear(), m=String(now.getMonth()+1).padStart(2,"0");
  openModal("Nuevo mes",`
    <p class="muted">El mes actual queda <b>guardado</b> tal cual está, y se abre uno nuevo arrastrando todas las cuentas activas en <b>Pendiente de Hacer</b>.</p>
    <div class="row2"><div><label>Etiqueta</label><input id="m-etq" value="${y}-${m}"></div>
      <div><label>Fecha (1° del mes)</label><input type="date" id="m-fec" value="${y}-${m}-01"></div></div>
    <div class="modal-actions"><button class="btn ghost" id="m-cancel">Cancelar</button><button class="btn primary" id="m-save">Crear mes</button></div>`);
  $("#m-cancel").addEventListener("click",closeModal);
  $("#m-save").addEventListener("click", async ()=>{
    try{ const r=await api("new_periodo",{ etiqueta:$("#m-etq").value.trim(), fecha:$("#m-fec").value });
      S.periodo_id=r.periodo.id; closeModal(); await load(); toast("Mes creado ✓"); }
    catch(ex){ toast(ex.message,true); }
  });
});

$("#btn-pin").addEventListener("click", ()=>{
  openModal("Cambiar PIN",`
    <label>Nuevo PIN (mín. 4 caracteres)</label><input id="m-pin" type="text" placeholder="nuevo PIN">
    <p class="muted" style="margin-top:8px">Se aplica a todos. Avisales el nuevo PIN a los chicos.</p>
    <div class="modal-actions"><button class="btn ghost" id="m-cancel">Cancelar</button><button class="btn primary" id="m-save">Cambiar</button></div>`);
  $("#m-cancel").addEventListener("click",closeModal);
  $("#m-save").addEventListener("click", async ()=>{
    const np=$("#m-pin").value.trim(); if(np.length<4) return toast("PIN muy corto",true);
    try{ await api("set_pin",{ new_pin:np }); S.pin=np;
      (localStorage.getItem("qb_pin")?localStorage:sessionStorage).setItem("qb_pin",np);
      closeModal(); toast("PIN cambiado ✓"); }
    catch(ex){ toast(ex.message,true); }
  });
});

/* ---------------- EXPORT CSV ---------------- */
$("#btn-export").addEventListener("click", ()=>{
  const f=(["todo","pendientes","acceso","escalar","falta","nueva"].includes(S.view))?filtered():S.filas;
  const cols=["cliente","cuenta","tipo","manual","estado","fecha_completado","bookkeeper",...BOOLS.map(b=>b[0]),"notas"];
  const head=["Cliente","Cuenta","Tipo","Manual","Estado","Fecha","Bookkeeper",...BOOLS.map(b=>b[1]),"Notas"];
  const csv=[head.join(",")].concat(f.map(r=>cols.map(c=>{
    let v=r[c]; if(typeof v==="boolean") v=v?"SI":""; v=v==null?"":String(v);
    return `"${v.replace(/"/g,'""')}"`; }).join(","))).join("\r\n");
  const cur=S.periodos.find(p=>p.id===S.periodo_id);
  const blob=new Blob(["﻿"+csv],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download=`QB_Dashboard_${cur?cur.etiqueta:"periodo"}.csv`; a.click();
});

/* ---------------- utils ---------------- */
function esc(s){ return String(s).replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m])); }
let toastT;
function toast(msg,err=false){ const t=$("#toast"); t.textContent=msg; t.className="toast show"+(err?" err":""); clearTimeout(toastT); toastT=setTimeout(()=>t.className="toast",1800); }

tryAutoLogin();
