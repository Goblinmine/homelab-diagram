"use strict";
// Interactive homelab page. All content comes from data.js (window.LAB), written by build_site.py;
// nothing here knows a specific lab, the topology grid and edges come from the data too.

const LAB = window.LAB;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/** Build a DOM element; children may be strings, nodes, arrays, null/false (skipped). */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : String(kid));
  }
  return el;
}

function icon(name, size = 24, label = "") {
  if (name) return h("img", { class: "ico", src: `icons/${name}.svg`, width: size, height: size, alt: "" });
  return h("span", { class: "ico ico-letter", style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.5)}px` },
    (label || "?").charAt(0).toUpperCase());
}

/** Hostname as a link (when it has a URL) that doesn't trigger the surrounding card. */
function hostLink(text, url, cls = "hn") {
  if (!text) return null;
  if (!url) return h("span", { class: `${cls} plain mono` }, text);
  return h("a", { class: cls, href: url, target: "_blank", rel: "noopener", onclick: e => e.stopPropagation() }, text);
}

const NET = Object.fromEntries(LAB.networks.map(n => [n.key, n]));
const netColor = key => NET[key]?.color;
const netTag = key => (NET[key] ? (NET[key].tag.startsWith("VLAN") ? `${NET[key].tag} · ${NET[key].name}` : NET[key].tag) : key);
const SVC = new Map(LAB.services.map(s => [s.id, s]));
const DEV = LAB.devices;
const devName = id => DEV[id]?.name ?? id;
const KIND = { app: "Web app", service: "Service", "add-on": "Add-on", package: "Package", admin: "Admin UI" };
const KIND_PLURAL = { app: "Web apps", service: "Services", "add-on": "Add-ons", package: "Packages", admin: "Admin UIs" };
const EXPOSURE = { public: "public", local: "LAN / VPN only" };

document.title = LAB.meta.title;
$("#title").textContent = LAB.meta.title;
$("#date").textContent = LAB.meta.date;

function netPill(key) {
  const c = netColor(key);
  return c ? h("span", { class: "pill", style: `color:${c};border-color:${c}88` }, netTag(key)) : null;
}

// ================================================================ drawer
const drawer = $("#drawer"), scrim = $("#scrim");
let lastFocus = null;

function openDrawer(...kids) {
  $("#drawer-body").replaceChildren(...kids.flat(Infinity).filter(Boolean));
  lastFocus = document.activeElement;
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  scrim.hidden = false;
  drawer.scrollTop = 0;
  $("#drawer-close").focus();
}

function closeDrawer() {
  if (!drawer.classList.contains("open")) return;
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  scrim.hidden = true;
  lastFocus?.focus?.();
}

$("#drawer-close").addEventListener("click", closeDrawer);
scrim.addEventListener("click", closeDrawer);

/** Definition list; rows with an empty value are left out. */
function dl(rows) {
  return h("dl", null, rows.filter(([, v]) => v != null && v !== "").map(([k, v]) => [h("dt", null, k), h("dd", null, v)]));
}

const mono = s => s && h("span", { class: "mono" }, s);

function proxyText(name) {
  const p = LAB.proxies.find(x => x.name === name);
  return p ? `${p.name} (${p.where})` : name;
}

function svcButton(s) {
  return h("button", { class: "app", onclick: () => openService(s) },
    icon(s.icon, 18, s.name), h("span", { class: "nm" }, s.name),
    s.hostname ? hostLink(s.hostname, s.url) : h("span", { class: "hn plain" }, s.note || ""));
}

function openService(s) {
  const siblings = LAB.services.filter(x => x.where === s.where && x.host === s.host && x.id !== s.id);
  openDrawer(
    h("h2", { id: "drawer-title" }, icon(s.icon, 36, s.name), s.name),
    h("p", { class: "lead" }, KIND[s.kind] ?? s.kind),
    s.url && h("a", { class: "open-btn", href: s.url, target: "_blank", rel: "noopener" }, `Open ${s.hostname || s.url} ↗`),
    s.url && LAB.meta.access_note && h("p", { class: "note" }, LAB.meta.access_note),
    dl([
      ["Hostname", mono(s.hostname)],
      ["Runs on", `${devName(s.host)} › ${s.where}`],
      ["IP", mono(s.ip)],
      ["Reverse proxy", s.proxy && proxyText(s.proxy)],
      ["Reachable", EXPOSURE[s.exposure]],
      ["Note", s.note],
    ]),
    siblings.length > 0 && [h("div", { class: "label" }, `Also in ${s.where}`), h("div", { class: "list" }, siblings.map(svcButton))],
  );
}

function openDevice(d) {
  const svcs = LAB.services.filter(s => s.host === d.id && !(d.services || []).some(x => x.sid === s.id));
  const hasSection = LAB.hosts.some(x => x.device === d.id);
  openDrawer(
    h("h2", { id: "drawer-title" }, icon(d.icon, 36, d.name), d.name),
    h("p", { class: "lead" }, [d.type, d.model].filter(Boolean).join(" · ")),
    d.url && h("a", { class: "open-btn", href: d.url, target: "_blank", rel: "noopener" }, `Open ${d.hostname || d.url} ↗`),
    dl([["IP", mono(d.ip)], ["Hostname", mono(d.hostname)], ["OS", d.os], ["Network", d.net && netPill(d.net)], ["Setup", d.note]]),
    d.hw && [h("div", { class: "label" }, "Hardware"), dl(d.hw.map(p => [p.label.toLowerCase(), `${p.value} · ${p.sub}`]))],
    d.services && [h("div", { class: "label" }, "Services"),
      h("div", { class: "list" }, d.services.map(s => svcButton(SVC.get(s.sid))))],
    d.ports?.length > 0 && [h("div", { class: "label" }, "Ports"),
      dl(d.ports.map(p => [p.name, [p.to || "free", p.speed && ` · ${p.speed}`, p.vlans && ` · ${p.vlans}`].filter(Boolean).join("")]))],
    d.ssids && [h("div", { class: "label" }, "SSIDs"),
      dl(d.ssids.map(s => [s.name, h("span", null, s.nets.map(netPill))]))],
    svcs.length > 0 && [h("div", { class: "label" }, `Runs (${svcs.length})`), h("div", { class: "list" }, svcs.map(svcButton))],
    hasSection && h("p", null, h("a", {
      href: `#host-${d.id}`,
      onclick: e => { e.preventDefault(); closeDrawer(); showTab("overview"); $(`#host-${d.id}`).scrollIntoView({ behavior: "smooth" }); },
    }, "Show the full section ↓")),
  );
}

