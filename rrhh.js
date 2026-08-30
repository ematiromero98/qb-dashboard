"use strict";
/* ===== Módulo Sueldos / Evaluaciones (área de jefes) ===== */
const COMPS = [["desempeno","Desempeño"],["confiabilidad","Confiabilidad"],["autonomia","Autonomía"],["actitud","Actitud"],["potencial","Potencial"]];
const CICLOS = [["2026-H1","Jun-26"],["2026-H2","Dic-26"],["2027-H1","Jun-27"],["2027-H2","Dic-27"]];
const R = { pin:"", bandas:[], personas:[], tareas:[], sueldos:[], evaluaciones:[], view:"equipo", ciclo:"2026-H1", loaded:false };

async function rapi(action, extra={}){
  const res = await fetch(`${CFG.URL}/functions/v1/${CFG.FN}`,{
    method:"POST", headers:{ apikey:CFG.ANON, Authorization:"Bearer "+CFG.ANON, "Content-Type":"application/json" },
    body: JSON.stringify({ pin:R.pin, action, ...extra }),
  });
  const data = await res.json().catch(()=>({error:"respuesta inválida"}));
  if(!res.ok) throw new Error(data.error || ("HTTP "+res.status));
  return data;
}

/* ---- abrir (pide PIN de jefes) ---- */
document.getElementById("btn-rrhh").addEventListener("click", async ()=>{
  const saved = sessionStorage.getItem("qb_pin_admin");
  if(saved){ R.pin=saved; try{ await rapi("rrhh_login"); return openRRHH(); }catch(e){ sessionStorage.removeItem("qb_pin_admin"); } }
  openModal("🔒 Área de jefes", `
    <p class="muted">Ingresá el PIN de jefes para ver sueldos y evaluaciones.</p>
    <label>PIN de jefes</label><input id="ra-pin" type="password" autocomplete="off">
    <div id="ra-err" class="gate-err"></div>
    <div class="modal-actions"><button class="btn ghost" id="ra-cancel">Cancelar</button><button class="btn primary" id="ra-ok">Entrar</button></div>`);
  const go=async ()=>{
    R.pin=document.getElementById("ra-pin").value.trim();
    try{ await rapi("rrhh_login"); sessionStorage.setItem("qb_pin_admin",R.pin); closeModal(); openRRHH(); }
    catch(ex){ document.getElementById("ra-err").textContent=ex.message; R.pin=""; }
  };
  document.getElementById("ra-cancel").addEventListener("click",closeModal);
  document.getElementById("ra-ok").addEventListener("click",go);
  document.getElementById("ra-pin").addEventListener("keydown",e=>{ if(e.key==="Enter"){e.preventDefault();go();} });
  setTimeout(()=>document.getElementById("ra-pin").focus(),50);
});

async function openRRHH(){
  const ov=document.getElementById("rrhh"); ov.classList.remove("hidden");
  ov.innerHTML=`<div class="rr-load">Cargando…</div>`;
  try{ const d=await rapi("rrhh_bootstrap");
    R.bandas=d.bandas; R.personas=d.personas; R.tareas=d.tareas; R.sueldos=d.sueldos; R.evaluaciones=d.evaluaciones; R.loaded=true;
    renderRRHH();
  }catch(ex){ ov.innerHTML=`<div class="rr-load">Error: ${esc(ex.message)} <button class="btn" onclick="document.getElementById('rrhh').classList.add('hidden')">Cerrar</button></div>`; }
}
function closeRRHH(){ document.getElementById("rrhh").classList.add("hidden"); }

/* ---- helpers ---- */
const bandaNom = (n)=>{ const b=R.bandas.find(x=>x.nivel===n); return b?`B${n} · ${b.nombre}`:(n?("Banda "+n):"—"); };
const usd = (v)=> v==null?"—":"$"+Number(v).toLocaleString("en-US");
const tareasDe = (pid)=>R.tareas.filter(t=>t.persona_id===pid && t.activo!==false);
const sueldosDe = (pid)=>R.sueldos.filter(s=>s.persona_id===pid).sort((a,b)=>a.vigente_desde.localeCompare(b.vigente_desde));
const evalDe = (pid,ciclo)=>R.evaluaciones.find(e=>e.persona_id===pid && e.ciclo===ciclo);
function antiguedad(ing){ if(!ing) return "—"; const a=new Date(ing+"T00:00:00"), h=new Date();
  let m=(h.getFullYear()-a.getFullYear())*12+(h.getMonth()-a.getMonth()); if(h.getDate()<a.getDate())m--;
  const y=Math.floor(m/12); m=m%12; return (y?y+(y===1?" año":" años"):"")+(y&&m?", ":"")+(m?m+(m===1?" mes":" meses"):(y?"":"0 meses")); }
