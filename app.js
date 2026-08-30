"use strict";
const CFG = window.QB_CONFIG;
const ESTADOS = ["Reconciliado","Pendiente de Hacer","Pendiente de Acceso","Escalar","Falta Documentacion","Nueva Cuenta","Inactive"];
const BOOLS = [
  ["doc_payroll","Doc"],["junior_input","Jr"],["auto_review","Auto"],["claude_review","Claude"],
  ["senior_review","Sr"],["memos_checks","Memos"],
  ["analisis_payroll","A.Pay"],["analisis_pl","A.P&L"],["analisis_balance","A.Bal"],["analisis_ventas","A.Vta"],
];
const $ = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];

const S = { pin:"", periodos:[], periodo_id:null, clientes:[], filas:[], view:"todo",
            q:"", fbk:"", ftipo:"", bookkeepers:[], timer:null, lastSig:"" };

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
  const pin = $("#pin").value.trim();
  const btn = $("#gate-btn"); const err = $("#gate-err");
  err.textContent=""; btn.disabled=true; btn.textContent="Entrando…";
  try{
    S.pin = pin;
    await api("login");
    if($("#remember").checked) localStorage.setItem("qb_pin", pin);
    else sessionStorage.setItem("qb_pin", pin);
    startApp();
  }catch(ex){
    S.pin=""; err.textContent = ex.message; btn.disabled=false; btn.textContent="Entrar";
  }
});

function tryAutoLogin(){
  const pin = localStorage.getItem("qb_pin") || sessionStorage.getItem("qb_pin");
  if(pin){ S.pin=pin; api("login").then(startApp).catch(()=>{ S.pin=""; localStorage.removeItem("qb_pin"); sessionStorage.removeItem("qb_pin"); }); }
}

async function startApp(){
  $("#gate").classList.add("hidden");
  $("#app").classList.remove("hidden");
  await load();
  scheduleRefresh();
}

$("#btn-salir").addEventListener("click", ()=>{
  localStorage.removeItem("qb_pin"); sessionStorage.removeItem("qb_pin");
  clearTimeout(S.timer); location.reload();
});

/* ---------------- LOAD ---------------- */
async function load(){
  const d = await api("bootstrap", { periodo_id:S.periodo_id });
  S.periodos = d.periodos; S.periodo_id = d.periodo_id; S.clientes = d.clientes; S.filas = d.filas;
  const set = new Set();
  d.clientes.forEach(c=>c.bookkeeper_default && set.add(c.bookkeeper_default));
  d.filas.forEach(f=>f.bookkeeper && set.add(f.bookkeeper));
  S.bookkeepers = [...set].sort();
  renderAll();
}

function scheduleRefresh(){
  clearTimeout(S.timer);
  S.timer = setTimeout(async ()=>{
    try{
      const editing = document.activeElement && document.activeElement.closest && document.activeElement.closest(".grid");
      const modalOpen = !$("#modal").classList.contains("hidden");
      if(!editing && !modalOpen){
        const d = await api("bootstrap", { periodo_id:S.periodo_id });
        const sig = d.filas.map(f=>f.conc_id+":"+f.actualizado_at).join("|");
        if(sig !== S.lastSig){ S.filas=d.filas; S.clientes=d.clientes; renderAll(); }
      }
    }catch(e){}
    scheduleRefresh();
  }, CFG.REFRESH_MS);
}

/* ---------------- RENDER ---------------- */
function renderAll(){
  S.lastSig = S.filas.map(f=>f.conc_id+":"+f.actualizado_at).join("|");
  renderPeriodos(); renderKPIs(); renderTabs();
  if(S.view==="bookkeeper") renderBookkeeper(); else renderGrid();
}

function renderPeriodos(){
  const cur = S.periodos.find(p=>p.id===S.periodo_id);
  $("#periodo-label").textContent = cur ? "· "+cur.etiqueta : "";
  const sel = $("#sel-periodo");
  sel.innerHTML = S.periodos.map(p=>`<option value="${p.id}" ${p.id===S.periodo_id?"selected":""}>${p.etiqueta}</option>`).join("");
  const fbk = $("#f-bk");
  fbk.innerHTML = `<option value="">Todos los bookkeepers</option>`+S.bookkeepers.map(b=>`<option ${b===S.fbk?"selected":""}>${b}</option>`).join("");
}

