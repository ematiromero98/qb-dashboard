/* ============================================================
   Backend compartido para Taxes por Trimestre.
   Reemplaza el guardado local por uno en la nube (Supabase Edge
   Function tx-api, con PIN). Así los datos quedan iguales en TODAS
   las computadoras/celulares y se sincronizan solos cada pocos segundos.
   ============================================================ */
window.QB_TX = {
  URL: "https://ffczbimnuodzcbgsdxbx.supabase.co",
  ANON: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmY3piaW1udW9kemNiZ3NkeGJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMDk5OTIsImV4cCI6MjEwMTY4NTk5Mn0.askaC0kqNdzoxYhJhmzEKPOiW5n9QlbBrF5U1pqRlBE",
  FN: "tx-api",
  KEY: "quarters_v1",
  REFRESH_MS: 8000,
};

(function () {
  var CFG = window.QB_TX;
  var PIN = sessionStorage.getItem("tx_pin") || localStorage.getItem("tx_pin") || "";
  var lastRev = null;
  var authed = false;
  var resolveAuth;
  var authReady = new Promise(function (r) { resolveAuth = r; });

  function api(action, extra) {
    return fetch(CFG.URL + "/functions/v1/" + CFG.FN, {
      method: "POST",
      headers: { apikey: CFG.ANON, Authorization: "Bearer " + CFG.ANON, "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ pin: PIN, action: action }, extra || {})),
    }).then(function (res) {
      return res.json().catch(function () { return { error: "respuesta inválida" }; })
        .then(function (data) { if (!res.ok) throw new Error(data.error || ("HTTP " + res.status)); return data; });
    });
  }

  // ---- window.storage: lo consume la app (modo "cloud") ----
  window.storage = {
    get: function (k) {
      return authReady.then(function () {
        return api("get", { key: k }).then(function (d) {
          if (d && d.rev != null) lastRev = d.rev;
          window.__txEmpty = !(d && d.value != null);
          return (d && d.value != null) ? { value: d.value } : null;
        });
      });
    },
    set: function (k, v) {
      return authReady.then(function () {
        return api("set", { key: k, value: v }).then(function (d) {
          if (d && d.rev != null) lastRev = d.rev;
        }).catch(function (e) { toast("No se pudo guardar en la nube: " + e.message, true); });
      });
    },
  };

  // ---- Sincronización: si otro equipo guardó, recargamos el estado ----
  function startSync() {
    setInterval(function () {
      if (document.hidden) return;
      var ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return; // no interrumpir mientras se edita
      api("get", { key: CFG.KEY }).then(function (d) {
        if (d && d.rev != null && d.rev !== lastRev) {
          lastRev = d.rev;
          if (window.__txReload) window.__txReload();
        }
      }).catch(function () {});
    }, CFG.REFRESH_MS);
  }

  // ---- Toast simple (por si la app aún no cargó el suyo) ----
  function toast(msg, err) {
    var t = document.getElementById("tx-cfg-toast");
    if (!t) { t = document.createElement("div"); t.id = "tx-cfg-toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9999;" +
      "background:#161d26;border:1px solid " + (err ? "#f87171" : "#2dd4bf") + ";color:" + (err ? "#f87171" : "#2dd4bf") +
      ";padding:10px 16px;border-radius:10px;font:600 13px/1 -apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.4)";
    clearTimeout(toast._t); toast._t = setTimeout(function () { if (t) t.remove(); }, 2600);
  }

  // ---- Gate de PIN ----
  var gate;
  function buildGate() {
    gate = document.createElement("div");
    gate.id = "tx-gate";
    gate.style.cssText = "position:fixed;inset:0;z-index:9998;display:grid;place-items:center;" +
      "background:radial-gradient(900px 500px at 50% 0%,rgba(45,212,191,.10),transparent),#0e1319;" +
      "font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif";
    gate.innerHTML =
      '<form id="tx-gate-form" style="width:min(360px,92vw);background:#161d26;border:1px solid rgba(255,255,255,.09);' +
      'border-radius:16px;padding:30px 26px;box-shadow:0 10px 30px rgba(0,0,0,.4);display:flex;flex-direction:column;gap:13px;text-align:center">' +
      '<div style="font-weight:700;font-size:22px;color:#e9eef5">Taxes<span style="color:#2dd4bf;margin:0 5px">·</span>Trimestre</div>' +
      '<div style="color:#8b99ab;font-size:12.5px;margin:-6px 0 4px">Control de pagos 941/943 y EDD · Chermisqui</div>' +
      '<input id="tx-pin" type="password" inputmode="text" autocomplete="off" placeholder="PIN de acceso" ' +
      'style="padding:13px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.17);background:#0f1620;color:#e9eef5;' +
      'font-size:16px;text-align:center;letter-spacing:2px;outline:none">' +
      '<label style="display:flex;gap:8px;align-items:center;justify-content:center;color:#8b99ab;font-size:12px">' +
      '<input type="checkbox" id="tx-remember"> Recordar en esta compu</label>' +
      '<button type="submit" id="tx-enter" style="padding:12px;border:0;border-radius:10px;background:#2dd4bf;color:#052e2a;' +
      'font-weight:700;font-size:15px;cursor:pointer">Entrar</button>' +
      '<div id="tx-err" style="color:#f87171;font-size:12px;min-height:16px"></div></form>';
    document.body.appendChild(gate);
    gate.querySelector("#tx-gate-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var pin = gate.querySelector("#tx-pin").value.trim();
      var btn = gate.querySelector("#tx-enter"); var err = gate.querySelector("#tx-err");
      err.textContent = ""; btn.disabled = true; btn.textContent = "Entrando…";
      PIN = pin;
      api("login").then(function () {
        (gate.querySelector("#tx-remember").checked ? localStorage : sessionStorage).setItem("tx_pin", pin);
        onAuthOk();
      }).catch(function (ex) {
        PIN = ""; err.textContent = ex.message; btn.disabled = false; btn.textContent = "Entrar";
      });
    });
  }
  function removeGate() { if (gate) { gate.remove(); gate = null; } }
  function onAuthOk() { if (authed) return; authed = true; resolveAuth(); removeGate(); startSync(); }

  // Arranque: gate visible cuanto antes; auto-login si hay PIN guardado
  function init() {
    buildGate();
    if (PIN) {
      api("login").then(onAuthOk).catch(function () {
        PIN = ""; sessionStorage.removeItem("tx_pin"); localStorage.removeItem("tx_pin");
        var i = gate && gate.querySelector("#tx-pin"); if (i) i.focus();
      });
    } else {
      var i = gate && gate.querySelector("#tx-pin"); if (i) i.focus();
    }
  }
  if (document.body) init();
  else document.addEventListener("DOMContentLoaded", init);
})();