function promedio(ev){ if(!ev) return null; const vs=COMPS.map(c=>ev[c[0]]).filter(v=>v!=null); return vs.length?vs.reduce((a,b)=>a+b,0)/vs.length:null; }
function nivel(prom){ if(prom==null)return "—"; if(prom>=4.5)return "Excelente"; if(prom>=3.5)return "Muy bueno"; if(prom>=2.5)return "Sólido"; if(prom>=1.5)return "En desarrollo"; return "Bajo"; }
const nivelColor = (p)=> p==null?"var(--muted2)": p>=4.5?"#2ee6a6": p>=3.5?"#5aa9ff": p>=2.5?"#ffb23e": p>=1.5?"#ff9f43":"#ff6b6b";

/* ---- shell + router ---- */
function renderRRHH(){
  const nomina=R.personas.reduce((a,p)=>a+(Number(p.sueldo_actual_usd)||0),0);
  const ov=document.getElementById("rrhh");
  ov.innerHTML=`
    <div class="rr-top">
      <div class="rr-brand">🔒 Sueldos & Evaluaciones <em>Chermisqui · confidencial</em></div>
      <div class="rr-actions">
        <span class="rr-nomina">Nómina <b>${usd(nomina)}</b> USD/mes · ${R.personas.length} personas</span>
        <button class="btn ghost" id="rr-pin">PIN jefes</button>
        <button class="btn ghost" id="rr-close">✕ Volver</button>
      </div>
    </div>
    <div class="rr-tabs">
      ${[["equipo","Equipo"],["aumentos","Aumentos"],["evaluacion","Evaluación"],["escala","Escala salarial"]].map(t=>
        `<button class="rr-tab ${R.view===t[0]?'active':''}" data-v="${t[0]}">${t[1]}</button>`).join("")}
    </div>
    <div class="rr-body" id="rr-body"></div>`;
  ov.querySelector("#rr-close").addEventListener("click",closeRRHH);
  ov.querySelector("#rr-pin").addEventListener("click",cambiarPinJefes);
  ov.querySelectorAll(".rr-tab").forEach(b=>b.addEventListener("click",()=>{ R.view=b.dataset.v; renderRRHH(); }));
  const body=ov.querySelector("#rr-body");
  if(R.view==="equipo") body.innerHTML=viewEquipo();
  else if(R.view==="aumentos") body.innerHTML=viewAumentos();
  else if(R.view==="evaluacion"){ body.innerHTML=viewEvaluacion(); bindEval(body); }
  else if(R.view==="escala") body.innerHTML=viewEscala();
  if(R.view==="equipo") bindEquipo(body);
  if(R.view==="aumentos") bindAumentos(body);
}