function activas(list){ return list.filter(f=>f.estado!=="Inactive"); }
function renderKPIs(){
  const f=S.filas, act=activas(f);
  const rec=f.filter(x=>x.estado==="Reconciliado").length;
  const pend=f.filter(x=>x.estado==="Pendiente de Hacer").length;
  const acc=f.filter(x=>x.estado==="Pendiente de Acceso").length;
  const esc=f.filter(x=>x.estado==="Escalar").length;
  const pct= act.length? Math.round(rec/act.length*100):0;
  const clientes=new Set(f.map(x=>x.cliente_id)).size;
  $("#kpis").innerHTML = `
    <div class="kpi accent kpi-prog"><div class="n">${pct}%</div><div class="l">Avance del período</div>
      <div class="prog-track"><div class="prog-fill" style="width:${pct}%"></div></div></div>
    <div class="kpi"><div class="n" style="color:var(--menta)">${rec}</div><div class="l">Reconciliadas</div></div>
    <div class="kpi"><div class="n" style="color:var(--amber)">${pend}</div><div class="l">Pend. de Hacer</div></div>
    <div class="kpi"><div class="n" style="color:var(--blue)">${acc}</div><div class="l">Pend. de Acceso</div></div>
    <div class="kpi"><div class="n" style="color:var(--red)">${esc}</div><div class="l">Escalar</div></div>
    <div class="kpi"><div class="n">${act.length}</div><div class="l">Cuentas activas</div></div>
    <div class="kpi"><div class="n">${clientes}</div><div class="l">Clientes</div></div>`;
}

const VIEWS={ pendientes:"Pendiente de Hacer", acceso:"Pendiente de Acceso", escalar:"Escalar",
             falta:"Falta Documentacion", nueva:"Nueva Cuenta" };
function renderTabs(){
  $$("#tabs .tab").forEach(t=>{
    const v=t.dataset.view; t.classList.toggle("active", v===S.view);
    let cnt="";
    if(VIEWS[v]) cnt=S.filas.filter(f=>f.estado===VIEWS[v]).length;
    if(cnt!=="" ) t.querySelector(".cnt")?.remove(), t.insertAdjacentHTML("beforeend", cnt?` <span class="cnt">${cnt}</span>`:"");
  });
}

function filtered(){
  let f=S.filas.slice();
  if(VIEWS[S.view]) f=f.filter(x=>x.estado===VIEWS[S.view]);
  if(S.ftipo) f=f.filter(x=>x.tipo===S.ftipo);
  if(S.fbk) f=f.filter(x=>x.bookkeeper===S.fbk || (!x.bookkeeper && x.bookkeeper_default===S.fbk));
  if(S.q){ const q=S.q.toLowerCase(); f=f.filter(x=>(x.cliente||"").toLowerCase().includes(q)||(x.cuenta||"").toLowerCase().includes(q)); }
  return f;
}

function estadoSelect(f){
  return `<select class="est" data-e="${f.estado}" data-id="${f.conc_id}" data-field="estado">`+
    ESTADOS.map(e=>`<option ${e===f.estado?"selected":""}>${e}</option>`).join("")+`</select>`;
}
function bkSelect(f){
  const opts=[""].concat(S.bookkeepers);
  const cur=f.bookkeeper||"";
  if(cur && !S.bookkeepers.includes(cur)) opts.push(cur);
  return `<select class="bk-sel" data-id="${f.conc_id}" data-field="bookkeeper">`+
    opts.map(b=>`<option value="${b}" ${b===cur?"selected":""}>${b||"—"}</option>`).join("")+`</select>`;
}

