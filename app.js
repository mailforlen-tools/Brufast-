(function () {
"use strict";
const METRO_COLORS = {"1":"#B5378C","2":"#ED6C23","5":"#F6A90B","6":"#0066A3"};
const MODE = {m:"metro", t:"tram", r:"train"};
const OPNAME = {S:"STIB-MIVB", N:"NMBS-SNCB"};
const NET = window.NET, N = NET.nodes;
// edges as objects: u,v,t(s),mode(m|t|r|w),line,op(S|N|X|W),d(m)
const E = NET.edges.map(a => ({u:a[0], v:a[1], t:a[2], mode:a[3], line:a[4], op:a[5], d:a[6]}));
const $ = id => document.getElementById(id);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------- language ---------- */
let lang = "nl";
const supported = Object.keys(I18N);
function detectLang() {
  try { const q = new URLSearchParams(location.search).get("lang"); if (supported.includes(q)) return q; } catch (e) {}
  try { const s = localStorage.getItem("brufast.lang"); if (supported.includes(s)) return s; } catch (e) {}
  const n = (navigator.language || "nl").slice(0, 2).toLowerCase();
  return supported.includes(n) ? n : "en";
}
const T = () => I18N[lang];

/* ---------- adjacency + disruption ---------- */
const ADJ = {};
E.forEach((e, i) => { (ADJ[e.u] = ADJ[e.u] || []).push(i); });
const downLines = new Set(), downSegs = new Set();
const segKey = (a, b) => [a, b].sort().join("|");
function edgeDown(e) {
  if (e.mode === "w") return false;
  return downLines.has(e.op + "|" + e.line) || downSegs.has(segKey(e.u, e.v));
}

/* ---------- shortest path (binary heap) ---------- */
function route(s, t) {
  const dist = {[s]: 0}, prev = {}, h = [[0, s]];
  const push = x => { h.push(x); let i = h.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } };
  const pop = () => { const top = h[0], last = h.pop();
    if (h.length) { h[0] = last; let i = 0;
      for (;;) { let l = 2*i+1, r = l+1, m = i;
        if (l < h.length && h[l][0] < h[m][0]) m = l;
        if (r < h.length && h[r][0] < h[m][0]) m = r;
        if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } }
    return top; };
  while (h.length) {
    const [d, u] = pop();
    if (u === t) break;
    if (d > (dist[u] ?? 1e18)) continue;
    for (const ei of (ADJ[u] || [])) {
      const e = E[ei]; if (edgeDown(e)) continue;
      const nd = d + e.t;
      if (nd < (dist[e.v] ?? 1e18)) { dist[e.v] = nd; prev[e.v] = ei; push([nd, e.v]); }
    }
  }
  if (dist[t] == null) return null;
  const chain = []; let cur = t;
  while (cur !== s) { const ei = prev[cur]; chain.push(ei); cur = E[ei].u; }
  chain.reverse();
  return {chain, total: dist[t]};
}
function legs(chain) {
  const out = [];
  for (const ei of chain) {
    const e = E[ei], key = e.op + "|" + e.line + "|" + (e.mode === "w" ? "w" : "r");
    const L = out[out.length - 1];
    if (L && L.key === key && e.mode !== "w") { L.to = e.v; L.t += e.t; L.stops++; L.path.push(e.v); }
    else out.push({key, op:e.op, line:e.line, mode:e.mode, walk:e.mode === "w", from:e.u, to:e.v, t:e.t, stops:1, path:[e.u, e.v]});
  }
  return out;
}

/* ---------- map (Leaflet) ---------- */
const map = L.map("map", {zoomControl:true, preferCanvas:false}).setView([50.846, 4.357], 12);
const dark = matchMedia("(prefers-color-scheme: dark)");
const tiles = {
  light: L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {maxZoom:19, subdomains:"abcd", attribution:"© OpenStreetMap © CARTO"}),
  dark:  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",  {maxZoom:19, subdomains:"abcd", attribution:"© OpenStreetMap © CARTO"})
};
function setTiles() {
  const want = dark.matches ? "dark" : "light";
  Object.entries(tiles).forEach(([k, l]) => { if (k === want) l.addTo(map); else map.removeLayer(l); });
}
setTiles();
(dark.addEventListener ? dark.addEventListener("change", () => { setTiles(); refresh(); }) : null);

const ll = id => [N[id].a, N[id].o];
const baseGroup = L.layerGroup().addTo(map), routeGroup = L.layerGroup().addTo(map);
const tramToggle = $("tramToggle");