function openInternet() {
  const net = LAB.internet;
  openDrawer(
    h("h2", { id: "drawer-title" }, "Internet"),
    net.note && h("p", { class: "lead" }, net.note),
    net.speed && dl([["Down", net.speed.down], ["Up", net.speed.up]]),
    net.cloud.length > 0 && [h("div", { class: "label" }, "Cloud services"), dl(net.cloud.map(c => [c.name, c.note]))],
    h("div", { class: "label" }, "Open to the internet"),
    LAB.port_forwards.length
      ? dl(LAB.port_forwards.map(p => [`${p.port} ${p.proto}`, `${p.to} · ${p.what}`]))
      : h("p", { class: "muted" }, "No port forwards."),
  );
}

function openRemote() {
  const r = LAB.remote, n = NET[r.net];
  openDrawer(
    h("h2", { id: "drawer-title" }, icon(r.icon, 36), r.name),
    h("p", { class: "lead" }, r.note),
    n && dl([["Network", `${n.tag} · ${n.subnet}`], ["Policy", n.note]]),
  );
}

// ================================================================ tabs + search
const TABS = ["overview", "services", "diagram"];

function showTab(name) {
  if (!TABS.includes(name)) name = "overview";
  for (const b of $$(".tabs [data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
  for (const p of $$(".tab-panel")) p.hidden = p.id !== name;
  if (name === "diagram") diagram.init();
  if (name === "overview") requestAnimationFrame(drawWires);
  if (location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
}

for (const b of $$(".tabs [data-tab]")) b.addEventListener("click", () => showTab(b.dataset.tab));

const q = $("#q");
q.addEventListener("input", () => {
  if (q.value.trim() && $("#services").hidden) showTab("services");
  renderServices();
});
q.addEventListener("keydown", e => {
  if (e.key === "Escape") { q.value = ""; renderServices(); q.blur(); }
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeDrawer();
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (e.key === "/" && !typing) { e.preventDefault(); q.focus(); q.select(); }
});

// ================================================================ overview: stats
function renderStats() {
  const toKind = k => () => { filter.kind = k; filter.host = "all"; showTab("services"); renderFilters(); renderServices(); };
  const stats = [
    ...LAB.hosts.map(x => [x.groups.reduce((n, g) => n + g.guests.length, 0), `VMs + containers on ${devName(x.device)}`,
      () => $(`#host-${x.device}`).scrollIntoView({ behavior: "smooth" })]),
    [LAB.services.filter(s => s.kind === "app").length, "web apps", toKind("app")],
    [LAB.services.length, "services in total", toKind("all")],
    [LAB.networks.length, "networks", () => $("#info").scrollIntoView({ behavior: "smooth" })],
    [LAB.port_forwards.length, "port forwards", openInternet],
  ];
  $("#stats").replaceChildren(...stats.map(([n, t, fn]) => h("button", { class: "stat", onclick: fn }, h("b", null, n), h("span", null, t))));
}

// ================================================================ overview: topology
const SPEED_W = { "10G": 6, "2.5G": 3.6, "1G": 2.4, "100M": 1.4 };   // line width = link speed
const NARROW = matchMedia("(max-width: 1000px)");

function hoverAttrs(id) {
  return { onmouseenter: () => highlight(id), onmouseleave: () => highlight(null), onfocus: () => highlight(id), onblur: () => highlight(null) };
}

function nodeText(title, small, ...lines) {
  return h("div", { style: "min-width:0" }, h("div", { class: "t" }, title, small && h("small", null, small)), lines);
}

function topoNode(id) {
  const area = `grid-area:${CSS.escape(id)}`;
  if (id === "internet") {
    const net = LAB.internet;
    return h("button", { class: "node cloud", style: area, "data-node": id, onclick: openInternet, ...hoverAttrs(id) },
      nodeText("Internet", null, net.note && h("div", { class: "s" }, net.note),
        net.speed && h("div", { class: "s mono" }, `↓ ${net.speed.down} · ↑ ${net.speed.up}`)));
  }
  if (id === "cloud") {
    return h("div", { class: "cloud-list", style: area, "data-node": id },
      LAB.internet.cloud.map(c => h("button", { class: "node", onclick: openInternet, ...hoverAttrs(id) },
        icon(c.icon, 24, c.name), nodeText(c.name, null, h("div", { class: "s" }, c.note)))));
  }
  if (id === "remote") {
    const r = LAB.remote, c = netColor(r.net);
    return h("button", { class: "node", style: `${area};border-color:${c}aa`, "data-node": id, onclick: openRemote, ...hoverAttrs(id) },
      icon(r.icon, 34), nodeText(r.name, null, h("div", { class: "s" }, r.note)));
  }
  const d = DEV[id];
  if (!d) throw new Error(`topology area "${id}" has no device`);
  const c = netColor(d.net);
  const nsvc = LAB.services.filter(s => s.host === id).length;
  return h("button", { class: "node", style: `${area}${c ? `;border-color:${c}aa` : ""}`, "data-node": id, onclick: () => openDevice(d), ...hoverAttrs(id) },
    icon(d.icon, 40, d.name),
    nodeText(d.name, d.type, d.model && h("div", { class: "s" }, d.model),
      d.ip && h("div", { class: "a", style: c ? `color:${c}` : null }, [d.ip, d.hostname].filter(Boolean).join(" · ")),
      (d.os || nsvc > 0) && h("div", { class: "badges" }, d.os && h("span", { class: "pill" }, d.os),
        nsvc > 0 && h("span", { class: "pill" }, `${nsvc} services`))));
}

function layoutTopo() {
  const topo = $("#topo"), rows = LAB.topology.rows;
  if (NARROW.matches) {                          // one column, nodes in reading order
    const order = [...new Set(rows.flat().filter(a => a !== "."))];
    topo.style.gridTemplateColumns = "1fr";
    topo.style.gridTemplateAreas = order.map(a => `"${a}"`).join(" ");
  } else {
    topo.style.gridTemplateColumns = `repeat(${rows[0].length}, minmax(0, 1fr))`;
    topo.style.gridTemplateAreas = rows.map(r => `"${r.join(" ")}"`).join(" ");
  }
}

function renderTopo() {
  const topo = $("#topo");
  const ids = [...new Set(LAB.topology.rows.flat().filter(a => a !== "."))];
  topo.append(...ids.map(topoNode));
  layoutTopo();
  NARROW.addEventListener("change", layoutTopo);
  new ResizeObserver(drawWires).observe(topo);
  window.addEventListener("load", drawWires);
}

/** Orthogonal polyline with rounded corners (same as rounded() in build.py). */
function roundedPath(pts, r = 10) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const l1 = Math.hypot(x1 - x0, y1 - y0), l2 = Math.hypot(x2 - x1, y2 - y1);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const ax = l1 ? x1 - (x1 - x0) / l1 * rr : x1, ay = l1 ? y1 - (y1 - y0) / l1 * rr : y1;
    const bx = l2 ? x1 + (x2 - x1) / l2 * rr : x1, by = l2 ? y1 + (y2 - y1) / l2 * rr : y1;
    d += ` L${ax},${ay} Q${x1},${y1} ${bx},${by}`;
  }
  const [xe, ye] = pts[pts.length - 1];
  return d + ` L${xe},${ye}`;
}

function drawWires() {
  const topo = $("#topo"), svg = $("#wires");
  if (!topo.offsetParent || NARROW.matches) return;       // hidden tab, or stacked layout without lines
  const base = topo.getBoundingClientRect();
  const box = id => {
    const r = $(`[data-node="${CSS.escape(id)}"]`, topo).getBoundingClientRect();
    const b = { l: r.left - base.left, t: r.top - base.top, r: r.right - base.left, b: r.bottom - base.top };
    return { ...b, cx: (b.l + b.r) / 2, cy: (b.t + b.b) / 2 };
  };
  const NS = "http://www.w3.org/2000/svg";
  const add = (tag, attrs) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
    return el;
  };
  // edges leaving the same box downwards fan out a little, so parallel lines don't overlap
  const fan = {};
  for (const e of LAB.topology.edges) (fan[e.from] ??= []).push(e);

  svg.replaceChildren();
  for (const e of LAB.topology.edges) {
    let a = box(e.from), b = box(e.to);
    if (a.t >= b.b) [a, b] = [b, a];                       // always draw top → bottom
    let pts;
    if (b.t >= a.b - 1) {                                  // below: down, across, down
      const sib = fan[e.from].filter(x => box(x.to).t >= a.b - 1);
      const k = sib.indexOf(e);
      const x1 = Math.min(Math.max(a.cx + (k - (sib.length - 1) / 2) * 14, a.l + 16), a.r - 16);
      const x2 = Math.min(Math.max(x1, b.l + 40), b.r - 40);   // straight down when the target spans x1
      const my = (a.b + b.t) / 2 + (k - (sib.length - 1) / 2) * 6;
      pts = x1 === x2 ? [[x1, a.b], [x2, b.t]] : [[x1, a.b], [x1, my], [x2, my], [x2, b.t]];
    } else if (b.l >= a.r) {                               // to the right
      const mx = (a.r + b.l) / 2;
      pts = [[a.r, a.cy], [mx, a.cy], [mx, b.cy], [b.l, b.cy]];
    } else {                                               // to the left
      const mx = (b.r + a.l) / 2;
      pts = [[a.l, a.cy], [mx, a.cy], [mx, b.cy], [b.r, b.cy]];
    }
    const d = roundedPath(pts);
    const w = SPEED_W[e.speed] ?? 2.4;
    const meta = { "data-from": e.from, "data-to": e.to };
    if (e.style === "trunk") {                             // tagged trunk: light cable with a dark core
      add("path", { d, class: "trunk", "stroke-width": w + 3.4, ...meta });
      add("path", { d, class: "core", "stroke-width": Math.max(w - 1, 1), ...meta });
    } else {
      add("path", { d, class: e.style === "dotted" ? "dotted" : "solid", "stroke-width": e.style === "dotted" ? 1.8 : w,
        stroke: netColor(e.net) ?? (e.style === "dotted" ? "#5d6a7c" : "#6b7a90"), ...meta });
    }
    const label = e.label ?? e.speed;
    if (label) {
      const [xe, ye] = pts[pts.length - 1];
      add("text", { x: xe + 8, y: ye - 8 }).textContent = label;
    }
  }
}