function renderGrid(){
  $(".bk-panel")?.remove();
  $("#grid").classList.remove("hidden");
  const head=`<tr>
    <th class="l">Cuenta</th><th>Tipo</th><th>Estado</th><th>Fecha</th><th class="l">Bookkeeper</th>
    ${BOOLS.map(b=>`<th>${b[1]}</th>`).join("")}<th class="l">Notas</th></tr>`;
  $("#grid thead").innerHTML=head;

  const f=filtered();
  // agrupar por cliente
  const groups=new Map();
  f.forEach(x=>{ if(!groups.has(x.cliente_id)) groups.set(x.cliente_id,[]); groups.get(x.cliente_id).push(x); });
  const ncols = 5 + BOOLS.length + 1;
  let html="";
  for(const [cid,rows] of groups){
    const c=rows[0];
    const rec=rows.filter(r=>r.estado==="Reconciliado").length;
    html+=`<tr class="cli-row"><td class="l" colspan="${ncols}">
      <span class="cli-name">${esc(c.cliente)}</span>
      <span class="cli-badge">${esc(c.bookkeeper_default||"—")}</span>
      <span class="cli-count">${rec}/${rows.length} reconciliadas</span></td></tr>`;
    for(const r of rows){
      html+=`<tr data-id="${r.conc_id}">
        <td class="l cuenta">${esc(r.cuenta)}</td>
        <td><span class="tipo-tag ${r.tipo==='Credit Card'?'cc':'bank'}">${r.tipo==='Credit Card'?'CC':'Bank'}</span></td>
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

function renderBookkeeper(){
  $("#grid").classList.add("hidden");
  $("#empty").classList.add("hidden");
  $(".bk-panel")?.remove();
  const byBk=new Map();
  S.filas.forEach(f=>{
    const bk=f.bookkeeper||f.bookkeeper_default||"(sin asignar)";
    if(!byBk.has(bk)) byBk.set(bk,[]); byBk.get(bk).push(f);
  });
  let html=`<div class="bk-panel">`;
  [...byBk.entries()].sort((a,b)=>b[1].length-a[1].length).forEach(([bk,rows])=>{
    const act=activas(rows).length;
    const rec=rows.filter(r=>r.estado==="Reconciliado").length;
    const pend=rows.filter(r=>r.estado==="Pendiente de Hacer").length;
    const acc=rows.filter(r=>r.estado==="Pendiente de Acceso").length;
    const pct=act?Math.round(rec/act*100):0;
    const cli=new Set(rows.map(r=>r.cliente_id)).size;
    html+=`<div class="bk-card"><h3>${esc(bk)}</h3>
      <div class="prog-track"><div class="prog-fill" style="width:${pct}%"></div></div>
      <div class="bk-stat" style="margin-top:8px"><span>Avance</span><b>${pct}%</b></div>
      <div class="bk-stat"><span>Clientes</span><b>${cli}</b></div>
      <div class="bk-stat"><span>Cuentas activas</span><b>${act}</b></div>
      <div class="bk-stat"><span>Reconciliadas</span><b style="color:var(--menta)">${rec}</b></div>
      <div class="bk-stat"><span>Pend. de Hacer</span><b style="color:var(--amber)">${pend}</b></div>
      <div class="bk-stat"><span>Pend. de Acceso</span><b style="color:var(--blue)">${acc}</b></div>
    </div>`;
  });
  html+=`</div>`;
  $(".grid-wrap").insertAdjacentHTML("beforeend", html);
}

/* ---------------- EDICIÓN INLINE ---------------- */
$("#grid").addEventListener("change", onEdit);
$("#grid").addEventListener("keydown", (e)=>{ if(e.key==="Enter" && e.target.classList.contains("notas")) e.target.blur(); });
async function onEdit(e){
  const el=e.target; const id=el.dataset.id; const field=el.dataset.field;
  if(!id||!field) return;
  let val;
  if(el.type==="checkbox") val=el.checked;
  else if(field==="fecha_completado") val=el.value||null;
  else val=el.value;
  const td=el.closest("td"); td?.classList.add("saving");
  try{
    await api("update_conc",{ id:Number(id), patch:{ [field]:val } });
    const fila=S.filas.find(f=>f.conc_id==id);
    if(fila){ fila[field]=val; fila.actualizado_at=new Date().toISOString(); }
    if(field==="estado"){ el.dataset.e=val; renderKPIs(); renderTabs();
      // si cambió estado y hay vista filtrada por estado, re-render
      if(VIEWS[S.view]) renderGrid();
    }
    toast("Guardado ✓");
  }catch(ex){ toast(ex.message,true); }
  finally{ td?.classList.remove("saving"); S.lastSig=S.filas.map(f=>f.conc_id+":"+f.actualizado_at).join("|"); }
}

/* ---------------- FILTROS / TABS ---------------- */
$("#tabs").addEventListener("click",(e)=>{ const t=e.target.closest(".tab"); if(!t)return; S.view=t.dataset.view; renderAll(); });
$("#q").addEventListener("input",(e)=>{ S.q=e.target.value; if(S.view!=="bookkeeper") renderGrid(); });
$("#f-bk").addEventListener("change",(e)=>{ S.fbk=e.target.value; if(S.view!=="bookkeeper") renderGrid(); });
$("#f-tipo").addEventListener("change",(e)=>{ S.ftipo=e.target.value; if(S.view!=="bookkeeper") renderGrid(); });
$("#sel-periodo").addEventListener("change", async (e)=>{ S.periodo_id=Number(e.target.value); await load(); });
$("#btn-refresh").addEventListener("click", async ()=>{ await load(); toast("Actualizado ✓"); });

/* ---------------- MODALES ---------------- */
function openModal(title, bodyHTML){ $("#modal-title").textContent=title; $("#modal-body").innerHTML=bodyHTML; $("#modal").classList.remove("hidden"); }
function closeModal(){ $("#modal").classList.add("hidden"); }
$("#modal-x").addEventListener("click", closeModal);
$("#modal").addEventListener("click",(e)=>{ if(e.target.id==="modal") closeModal(); });

$("#btn-add-cuenta").addEventListener("click", ()=>{
  const cliOpts = S.clientes.map(c=>`<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
  const bkOpts = [""].concat(S.bookkeepers).map(b=>`<option value="${b}">${b||"—"}</option>`).join("");
  openModal("Agregar cliente / cuenta", `
    <label>Cliente existente</label>
    <select id="m-cli"><option value="">— nuevo cliente —</option>${cliOpts}</select>
    <div id="m-newcli">
      <label>Nombre del cliente nuevo</label>
      <input id="m-clinombre" placeholder="Razón social">
      <label>Bookkeeper asignado</label>
      <select id="m-clibk">${bkOpts}</select>
    </div>
    <hr style="border-color:var(--line);margin:16px 0">
    <div class="row2">
      <div><label>Nombre de la cuenta</label><input id="m-cuenta" placeholder="Ej: Chase 1234"></div>
      <div><label>Tipo</label><select id="m-tipo"><option>Bank</option><option>Credit Card</option></select></div>
    </div>
    <div class="modal-actions"><button class="btn ghost" id="m-cancel">Cancelar</button><button class="btn primary" id="m-save">Guardar</button></div>
  `);
  const toggle=()=>{ $("#m-newcli").style.display = $("#m-cli").value ? "none":"block"; };
  $("#m-cli").addEventListener("change", toggle); toggle();
  $("#m-cancel").addEventListener("click", closeModal);
  $("#m-save").addEventListener("click", saveCuenta);
});

async function saveCuenta(){
  const cuenta=$("#m-cuenta").value.trim();
  if(!cuenta) return toast("Falta el nombre de la cuenta", true);
  try{
    let cliente_id=$("#m-cli").value;
    if(!cliente_id){
      const nombre=$("#m-clinombre").value.trim();
      if(!nombre) return toast("Falta el nombre del cliente", true);
      const r=await api("add_cliente",{ nombre, bookkeeper_default:$("#m-clibk").value||null });
      cliente_id=r.cliente.id;
    }
    await api("add_cuenta",{ cliente_id:Number(cliente_id), nombre:cuenta, tipo:$("#m-tipo").value, periodo_id:S.periodo_id });
    closeModal(); await load(); toast("Cuenta agregada ✓");
  }catch(ex){ toast(ex.message,true); }
}

$("#btn-nuevo-periodo").addEventListener("click", ()=>{
  const now=new Date(); const y=now.getFullYear(); const m=String(now.getMonth()+1).padStart(2,"0");
  openModal("Nuevo período", `
    <p class="muted">Crea un mes nuevo arrastrando todas las cuentas activas en estado <b>Pendiente de Hacer</b>.</p>
    <div class="row2">
      <div><label>Etiqueta</label><input id="m-etq" value="${y}-${m}"></div>
      <div><label>Fecha (1° del mes)</label><input type="date" id="m-fec" value="${y}-${m}-01"></div>
    </div>
    <div class="modal-actions"><button class="btn ghost" id="m-cancel">Cancelar</button><button class="btn primary" id="m-save">Crear período</button></div>
  `);
  $("#m-cancel").addEventListener("click", closeModal);
  $("#m-save").addEventListener("click", async ()=>{
    try{
      const r=await api("new_periodo",{ etiqueta:$("#m-etq").value.trim(), fecha:$("#m-fec").value });
      S.periodo_id=r.periodo.id; closeModal(); await load(); toast("Período creado ✓");
    }catch(ex){ toast(ex.message,true); }
  });
});

/* ---------------- EXPORT CSV ---------------- */
$("#btn-export").addEventListener("click", ()=>{
  const f=filtered();
  const cols=["cliente","cuenta","tipo","estado","fecha_completado","bookkeeper",...BOOLS.map(b=>b[0]),"notas"];
  const head=["Cliente","Cuenta","Tipo","Estado","Fecha","Bookkeeper",...BOOLS.map(b=>b[1]),"Notas"];
  const csv=[head.join(",")].concat(f.map(r=>cols.map(c=>{
    let v=r[c]; if(typeof v==="boolean") v=v?"SI":""; v=v==null?"":String(v);
    return `"${v.replace(/"/g,'""')}"`;
  }).join(","))).join("\r\n");
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