/* ================= EQUIPO ================= */
function viewEquipo(){
  return `<div class="rr-grid">`+R.personas.map(p=>{
    const ev=evalDe(p.id,R.ciclo); const prom=promedio(ev);
    const tr=tareasDe(p.id);
    return `<div class="rr-card">
      <div class="rr-card-head">
        <div><div class="rr-name">${esc(p.nombre)} ${esc(p.apellido||"")}</div>
          <div class="rr-rol">${esc(p.rol_perfil||"—")}</div></div>
        <div class="rr-sueldo">${usd(p.sueldo_actual_usd)}<span>USD</span></div>
      </div>
      <div class="rr-meta">
        <span class="rr-badge">${esc(bandaNom(p.banda))}</span>
        <span class="rr-badge alt">Ingreso ${p.ingreso||"—"} · ${antiguedad(p.ingreso)}</span>
        ${prom!=null?`<span class="rr-badge" style="color:${nivelColor(prom)};border-color:${nivelColor(prom)}66">Eval ${nivel(prom)} (${prom.toFixed(1)})</span>`:""}
      </div>
      <div class="rr-tareas">${tr.length?tr.map(t=>`<span class="rr-chip" data-tarea="${t.id}" title="Quitar tarea">${esc(t.descripcion)} <b>×</b></span>`).join(""):'<span class="muted" style="font-size:12px">Sin tareas cargadas</span>'}
        <span class="rr-chip add" data-addtarea="${p.id}">+ tarea</span></div>
      ${p.comentarios?`<div class="rr-coment">${esc(p.comentarios)}</div>`:""}
      <div class="rr-card-actions">
        <button class="btn ghost sm" data-edit="${p.id}">Editar</button>
        <button class="btn ghost sm" data-aum="${p.id}">+ Aumento</button>
        <button class="btn ghost sm" data-evalp="${p.id}">Evaluar</button>
      </div></div>`;
  }).join("")+`<div class="rr-card add" id="rr-add-persona">+ Agregar persona</div></div>`;
}
function bindEquipo(root){
  root.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>editarPersona(+b.dataset.edit)));
  root.querySelectorAll("[data-aum]").forEach(b=>b.addEventListener("click",()=>nuevoAumento(+b.dataset.aum)));
  root.querySelectorAll("[data-evalp]").forEach(b=>b.addEventListener("click",()=>{ R.view="evaluacion"; renderRRHH(); setTimeout(()=>abrirEval(+b.dataset.evalp,R.ciclo),60); }));
  root.querySelectorAll("[data-addtarea]").forEach(b=>b.addEventListener("click",()=>addTarea(+b.dataset.addtarea)));
  root.querySelectorAll("[data-tarea]").forEach(c=>c.addEventListener("click",()=>delTarea(+c.dataset.tarea)));
  const ap=root.querySelector("#rr-add-persona"); if(ap) ap.addEventListener("click",agregarPersona);
}

async function editarPersona(id){
  const p=R.personas.find(x=>x.id===id);
  const bandaOpts=R.bandas.map(b=>`<option value="${b.nivel}" ${b.nivel===p.banda?"selected":""}>B${b.nivel} · ${esc(b.nombre)}</option>`).join("");
  openModal(`Editar · ${esc(p.nombre)} ${esc(p.apellido||"")}`,`
    <div class="row2"><div><label>Nombre</label><input id="e-nom" value="${esc(p.nombre)}"></div>
      <div><label>Apellido</label><input id="e-ape" value="${esc(p.apellido||"")}"></div></div>
    <label>Rol / Perfil</label><input id="e-rol" value="${esc(p.rol_perfil||"")}">
    <div class="row2"><div><label>Banda</label><select id="e-banda"><option value="">—</option>${bandaOpts}</select></div>
      <div><label>Ingreso</label><input type="date" id="e-ing" value="${p.ingreso||""}"></div></div>
    <label>Comentarios</label><textarea id="e-com" rows="3">${esc(p.comentarios||"")}</textarea>
    <p class="muted" style="font-size:11.5px;margin-top:8px">El sueldo se cambia desde "+ Aumento" (queda en el historial).</p>
    <div class="modal-actions"><button class="btn ghost" id="e-cancel">Cancelar</button><button class="btn primary" id="e-save">Guardar</button></div>`);
  document.getElementById("e-cancel").addEventListener("click",closeModal);
  document.getElementById("e-save").addEventListener("click",async ()=>{
    const patch={ nombre:document.getElementById("e-nom").value.trim(), apellido:document.getElementById("e-ape").value.trim(),
      rol_perfil:document.getElementById("e-rol").value.trim(), banda:document.getElementById("e-banda").value?+document.getElementById("e-banda").value:null,
      ingreso:document.getElementById("e-ing").value||null, comentarios:document.getElementById("e-com").value.trim()||null };
    try{ const r=await rapi("rrhh_update_persona",{id,patch}); Object.assign(p,r.persona); closeModal(); renderRRHH(); toast("Guardado ✓"); }
    catch(ex){ toast(ex.message,true); }
  });
}

