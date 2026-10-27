/* ============================================================
   NASTAVENÍ
   ============================================================ */
const CONFIG = {
  SHEET_ID: "1sQmZIy-5heJWsP9A5GzJphVdTh_xjd_qKzZ2xPrbosA",
  TAB: "Zadávání",       // jediný list, do kterého se píšou výsledky
  SWITCH_SECONDS: 15,    // po kolika sekundách se přepne další pohled
  REFRESH_SECONDS: 30,   // jak často se znovu stáhnou data z Google
  DISCIPLINE_PAGE_SIZE: 10
};

const DISCIPLINES = [
  { name: "Bench press", key: "bench press", unit: "opak." },
  { name: "Mrtvý tah",   key: "mrtvý tah",   unit: "opak." },
  { name: "Dřep",        key: "dřep",        unit: "opak." },
  { name: "Shyby",       key: "shyby",       unit: "opak." },
  { name: "Trojskok",    key: "trojskok",    unit: "cm" }
];
/* ============================================================ */

const $ = (id) => document.getElementById(id);
let people = null;      // načtení závodníci
let current = 0;
let currentPage = 0;
let switchTimer = null;
let scrollFrame = null;

/* CSV parser (uvozovky, čárky, nové řádky v buňkách) */
function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { 
        cell += '"'; 
        i++; 
      }
      else if (c === '"') {
        inQ = false;
      }
      else {
        cell += c;
        }
    } 
    else if (c === '"') {
        inQ = true;
        }
    else if (c === ",") { 
        row.push(cell); 
        cell = ""; 
        }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") {
        i++;
        }
      row.push(cell); 
      cell = ""; 
      rows.push(row); 
      row = [];
    } 
    else {
        cell += c;
        }
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const num = (v) => {
  const n = parseFloat(String(v || "").replace(/\s/g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
};
const fmt = (n) => (Math.round(n * 10) / 10).toString().replace(".", ",");

let lastError = "";
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

async function fetchRows(extra) {
  const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv&headers=0${extra}&_=${Date.now()}`;
  console.log(url);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  if (text.trim().startsWith("<")) throw new Error("Google chce přihlášení – tabulka není sdílená přes odkaz");
  return parseCSV(text);
}

/* Když v načtených datech chybí záhlaví, použije se pevné rozložení sloupců listu Zadávání:
   A č. | B jméno | C škola | D váha | E váha 75 % | F,G bench | H,I mrtvý tah | J,K dřep | L,M shyby | N,O trojskok | P body celkem */
const FIXED = { name: 1, school: 2, total: 15,
  d: { "bench press": [5, 6], "mrtvý tah": [7, 8], "dřep": [9, 10], "shyby": [11, 12], "trojskok": [13, 14] } };

function parseFixed(rows) {
  const data = rows.filter(r => /^\d+$/.test((r[0] || "").trim()));
  if (!data.length) return null;
  return data.map(r => {
    const p = { name: (r[FIXED.name] || "").trim(), school: (r[FIXED.school] || "").trim(),
                total: num(r[FIXED.total]), d: {} };
    DISCIPLINES.forEach(d => {
      const [v, b] = FIXED.d[d.key];
      p.d[d.key] = { v: num(r[v]), b: num(r[b]) };
    });
    return p;
  }).filter(p => p.name || p.total > 0);
}

function parsePeople(rows) {
  const hi = rows.findIndex(r => r.some(c => norm(c).includes("body celkem")));
  if (hi < 0) return parseFixed(rows);
  const head = rows[hi].map(norm);
  const find = (test) => head.findIndex(test);
  const iName = find(h => h.includes("jméno"));
  const iSchool = find(h => h === "škola" || h.includes("škola"));
  const iTotal = find(h => h.includes("body celkem"));
  const idx = {};
  DISCIPLINES.forEach(d => {
    idx[d.key] = {
      v: find(h => h.includes(d.key) && h.includes("výkon")),
      b: find(h => h.includes(d.key) && h.includes("body"))
    };
  });
  const at = (r, i) => (i >= 0 ? (r[i] || "").trim() : "");
  return rows.slice(hi + 1).map(r => {
    const p = { name: at(r, iName), school: at(r, iSchool), total: num(at(r, iTotal)), d: {} };
    DISCIPLINES.forEach(d => {
      p.d[d.key] = { v: num(at(r, idx[d.key].v)), b: num(at(r, idx[d.key].b)) };
    });
    return p;
  }).filter(p => p.name || p.total > 0);
}

async function load() {
  // 1) podle názvu listu, 2) první list v tabulce, 3) list s gid=0
  const attempts = [
    `&sheet=${encodeURIComponent(CONFIG.TAB)}`,
    ``,
    `&gid=0`
  ];
  let lastRows = null, err = "";
  for (const extra of attempts) {
    try {
      const rows = await fetchRows(extra);
      lastRows = rows;
      const res = parsePeople(rows);
      if (res) { people = res; return; }
    } catch (e) { err = e.message; }
  }
  if (lastRows) {
    const peek = lastRows.slice(0, 4).map(r => r.slice(0, 8).join(" | ")).join("  //  ");
    throw new Error('Záhlaví "Body celkem" nenalezeno. Načtený list začíná: ' + peek.slice(0, 300));
  }
  throw new Error(err || "Data se nepodařilo načíst");
}

/* pořadí se stejným počtem bodů = stejné místo */
function ranked(list, valueOf) {
  list.sort((x, y) => valueOf(y) - valueOf(x));
  let rank = 0, last = null;
  return list.map((it, i) => {
    const v = valueOf(it);
    if (v !== last) { rank = i + 1; last = v; }
    return { rank, it };
  });
}

const VIEWS = [
  { name: "Celkové pořadí", build: () => ({
      head: ["Pořadí", "Jméno a příjmení", "Škola", "Body celkem"],
      rows: ranked(people.filter(p => p.total > 0), p => p.total)
        .map(({ rank, it }) => [rank + ".", it.name || "—", it.school, fmt(it.total)])
  }) },
  ...DISCIPLINES.map(d => ({ name: d.name, paginated: true, build: () => ({
      head: ["Pořadí", "Jméno a příjmení", "Škola", `Výkon (${d.unit})`, "Body"],
      rows: ranked(people.filter(p => p.d[d.key].v > 0), p => p.d[d.key].v)
        .map(({ rank, it }) => [rank + ".", it.name || "—", it.school, fmt(it.d[d.key].v), fmt(it.d[d.key].b)])
  }) })),
  { name: "Družstva", build: () => {
      const teams = {};
      people.filter(p => p.school).forEach(p => {
        (teams[p.school] = teams[p.school] || { school: p.school, total: 0, n: 0 });
        teams[p.school].total += p.total;
        teams[p.school].n += 1;
      });
      const list = Object.values(teams).filter(t => t.total > 0);
      return {
        head: ["Pořadí", "Škola", "Body družstva"],
        rows: ranked(list, t => t.total).map(({ rank, it }) => [rank + ".", it.school, fmt(it.total)])
      };
  } }
];

const esc = (s) => String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

function renderColgroup(head, rows) {
  const lengths = head.map((label, i) => Math.max(
    String(label).length,
    ...rows.map(row => String(row[i] || "").length)
  ));
  const weights = lengths.map(length => Math.min(Math.max(length, 4), 30));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return "<colgroup>" + weights.map(weight =>
    `<col style="width:${(weight / total * 100).toFixed(2)}%">`
  ).join("") + "</colgroup>";
}

function render() {
  const v = VIEWS[current];
  $("title").textContent = v.name;
  document.querySelectorAll("#tabs button").forEach((b, i) =>
    b.setAttribute("aria-current", i === current ? "true" : "false"));
  const view = $("view");
  if (!people) {
    view.innerHTML = '<div class="msg">Data nejsou k dispozici.<br>' + esc(lastError || "Načítám…") + '</div>';
    return;
  }
  const { head, rows: allRows } = v.build();
  const pageCount = Math.max(1, Math.ceil(allRows.length / CONFIG.DISCIPLINE_PAGE_SIZE));
  currentPage = Math.min(currentPage, pageCount - 1);
  const rows = v.paginated
    ? allRows.slice(
        currentPage * CONFIG.DISCIPLINE_PAGE_SIZE,
        (currentPage + 1) * CONFIG.DISCIPLINE_PAGE_SIZE
      )
    : allRows;
  if (!rows.length) {
    view.innerHTML = '<div class="msg">Zatím nejsou zadané žádné výsledky.</div>';
    return;
  }
  const renderRows = (tableRows) =>
    tableRows.map(r => "<tr>" + r.map(c => `<td>${esc(c)}</td>`).join("") + "</tr>").join("");
  const staticRows = rows.slice(0, 5);
  const scrollingRows = rows.slice(5);
  const colgroup = renderColgroup(head, rows);
  view.innerHTML =
    '<div class="table-static"><table>' + colgroup + "<thead><tr>" + head.map(h => `<th>${esc(h)}</th>`).join("") +
    "</tr></thead><tbody>" + renderRows(staticRows) + "</tbody></table></div>" +
    (scrollingRows.length
      ? '<div class="table-scroll"><table>' + colgroup + "<tbody>" + renderRows(scrollingRows) + "</tbody></table></div>"
      : "");
}

function startAutoScroll(duration) {
  cancelAnimationFrame(scrollFrame);
  const view = document.querySelector("#view .table-scroll");
  if (!view) return;
  view.scrollTop = 0;
  const distance = view.scrollHeight - view.clientHeight;
  if (distance <= 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const started = performance.now();
  const step = (now) => {
    const progress = Math.min((now - started) / duration, 1);
    view.scrollTop = distance * progress;
    if (progress < 1) scrollFrame = requestAnimationFrame(step);
  };
  scrollFrame = requestAnimationFrame(step);
}

async function refreshAll() {
  try {
    await load();
    $("status").textContent = "Aktualizováno " + new Date().toLocaleTimeString("cs-CZ");
  } catch (e) {
    lastError = e.message;
    $("status").textContent = "Chyba: " + e.message;
    console.error(e);
  }
  render();
}

function startProgress() {
  const bar = $("bar");
  bar.style.transition = "none";
  bar.style.width = "0";
  void bar.offsetWidth;
  bar.style.transition = `width ${CONFIG.SWITCH_SECONDS}s linear`;
  bar.style.width = "100%";
}

function show(i) {
  current = (i + VIEWS.length) % VIEWS.length;
  currentPage = 0;
  render();
  startProgress();
  clearTimeout(switchTimer);
  const view = VIEWS[current];
  const rows = people ? view.build().rows : [];
  const pageCount = view.paginated
    ? Math.max(1, Math.ceil(rows.length / CONFIG.DISCIPLINE_PAGE_SIZE))
    : 1;
  const pageSeconds = CONFIG.SWITCH_SECONDS / pageCount;
  startAutoScroll(pageSeconds * 1000);
  const advance = () => {
    if (view.paginated && currentPage + 1 < pageCount) {
      currentPage++;
      render();
      startAutoScroll(pageSeconds * 1000);
      switchTimer = setTimeout(advance, pageSeconds * 1000);
    } else {
      show(current + 1);
    }
  };
  switchTimer = setTimeout(advance, pageSeconds * 1000);
}

function init() {
  const nav = $("tabs");
  VIEWS.forEach((v, i) => {
    const b = document.createElement("button");
    b.textContent = v.name;
    b.onclick = () => show(i);
    nav.appendChild(b);
  });
  refreshAll().then(() => show(0));
  setInterval(refreshAll, CONFIG.REFRESH_SECONDS * 1000);
}
init();