function highlight(id) {
  const topo = $("#topo");
  topo.classList.toggle("hl", !!id);
  for (const el of $$(".on", topo)) el.classList.remove("on");
  if (!id) return;
  $(`[data-node="${CSS.escape(id)}"]`, topo).classList.add("on");
  for (const p of $$("#wires path", topo)) {
    if (p.dataset.from !== id && p.dataset.to !== id) continue;
    p.classList.add("on");
    $(`[data-node="${CSS.escape(p.dataset.from === id ? p.dataset.to : p.dataset.from)}"]`, topo).classList.add("on");
  }
}

// ================================================================ overview: info cards
function renderInfo() {
  const nets = h("div", { class: "card" }, h("h3", null, "Networks"),
    LAB.networks.map(n => h("div", { class: "row net", style: `--c:${n.color}` },
      h("div", null,
        h("div", null, h("span", { class: "tag" }, n.tag), " ", h("b", null, n.name)),
        h("div", { class: "muted small" }, n.note)),
      h("span", { class: "sub" }, n.subnet))));

  const pf = LAB.port_forwards;
  const open = h("div", { class: "card" }, h("h3", null, "Open to the internet"),
    pf.length
      ? pf.map(p => h("div", { class: "row" }, h("b", { class: "mono port" }, p.port),
          h("div", { style: "min-width:0" }, h("b", null, p.to), h("div", { class: "muted small" }, p.what)),
          h("span", { class: "pill", style: "margin-left:auto" }, p.proto)))
      : h("div", { class: "row" }, h("b", { class: "mono" }, "none"), h("span", { class: "muted" }, "no port forwards")),
    LAB.proxies.length > 0 && [h("div", { class: "label" }, "Reverse proxies"),
      LAB.proxies.map(p => h("div", { class: "row" },
        h("div", null, h("b", null, p.name), h("div", { class: "muted small" }, p.where)),
        h("span", { class: "mono small", style: "margin-left:auto;color:var(--link)" }, `*.${p.domain}`)))]);

  const bk = LAB.backups.length > 0 && h("div", { class: "card" }, h("h3", null, "Backups", h("span", { class: "muted" }, "where each copy goes")),
    LAB.backups.map(b => h("div", { class: "bk" },
      h("div", { class: "box" }, h("div", { class: "n" }, icon(b.from_icon, 20, b.from), b.from), h("div", { class: "d" }, b.from_sub)),
      h("div", { class: "how" }, h("b", null, b.how), h("span", { class: "arrow" }, "→"), h("span", { class: "muted" }, b.sub)),
      h("div", { class: "box" }, h("div", { class: "n" }, icon(b.to_icon, 20, b.to), b.to), h("div", { class: "d" }, b.to_sub)))));

  $("#info").replaceChildren(...[nets, open, bk].filter(Boolean));
}