async function nuevoAumento(id){
  const p=R.personas.find(x=>x.id===id); const now=new Date();
  const mes=now.getMonth()+1; const defMot = mes<=6?"Aumento Junio":(mes>=7?"Aumento Diciembre":"Ajuste");
  openModal(`Registrar aumento · ${esc(p.nombre)}`,`
    <p class="muted">Sueldo actual: <b>${usd(p.sueldo_actual_usd)}</b>. El nuevo monto pasa a ser el sueldo vigente y queda en el historial.</p>
    <div class="row2"><div><label>Nuevo monto USD</label><input type="number" id="a-monto" value="${p.sueldo_actual_usd||""}"></div>
      <div><label>Vigente desde</label><input type="date" id="a-fecha" value="${now.getFullYear()}-${String(mes).padStart(2,"0")}-01"></div></div>
    <label>Motivo</label><select id="a-mot">
      ${["Aumento Junio","Aumento Diciembre","Ajuste","Escala mensual","Ingreso","Promoción de banda"].map(m=>`<option ${m===defMot?"selected":""}>${m}</option>`).join("")}</select>
    <label>Nota (opcional)</label><input id="a-nota" placeholder="Ej: por mayor responsabilidad">
    <div class="modal-actions"><button class="btn ghost" id="a-cancel">Cancelar</button><button class="btn primary" id="a-save">Registrar</button></div>`);
  document.getElementById("a-cancel").addEventListener("click",closeModal);
  document.getElementById("a-save").addEventListener("click",async ()=>{
    const monto=parseFloat(document.getElementById("a-monto").value); const fecha=document.getElementById("a-fecha").value;
    if(!monto||!fecha) return toast("Faltan monto o fecha",true);
    try{ await rapi("rrhh_add_sueldo",{persona_id:id,vigente_desde:fecha,monto_usd:monto,motivo:document.getElementById("a-mot").value,nota:document.getElementById("a-nota").value.trim()||null});
      closeModal(); await openRRHH(); toast("Aumento registrado ✓"); }
    catch(ex){ toast(ex.message,true); }
  });
}

async function addTarea(pid){
  openModal("Agregar tarea a cargo",`<label>Descripción</label><input id="t-desc" placeholder="Ej: Cierre mensual de payroll">
    <div class="modal-actions"><button class="btn ghost" id="t-cancel">Cancelar</button><button class="btn primary" id="t-save">Agregar</button></div>`);
  document.getElementById("t-cancel").addEventListener("click",closeModal);
  document.getElementById("t-save").addEventListener("click",async ()=>{
    const d=document.getElementById("t-desc").value.trim(); if(!d) return;
    try{ const r=await rapi("rrhh_add_tarea",{persona_id:pid,descripcion:d}); R.tareas.push(r.tarea); closeModal(); renderRRHH(); toast("Tarea agregada ✓"); }
    catch(ex){ toast(ex.message,true); }
  });
  setTimeout(()=>document.getElementById("t-desc").focus(),50);
}
async function delTarea(id){
  try{ await rapi("rrhh_del_tarea",{id}); R.tareas=R.tareas.filter(t=>t.id!==id); renderRRHH(); toast("Tarea quitada"); }
  catch(ex){ toast(ex.message,true); }
}
async function agregarPersona(){
  openModal("Agregar persona",`
    <div class="row2"><div><label>Nombre</label><input id="p-nom"></div><div><label>Apellido</label><input id="p-ape"></div></div>
    <label>Rol / Perfil</label><input id="p-rol">
    <div class="row2"><div><label>Sueldo USD</label><input type="number" id="p-su"></div><div><label>Ingreso</label><input type="date" id="p-ing"></div></div>
    <div class="modal-actions"><button class="btn ghost" id="p-cancel">Cancelar</button><button class="btn primary" id="p-save">Agregar</button></div>`);
  document.getElementById("p-cancel").addEventListener("click",closeModal);
  document.getElementById("p-save").addEventListener("click",async ()=>{
    const nombre=document.getElementById("p-nom").value.trim(); if(!nombre) return toast("Falta nombre",true);
    try{ await rapi("rrhh_add_persona",{nombre,apellido:document.getElementById("p-ape").value.trim(),rol_perfil:document.getElementById("p-rol").value.trim(),
      sueldo_actual_usd:parseFloat(document.getElementById("p-su").value)||null, ingreso:document.getElementById("p-ing").value||null});
      closeModal(); await openRRHH(); toast("Persona agregada ✓"); }
    catch(ex){ toast(ex.message,true); }
  });
}