function drawBase() {
  baseGroup.clearLayers();
  // one polyline per physical link: shortest edge per station pair; skip express skip-stop edges
  const best = new Map();
  for (const e of E) {
    if (e.mode === "w") continue;
    if (e.mode === "r" && e.d > 2600) continue;
    if (e.mode === "t" && e.d > 1600) continue;
    if (e.mode === "t" && !tramToggle.checked) continue;
    const k = segKey(e.u, e.v), c = best.get(k);
    if (!c || (e.d || 1e9) < (c.d || 1e9)) best.set(k, e);
  }
  const order = {t:0, r:1, m:2};
  [...best.values()].sort((a, b) => order[a.mode] - order[b.mode]).forEach(e => {
    const down = edgeDown(e);
    let color, w, op = 0.9;
    if (e.mode === "m") { color = METRO_COLORS[e.line] || "#888"; w = 5; }
    else if (e.mode === "r") { color = css("--train"); w = 3.5; }
    else { color = css("--tram"); w = 2; op = 0.55; }
    const opts = {color: down ? css("--bad") : color, weight: down ? w + 1.5 : w, opacity: down ? 1 : op,
                  dashArray: down ? "4 5" : null, lineCap:"round", interactive: e.mode !== "t"};
    const pl = L.polyline([ll(e.u), ll(e.v)], opts).addTo(baseGroup);
    if (e.mode !== "t") pl.on("click", () => { const k = segKey(e.u, e.v);
      downSegs.has(k) ? downSegs.delete(k) : downSegs.add(k); refresh(); });
  });
  // stations: metro/train stops as dots with names, tram-only stops only when trams are shown
  const xch = new Set();
  E.forEach(e => { if (e.mode === "w" && e.op === "X") { xch.add(e.u); xch.add(e.v); } });
  for (const id in N) {
    const n = N[id], isX = xch.has(id), isTram = n.m === "T";
    if (isTram && !tramToggle.checked) continue;
    const mk = L.circleMarker(ll(id), {
      radius: isX ? 6 : isTram ? 2.5 : 3.8, weight: isX ? 2.5 : 1.5,
      color: isX ? css("--ink") : css("--card"), fillColor: isX ? css("--card") : (n.p === "N" ? css("--train") : "#888"),
      fillOpacity: 1, opacity: 1
    }).addTo(baseGroup);
    mk.bindTooltip(n.n, {direction:"top", className:"stn-tip", offset:[0, -4]});
  }
}

function drawRoute(r) {
  routeGroup.clearLayers();
  if (!r) return;
  const first = E[r.chain[0]].u, last = E[r.chain[r.chain.length - 1]].v;
  const pts = [ll(first)]; r.chain.forEach(ei => pts.push(ll(E[ei].v)));
  L.polyline(pts, {color: css("--route-glow"), weight: 14, opacity: .35, lineJoin:"round", interactive:false}).addTo(routeGroup);
  L.polyline(pts, {color: css("--card"), weight: 9, opacity: 1, lineJoin:"round", interactive:false}).addTo(routeGroup);
  L.polyline(pts, {color: css("--route"), weight: 5, opacity: 1, lineJoin:"round", interactive:false}).addTo(routeGroup);
  const mark = (id, big) => L.circleMarker(ll(id), {radius: big ? 8 : 5, color: css("--card"), weight: 2.5, fillColor: css("--route"), fillOpacity: 1})
    .bindTooltip(N[id].n, {permanent: true, direction: "right", className: "stn-tip", offset: [8, 0]}).addTo(routeGroup);
  mark(first, true); mark(last, true);
  legs(r.chain).forEach((l, i) => { if (l.walk && i > 0) mark(l.from, false); });
  map.fitBounds(L.latLngBounds(pts), {paddingTopLeft:[40, 40], paddingBottomRight:[170, 40], maxZoom:15});
}

/* ---------- itinerary ---------- */
let fromSel, toSel;
function render(fit) {
  const t = T(), s = fromSel.value, d = toSel.value, box = $("itin");
  if (s === d) { box.innerHTML = `<div class="empty">${t.pickTwo}</div>`; routeGroup.clearLayers(); return; }
  const r = route(s, d);
  if (fit !== false) drawRoute(r); else { const keep = map.getBounds(); drawRoute(r); map.fitBounds(keep); }
  if (!r) { box.innerHTML = `<div class="empty">${t.noRoute}</div>`; return; }
  let healed = false;
  if (downLines.size || downSegs.size) {
    const sl = new Set(downLines), ss = new Set(downSegs);
    downLines.clear(); downSegs.clear();
    const r0 = route(s, d);
    sl.forEach(x => downLines.add(x)); ss.forEach(x => downSegs.add(x));
    healed = r0 && JSON.stringify(r0.chain) !== JSON.stringify(r.chain);
  }
  const LG = legs(r.chain), rides = LG.filter(l => !l.walk);
  const ops = [...new Set(rides.map(l => OPNAME[l.op].split("-")[0]))];
  const cross = rides.reduce((a, l, i, arr) => i && arr[i-1].op !== l.op ? a + 1 : a, 0);
  const nm = id => N[id].n;
  box.innerHTML =
    `<div class="head"><span class="tot">${Math.round(r.total / 60)} ${t.minutes}</span>
       <span class="meta">${ops.join(" + ") || t.onFoot}${cross ? " · " + t.changes(cross) : ""}</span>
       ${healed ? `<span class="healed">${t.rerouted}</span>` : ""}</div>`
    + LG.map(l => {
        if (l.walk) return `<div class="leg"><span class="lc walk">${t.walk}</span>
          <div class="lb"><div class="r">${t.walkTransfer(Math.round(l.t / 60))}</div>
          <div class="s">${nm(l.from)} → ${nm(l.to)}</div></div></div>`;
        const col = l.mode === "m" ? (METRO_COLORS[l.line] || "#888") : l.mode === "r" ? css("--accent") : css("--tram");
        return `<div class="leg"><span class="lc" style="background:${col}">${l.line}</span>
          <div class="lb"><div class="r">${t[MODE[l.mode]]} ${l.line} <span class="s">· ${OPNAME[l.op].split("-")[0]}</span></div>
          <div class="s">${nm(l.from)} → ${nm(l.to)} · ${t.stops(l.stops)}, ${Math.round(l.t / 60)} ${t.minutes}</div></div></div>`;
      }).join("");
}
function refresh(fit) { drawBase(); render(fit); syncChips(); }