// ================================================================ overview: host sections
function guestCard(g) {
  const single = g.sid ? SVC.get(g.sid) : null;
  const apps = g.apps.map(sid => SVC.get(sid));
  const addons = (g.addons || []).map(sid => SVC.get(sid));
  const c = netColor(g.net);
  return h("div", {
    class: "guest", style: `${c ? `--c:${c};` : ""}${single ? "cursor:pointer" : ""}`,
    onclick: single ? () => openService(single) : null,
  },
  g.docker && h("span", { class: "docker", title: "runs its apps as Docker containers" }, icon("docker", 16)),
  h("div", { class: "guest-head" },
    h("span", { class: "gicons" }, (g.icons.length ? g.icons.slice(0, 2) : [null]).map(i => icon(i, 28, g.name)),
      g.badge && h("span", { class: "gbadge" }, icon(g.badge, 16))),
    h("div", { style: "min-width:0" },
      h("div", { class: "nm" }, g.name),
      h("div", { class: "note" }, g.note),
      g.hostname && h("div", null, hostLink(g.hostname, g.url),
        g.exposure === "local" && h("span", { class: "pill", style: "margin-left:6px" }, "LAN"))),
    h("div", { class: "ids" }, g.label, h("br"), g.ip)),
  apps.length > 0 && h("div", { class: "apps" }, apps.map(svcButton)),
  addons.length > 0 && h("div", { class: "addons" }, addons.map(s => h("button", { onclick: () => openService(s) },
    s.icon && icon(s.icon, 14), s.name))));
}