/* ================= AUMENTOS ================= */
function viewAumentos(){
  const nomina=R.personas.reduce((a,p)=>a+(Number(p.sueldo_actual_usd)||0),0);
  return `<div class="rr-note">Historial de sueldos y aumentos por persona. Los aumentos oficiales entran en <b>Junio</b> y <b>Diciembre</b>. Nómina actual: <b>${usd(nomina)}</b> USD/mes.</div>
  <div class="rr-aum">`+R.personas.map(p=>{
    const h=sueldosDe(p.id); let prev=null;
    const chips=h.map(s=>{ const delta=prev==null?0:Number(s.monto_usd)-prev; prev=Number(s.monto_usd);
      const cls=delta>0?"up":delta<0?"down":"eq"; const oficial=/Junio|Diciembre/.test(s.motivo||"");
      return `<span class="aum-chip ${cls} ${oficial?'ofi':''}" title="${esc(s.motivo||'')}${s.nota?' · '+esc(s.nota):''}">
        <span class="aum-f">${s.vigente_desde.slice(0,7)}</span> ${usd(s.monto_usd)}${delta?`<i>${delta>0?'▲':'▼'}${Math.abs(delta)}</i>`:""}</span>`;}).join('<span class="aum-arrow">→</span>');
    return `<div class="aum-row"><div class="aum-persona"><b>${esc(p.nombre)} ${esc(p.apellido||"")}</b><span>${esc(p.rol_perfil||"")}</span></div>
      <div class="aum-line">${chips||'<span class="muted">Sin historial</span>'}</div>
      <button class="btn ghost sm" data-aum="${p.id}">+ Aumento</button></div>`;
  }).join("")+`</div>`;
}
function bindAumentos(root){ root.querySelectorAll("[data-aum]").forEach(b=>b.addEventListener("click",()=>nuevoAumento(+b.dataset.aum))); }