/* ---------- controls ---------- */
function fillSelects() {
  const a = fromSel.value, b = toSel.value;
  const opts = Object.entries(N).map(([id, n]) => ({id, label: n.n + "  ·  " + OPNAME[n.p].split("-")[0]}))
    .sort((x, y) => x.label.localeCompare(y.label, lang));
  [fromSel, toSel].forEach(sel => { sel.innerHTML = ""; opts.forEach(o => sel.appendChild(new Option(o.label, o.id))); });
  if (a) { fromSel.value = a; toSel.value = b; }
  else { fromSel.value = "stib:gare_centrale"; toSel.value = "stib:gare_du_midi"; }
}
function chip(html, pressed, onclick) {
  const b = document.createElement("button"); b.className = "chip"; b.type = "button";
  b.setAttribute("aria-pressed", pressed); b.innerHTML = html; b.onclick = onclick; return b;
}
function buildChips() {
  const t = T();
  $("metroChips").innerHTML = ""; $("trainChips").innerHTML = "";
  for (const l of ["1", "2", "5", "6"]) {
    const k = "S|" + l, b = chip(`<span class="dot" style="background:${METRO_COLORS[l]}"></span>${t.metro} ${l}`, downLines.has(k), () => {
      downLines.has(k) ? downLines.delete(k) : downLines.add(k); b.setAttribute("aria-pressed", downLines.has(k)); refresh(); });
    $("metroChips").appendChild(b);
  }
  const trainLines = [...new Set(E.filter(e => e.op === "N" && e.mode === "r").map(e => e.line))].filter(l => /^(S\d|IC|EC|L|P)$/.test(l)).sort();
  for (const l of trainLines) {
    const k = "N|" + l, b = chip(l, downLines.has(k), () => {
      downLines.has(k) ? downLines.delete(k) : downLines.add(k); b.setAttribute("aria-pressed", downLines.has(k)); refresh(); });
    $("trainChips").appendChild(b);
  }
}
function syncChips() {
  const c = $("segChips"); c.innerHTML = "";
  [...downSegs].forEach(k => { const [a, b] = k.split("|");
    c.appendChild(chip(`✕ ${N[a].n} – ${N[b].n}`, true, () => { downSegs.delete(k); refresh(); })); });
}

/* ---------- static text ---------- */
function applyLang() {
  const t = T();
  document.documentElement.lang = lang;
  $("tagline").textContent = t.tagline; $("principle").innerHTML = t.principle;
  $("hRoute").textContent = t.route; $("lFrom").textContent = t.from; $("lTo").textContent = t.to;
  $("swap").innerHTML = "&#8646; " + t.swap; $("hDisr").textContent = t.disruption;
  $("lTrain").textContent = t.trainService; $("clickHint").textContent = t.clickHint;
  $("lTram").textContent = t.showTram; $("hItin").textContent = t.itinerary;
  $("map").setAttribute("aria-label", t.mapAria);
  $("legend").innerHTML =
    `<span><i style="background:#B5378C"></i><i style="background:#ED6C23"></i><i style="background:#F6A90B"></i><i style="background:#0066A3"></i> ${t.metro}</span>
     <span><i style="background:var(--train)"></i> ${t.train}</span><span><i style="background:var(--tram)"></i> ${t.tram}</span>
     <span><i class="xchg"></i> ${t.interchange}</span><span><i style="background:var(--route)"></i> ${t.routeLbl}</span>`;
  $("foot").innerHTML = t.foot(NET.meta.counts.nodes, NET.meta.counts.cross_operator_interchanges);
  fillSelects(); buildChips();
}

/* ---------- init ---------- */
fromSel = $("from"); toSel = $("to");
const langSel = $("lang");
supported.forEach(k => langSel.appendChild(new Option(I18N[k].name, k)));
lang = detectLang(); langSel.value = lang;
langSel.onchange = () => { lang = langSel.value;
  try { localStorage.setItem("brufast.lang", lang); } catch (e) {}
  applyLang(); refresh(false); };
fromSel.onchange = toSel.onchange = () => render();
$("swap").onclick = () => { const a = fromSel.value; fromSel.value = toSel.value; toSel.value = a; render(); };
tramToggle.onchange = () => refresh(false);
applyLang(); refresh();
})();