function pool(p) {
  return h("div", { class: "pool" },
    h("div", { class: "top-line" }, h("b", null, p.name), h("span", { class: "muted" }, p.layout)),
    h("div", { class: "muted small" }, p.used),
    h("div", { class: "bar" }, h("i", { class: p.pct >= (p.warn ?? 85) ? "warn" : null, "data-pct": p.pct })),
    p.groups.map(gr => h("div", { class: "muted small" }, [gr.label, gr.sub, gr.sub2].filter(Boolean).join(" · "))));
}

function renderHosts() {
  $("#hosts").replaceChildren(...LAB.hosts.map(x => {
    const d = DEV[x.device];
    return h("section", { class: "host-sec", id: `host-${d.id}` },
      h("div", { class: "host-head" }, icon(d.icon, 48, d.name),
        h("div", null,
          h("h2", null, d.name, h("small", null, d.type)),
          h("div", { class: "meta" }, [d.model, d.os].filter(Boolean).join(" · "), " · ",
            h("span", { class: "mono accent" }, d.ip), d.hostname && [" · ", hostLink(d.hostname, d.url)]))),
      h("div", { class: "host-body" },
        d.hw && h("div", null, h("div", { class: "label" }, "Hardware"),
          h("div", { class: "hw" }, d.hw.map(p => h("div", { class: "hw-tile" }, icon(p.icon, 26),
            h("div", null, h("div", { class: "k" }, p.label), h("div", { class: "v" }, p.value),
              h("div", { class: `d${p.sub.includes("passthrough") ? " pt" : ""}` }, p.sub)))))),
        h("div", { style: "min-width:0" },
          (x.storage || []).map(st => [h("div", { class: "label" }, st.label),
            h("div", { class: "pools" }, st.pools.map(pool)), st.note && h("p", { class: "muted small" }, st.note)]),
          x.groups.map(g => [h("div", { class: "label" }, g.label, g.net && netPill(g.net)),
            h("div", { class: "guests" }, g.guests.map(guestCard))]),
          x.packages && [h("div", { class: "label" }, x.packages.label),
            h("div", { class: "pkgs" }, x.packages.items.map(p => h("button", { class: "pkg", onclick: () => openService(SVC.get(p.sid)) },
              icon(p.icon, 20, p.name), p.name)))])));
  }));

  // usage bars fill when they scroll into view
  const io = new IntersectionObserver(entries => {
    for (const en of entries) if (en.isIntersecting) { en.target.style.width = `${en.target.dataset.pct}%`; io.unobserve(en.target); }
  });
  for (const bar of $$(".bar i[data-pct]")) io.observe(bar);
}