/* ================= EVALUACIÓN ================= */
function viewEvaluacion(){
  const cicloOpts=CICLOS.map(c=>`<option value="${c[0]}" ${c[0]===R.ciclo?"selected":""}>${c[1]}</option>`).join("");
  const rows=R.personas.filter(p=>!p.es_coordinacion || R.evaluaciones.some(e=>e.persona_id===p.id)).map(p=>{
    const ev=evalDe(p.id,R.ciclo); const prom=promedio(ev);
    return `<tr data-evalp="${p.id}">
      <td class="l"><b>${esc(p.nombre)} ${esc(p.apellido||"")}</b><div class="rr-rol">${esc(p.rol_perfil||"")}</div></td>
      ${COMPS.map(c=>`<td>${ev&&ev[c[0]]!=null?`<span class="score s${ev[c[0]]}">${ev[c[0]]}</span>`:'<span class="muted">–</span>'}</td>`).join("")}
      <td><b style="color:${nivelColor(prom)}">${prom!=null?prom.toFixed(1):"–"}</b></td>
      <td><span style="color:${nivelColor(prom)}">${nivel(prom)}</span></td></tr>`;
  }).join("");
  return `<div class="rr-note" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <span>Matriz de evaluación semestral (puntaje 1–5). Hacé clic en una fila para ver/editar el detalle y el feedback.</span>
      <label style="display:flex;gap:8px;align-items:center">Ciclo <select id="rr-ciclo">${cicloOpts}</select></label></div>
    <div style="overflow-x:auto"><table class="eval-table"><thead><tr><th class="l">Empleado</th>
      ${COMPS.map(c=>`<th>${c[1]}</th>`).join("")}<th>Prom.</th><th>Nivel</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function bindEval(root){
  const sel=root.querySelector("#rr-ciclo"); if(sel) sel.addEventListener("change",e=>{ R.ciclo=e.target.value; renderRRHH(); });
  root.querySelectorAll("[data-evalp]").forEach(tr=>tr.addEventListener("click",()=>abrirEval(+tr.dataset.evalp,R.ciclo)));
}
function abrirEval(pid,ciclo){
  const p=R.personas.find(x=>x.id===pid); const ev=evalDe(pid,ciclo)||{};
  const cicloLbl=(CICLOS.find(c=>c[0]===ciclo)||[ciclo,ciclo])[1];
  const scoreSel=(k)=>`<select class="ev-score" data-k="${k}"><option value="">–</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${ev[k]===n?"selected":""}>${n}</option>`).join("")}</select>`;
  const ta=(k,lbl,val)=>`<label>${lbl}</label><textarea class="ev-t" data-k="${k}" rows="2">${esc(val||"")}</textarea>`;
  openModal(`Evaluación ${cicloLbl} · ${esc(p.nombre)} ${esc(p.apellido||"")}`,`
    <div class="ev-scores">${COMPS.map(c=>`<div class="ev-sc"><span>${c[1]}</span>${scoreSel(c[0])}</div>`).join("")}</div>
    ${ta("fortalezas","Fortalezas observadas",ev.fortalezas)}
    ${ta("evidencias","Evidencias / comportamientos",ev.evidencias)}
    ${ta("impacto","Impacto en el equipo",ev.impacto)}
    ${ta("mejoras","Puntos de mejora",ev.mejoras)}
    ${ta("feedback_sugerido","Feedback sugerido (cómo comunicarlo)",ev.feedback_sugerido)}
    ${ta("compromisos","Compromisos / objetivos próximo período",ev.compromisos)}
    ${ta("seguimiento","Seguimiento (vs período anterior)",ev.seguimiento)}
    <div class="modal-actions"><button class="btn ghost" id="ev-cancel">Cancelar</button><button class="btn primary" id="ev-save">Guardar evaluación</button></div>`);
  document.getElementById("ev-cancel").addEventListener("click",closeModal);
  document.getElementById("ev-save").addEventListener("click",async ()=>{
    const patch={ fecha: ev.fecha || (new Date().toISOString().slice(0,10)) };
    document.querySelectorAll("#modal .ev-score").forEach(s=>patch[s.dataset.k]= s.value?+s.value:null);
    document.querySelectorAll("#modal .ev-t").forEach(t=>patch[t.dataset.k]= t.value.trim()||null);
    const prom=promedio(patch); patch.nivel=nivel(prom);
    try{ const r=await rapi("rrhh_update_eval",{persona_id:pid,ciclo,patch});
      const i=R.evaluaciones.findIndex(e=>e.persona_id===pid&&e.ciclo===ciclo);
      if(i>=0) R.evaluaciones[i]=r.evaluacion; else R.evaluaciones.push(r.evaluacion);
      closeModal(); renderRRHH(); toast("Evaluación guardada ✓"); }
    catch(ex){ toast(ex.message,true); }
  });
}

/* ================= ESCALA ================= */
function viewEscala(){
  return `<div class="rr-note">Escala de crecimiento salarial (USD). Referencia para ubicar y proyectar aumentos.</div>
    <div style="overflow-x:auto"><table class="escala-table"><thead><tr><th>Banda</th><th>Descripción</th><th class="r">Desde</th><th class="r">Hasta</th><th>Requisitos para avanzar</th></tr></thead><tbody>
    ${R.bandas.map(b=>`<tr><td><span class="rr-badge">B${b.nivel} · ${esc(b.nombre)}</span></td><td>${esc(b.descripcion||"")}</td>
      <td class="r">${usd(b.desde_usd)}</td><td class="r">${usd(b.hasta_usd)}</td><td class="muted">${esc(b.requisitos||"")}</td></tr>`).join("")}
    </tbody></table></div>`;
}

/* ---- cambiar PIN de jefes ---- */
function cambiarPinJefes(){
  openModal("Cambiar PIN de jefes",`<label>Nuevo PIN (mín. 4)</label><input id="rp-pin" type="text">
    <div class="modal-actions"><button class="btn ghost" id="rp-cancel">Cancelar</button><button class="btn primary" id="rp-save">Cambiar</button></div>`);
  document.getElementById("rp-cancel").addEventListener("click",closeModal);
  document.getElementById("rp-save").addEventListener("click",async ()=>{
    const np=document.getElementById("rp-pin").value.trim(); if(np.length<4) return toast("PIN muy corto",true);
    try{ await rapi("rrhh_set_pin",{new_pin:np}); R.pin=np; sessionStorage.setItem("qb_pin_admin",np); closeModal(); toast("PIN de jefes cambiado ✓"); }
    catch(ex){ toast(ex.message,true); }
  });
}