// ================================================================ services tab
const filter = { host: "all", kind: "all" };

function renderFilters() {
  const chipGroup = (key, options) => h("div", { class: "chips", role: "group" }, options.map(([val, label, n]) =>
    h("button", {
      "aria-pressed": String(filter[key] === val),
      onclick: () => { filter[key] = val; renderFilters(); renderServices(); },
    }, label, h("span", null, n))));
  const hostIds = [...new Set(LAB.services.map(s => s.host))];
  const kinds = [...new Set(LAB.services.map(s => s.kind))];
  $("#filters").replaceChildren(
    chipGroup("host", [["all", "All devices", LAB.services.length],
      ...hostIds.map(id => [id, devName(id), LAB.services.filter(s => s.host === id).length])]),
    chipGroup("kind", [["all", "All kinds", LAB.services.length],
      ...kinds.map(k => [k, KIND_PLURAL[k] ?? k, LAB.services.filter(s => s.kind === k).length])]),
  );
}

/** Text with every occurrence of the search terms wrapped in <mark>. */
function marked(text, terms) {
  if (!terms.length || !text) return text;
  const re = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return text.split(re).map((part, i) => (i % 2 ? h("mark", null, part) : part));
}

function renderServices() {
  const terms = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = LAB.services.filter(s => {
    if (filter.host !== "all" && s.host !== filter.host) return false;
    if (filter.kind !== "all" && s.kind !== filter.kind) return false;
    const hay = [s.name, s.hostname, s.where, s.note, s.ip, devName(s.host), s.proxy, KIND[s.kind], EXPOSURE[s.exposure]].join(" ").toLowerCase();
    return terms.every(t => hay.includes(t));
  });
  $("#svc-grid").replaceChildren(...list.map(s => h("button", { class: "svc", onclick: () => openService(s) },
    icon(s.icon, 32, s.name),
    h("div", { class: "body" },
      h("div", { class: "nm" }, marked(s.name, terms)),
      s.hostname && hostLink(s.hostname, s.url),
      h("div", { class: "where" }, `${devName(s.host)} › ${s.where}`),
      h("div", { class: "tags" },
        h("span", { class: "pill" }, KIND[s.kind] ?? s.kind),
        s.proxy && h("span", { class: "pill link" }, s.proxy),
        s.exposure === "local" && h("span", { class: "pill" }, "LAN / VPN only"),
        s.ip && h("span", { class: "pill mono" }, s.ip))))));
  $("#svc-empty").hidden = list.length > 0;
}

// ================================================================ diagram tab (the SVG from build.py, pan + zoom)
const diagram = (() => {
  const vp = $("#viewport"), cv = $("#canvas");
  let s = 1, x = 0, y = 0, ready = false, svgW = 1, svgH = 1;
  const apply = () => { cv.style.transform = `translate(${x}px,${y}px) scale(${s})`; };

  function fit() {
    s = Math.min(vp.clientWidth / svgW, vp.clientHeight / svgH);
    x = (vp.clientWidth - svgW * s) / 2;
    y = (vp.clientHeight - svgH * s) / 2;
    apply();
  }

  function zoomAt(f, cx = vp.clientWidth / 2, cy = vp.clientHeight / 2) {
    const ns = Math.min(6, Math.max(0.05, s * f));
    x = cx - (cx - x) * ns / s;
    y = cy - (cy - y) * ns / s;
    s = ns;
    apply();
  }

  function init() {
    if (ready) return;
    ready = true;
    if (!LAB.diagram) {
      cv.append(h("p", { class: "muted pad" }, "No diagram yet: run build.py, then build_site.py."));
      return;
    }
    cv.innerHTML = LAB.diagram;                // generated by build.py, trusted
    const svg = cv.querySelector("svg");
    svgW = svg.viewBox.baseVal.width;
    svgH = svg.viewBox.baseVal.height;
    requestAnimationFrame(fit);

    vp.addEventListener("wheel", e => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    // drag to pan; a click without movement still follows the links in the SVG
    let drag = null, moved = false;
    vp.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      drag = { px: e.clientX, py: e.clientY, x, y, id: e.pointerId };
      moved = false;
    });
    vp.addEventListener("pointermove", e => {
      if (!drag) return;
      const dx = e.clientX - drag.px, dy = e.clientY - drag.py;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      if (!moved) { moved = true; vp.setPointerCapture(drag.id); vp.classList.add("dragging"); }
      x = drag.x + dx;
      y = drag.y + dy;
      apply();
    });
    const end = () => { drag = null; vp.classList.remove("dragging"); };
    vp.addEventListener("pointerup", end);
    vp.addEventListener("pointercancel", end);
    vp.addEventListener("click", e => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);

    for (const b of $$("[data-zoom]")) b.addEventListener("click", () => {
      if (b.dataset.zoom === "fit") fit(); else zoomAt(b.dataset.zoom === "in" ? 1.3 : 1 / 1.3);
    });
  }

  return { init };
})();

// ================================================================ start
renderStats();
renderTopo();
renderInfo();
renderHosts();
renderFilters();
renderServices();
showTab(location.hash.slice(1));
window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));
