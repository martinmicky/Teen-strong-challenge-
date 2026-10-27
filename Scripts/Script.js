/* =========================
   Configuration
   ========================= */
const CONFIG = {
  SHEET_ID: "1sQmZIy-5heJWsP9A5GzJphVdTh_xjd_qKzZ2xPrbosA",
  TAB: "Zadávání",
  SWITCH_SECONDS: 15,
  REFRESH_SECONDS: 30,
  DISCIPLINE_PAGE_SIZE: 10,
  AUTO_SCROLL_DELAY_SECONDS: 1,
  AUTO_SCROLL_END_DELAY_SECONDS: 1
};

const DISCIPLINES = [
  { name: "Bench press", key: "bench press", unit: "opak." },
  { name: "Mrtvý tah", key: "mrtvý tah", unit: "opak." },
  { name: "Dřep", key: "dřep", unit: "opak." },
  { name: "Shyby", key: "shyby", unit: "opak." },
  { name: "Trojskok", key: "trojskok", unit: "cm" }
];

/* =========================
   Application state
   ========================= */
const getElement = (id) => document.getElementById(id);

// These values are updated as data loads and as the automatic presentation advances.
let people = null;
let lastError = "";
let current = 0;
let currentPage = 0;
let switchTimer = null;
let scrollFrame = null;
let scrollStartTimer = null;

/* =========================
   Data parsing and loading
   ========================= */
function parseCSV(text) {
  // A small CSV parser is used instead of split(",") because cells may contain
  // commas, quoted text, or line breaks.
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const character = text[i];

    if (inQuotes) {
      if (character === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[i + 1] === "\n") {
        i++;
      }
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else {
        cell += character;
    }
  }

  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function parseNumber(value) {
  const number = parseFloat(
    String(value || "").replace(/\s/g, "").replace(",", ".")
  );
  return isNaN(number) ? 0 : number;
}

function formatNumber(number) {
  return (Math.round(number * 10) / 10).toString().replace(".", ",");
}

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

async function fetchRows(queryParameters) {
  const url =
    `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}` +
    `/gviz/tq?tqx=out:csv&headers=0${queryParameters}&_=${Date.now()}`;

  console.log(url);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("HTTP " + response.status);

  const text = await response.text();
  if (text.trim().startsWith("<")) {
    throw new Error(
        "Google chce přihlášení – tabulka není sdílená přes odkaz"
    );
  }

  return parseCSV(text);
}

const FIXED_COLUMNS = {
  name: 1,
  school: 2,
  total: 15,
  disciplines: {
    "bench press": [5, 6],
    "mrtvý tah": [7, 8],
    "dřep": [9, 10],
    "shyby": [11, 12],
    "trojskok": [13, 14]
  }
};

function parseFixed(rows) {
  // Fallback for sheets whose header row cannot be detected. These indexes
  // match the fixed layout of the "Zadávání" sheet.
  const data = rows.filter(r => /^\d+$/.test((r[0] || "").trim()));
  if (!data.length) return null;

  return data.map(r => {
    const person = {
      name: (r[FIXED_COLUMNS.name] || "").trim(),
      school: (r[FIXED_COLUMNS.school] || "").trim(),
      total: parseNumber(r[FIXED_COLUMNS.total]),
      disciplines: {}
    };

    DISCIPLINES.forEach(d => {
      const [performanceColumn, pointsColumn] =
        FIXED_COLUMNS.disciplines[d.key];
      person.disciplines[d.key] = {
        performance: parseNumber(r[performanceColumn]),
        points: parseNumber(r[pointsColumn])
      };
    });

    return person;
  }).filter(person => person.name || person.total > 0);
}

function parsePeople(rows) {
  // Prefer column names so the display keeps working if the sheet is reordered.
  const headerIndex = rows.findIndex(row =>
    row.some(cell => normalize(cell).includes("body celkem"))
  );
  if (headerIndex < 0) return parseFixed(rows);

  const headers = rows[headerIndex].map(normalize);
  const findColumn = (test) => headers.findIndex(test);
  const nameColumn = findColumn(header => header.includes("jméno"));
  const schoolColumn = findColumn(
    header => header === "škola" || header.includes("škola")
  );
  const totalColumn = findColumn(header => header.includes("body celkem"));
  const disciplineColumns = {};

  DISCIPLINES.forEach(d => {
    disciplineColumns[d.key] = {
      performance: findColumn(
        header => header.includes(d.key) && header.includes("výkon")
      ),
      points: findColumn(
        header => header.includes(d.key) && header.includes("body")
      )
    };
  });

  const getCell = (row, column) =>
    column >= 0 ? (row[column] || "").trim() : "";

  return rows
    .slice(headerIndex + 1)
    .map(row => {
      const person = {
        name: getCell(row, nameColumn),
        school: getCell(row, schoolColumn),
        total: parseNumber(getCell(row, totalColumn)),
        disciplines: {}
      };

      DISCIPLINES.forEach(discipline => {
        const columns = disciplineColumns[discipline.key];
        person.disciplines[discipline.key] = {
          performance: parseNumber(getCell(row, columns.performance)),
          points: parseNumber(getCell(row, columns.points))
        };
      });

      return person;
    })
    .filter(person => person.name || person.total > 0);
}

async function load() {
  const queryAttempts = [
    `&sheet=${encodeURIComponent(CONFIG.TAB)}`,
    ``,
    `&gid=0`
  ];

  let lastRows = null;
  let errorMessage = "";

  for (const queryParameters of queryAttempts) {
    try {
      const rows = await fetchRows(queryParameters);
      lastRows = rows;
      const parsedPeople = parsePeople(rows);
      if (parsedPeople) {
        people = parsedPeople;
        return;
      }
    } catch (error) {
      errorMessage = error.message;
    }
  }

  if (lastRows) {
    const preview = lastRows
      .slice(0, 4)
      .map(row => row.slice(0, 8).join(" | "))
      .join("  //  ");
    throw new Error(
      'Záhlaví "Body celkem" nenalezeno. Načtený list začíná: ' +
      preview.slice(0, 300)
    );
  }

  throw new Error(errorMessage || "Data se nepodařilo načíst");
}

function rankRows(items, getValue) {
  // Sorting mutates the supplied array, but each caller passes a new filtered
  // array, so the loaded source data remains unchanged.
  items.sort((a, b) => getValue(b) - getValue(a));

  let rank = 0;
  let previousValue = null;
  return items.map((item, index) => {
    const value = getValue(item);
    if (value !== previousValue) {
      rank = index + 1;
      previousValue = value;
    }
    return { rank, item };
  });
}

const VIEWS = [
  {
    name: "Celkové pořadí",
    build: () => ({
      head: ["Pořadí", "Jméno a příjmení", "Škola", "Body celkem"],
      rows: rankRows(
        people.filter(person => person.total > 0),
        person => person.total
      ).map(({ rank, item }) => [
        rank + ".",
        item.name || "—",
        item.school,
        formatNumber(item.total)
      ])
    })
  },
  ...DISCIPLINES.map(discipline => ({
    name: discipline.name,
    paginated: true,
    build: () => ({
      head: [
        "Pořadí",
        "Jméno a příjmení",
        "Škola",
        `Výkon (${discipline.unit})`,
        "Body"
      ],
      rows: rankRows(
        people.filter(
          person => person.disciplines[discipline.key].performance > 0
        ),
        person => person.disciplines[discipline.key].performance
      ).map(({ rank, item }) => {
        const result = item.disciplines[discipline.key];
        return [
          rank + ".",
          item.name || "—",
          item.school,
          formatNumber(result.performance),
          formatNumber(result.points)
        ];
      })
    })
  })),
  {
    name: "Družstva",
    build: () => {
      const teams = {};
      people.filter(person => person.school).forEach(person => {
        const team = teams[person.school] || {
          school: person.school,
          total: 0,
          count: 0
        };
        team.total += person.total;
        team.count += 1;
        teams[person.school] = team;
      });

      const teamList = Object.values(teams).filter(team => team.total > 0);
      return {
        head: ["Pořadí", "Škola", "Body družstva"],
        rows: rankRows(teamList, team => team.total).map(({ rank, item }) => [
          rank + ".",
          item.school,
          formatNumber(item.total)
        ])
      };
    }
  }
];

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"]/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;"
    }[character])
  );

function renderColgroup(head, rows) {
  // Both table sections receive the same <colgroup>; widths are based on the
  // longest header or cell value so their columns line up.
  const lengths = head.map((label, columnIndex) =>
    Math.max(
      String(label).length,
      ...rows.map(row => String(row[columnIndex] || "").length)
    )
  );
  const weights = lengths.map(length => Math.min(Math.max(length, 4), 30));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return (
    "<colgroup>" +
    weights
      .map(weight => `<col style="width:${(weight / total * 100).toFixed(2)}%">`)
      .join("") +
    "</colgroup>"
  );
}

function render() {
  const viewDefinition = VIEWS[current];
  getElement("title").textContent = viewDefinition.name;
  document.querySelectorAll("#tabs button").forEach((b, i) =>
    b.setAttribute("aria-current", i === current ? "true" : "false")
  );

  const view = getElement("view");
  if (!people) {
    view.innerHTML =
      '<div class="msg">Data nejsou k dispozici.<br>' +
      escapeHtml(lastError || "Načítám…") +
      "</div>";
    return;
  }

  const { head, rows: allRows } = viewDefinition.build();
  const pageCount = Math.max(
    1,
    Math.ceil(allRows.length / CONFIG.DISCIPLINE_PAGE_SIZE)
  );
  currentPage = Math.min(currentPage, pageCount - 1);

  const rows = viewDefinition.paginated
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
    tableRows
      .map(row =>
        "<tr>" +
        row.map(cell => `<td>${escapeHtml(cell)}</td>`).join("") +
        "</tr>"
      )
      .join("");

  const staticRows = rows.slice(0, 5);
  const scrollingRows = rows.slice(5);
  const colgroup = renderColgroup(head, rows);
  const headerCells = head
    .map(header => `<th>${escapeHtml(header)}</th>`)
    .join("");
  const staticTable =
    '<div class="table-static"><table>' +
    colgroup +
    "<thead><tr>" +
    headerCells +
    "</tr></thead><tbody>" +
    renderRows(staticRows) +
    "</tbody></table></div>";
  const scrollingTable = scrollingRows.length
    ? '<div class="table-scroll"><table>' +
      colgroup +
      "<tbody>" +
      renderRows(scrollingRows) +
      "</tbody></table></div>"
    : "";

  view.innerHTML = staticTable + scrollingTable;
}

function startAutoScroll(duration) {
  // The first five rows are outside .table-scroll and therefore stay visible.
  // Only the remaining rows are animated.
  cancelAnimationFrame(scrollFrame);
  clearTimeout(scrollStartTimer);
  const view = document.querySelector("#view .table-scroll");
  if (!view) return;
  view.scrollTop = 0;
  const distance = view.scrollHeight - view.clientHeight;
  if (distance <= 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const delay = CONFIG.AUTO_SCROLL_DELAY_SECONDS * 1000;
  scrollStartTimer = setTimeout(() => {
    const started = performance.now();
    const step = (now) => {
      const progress =
        duration === 0 ? 1 : Math.min((now - started) / duration, 1);
      view.scrollTop = distance * progress;
      if (progress < 1) scrollFrame = requestAnimationFrame(step);
    };
    scrollFrame = requestAnimationFrame(step);
  }, delay);
}

async function refreshAll() {
  try {
    await load();
    getElement("status").textContent =
      "Aktualizováno " + new Date().toLocaleTimeString("cs-CZ");
  } catch (error) {
    lastError = error.message;
    getElement("status").textContent = "Chyba: " + error.message;
    console.error(error);
  }

  render();
}

function startProgress() {
  const bar = getElement("bar");
  bar.style.transition = "none";
  bar.style.width = "0";
  void bar.offsetWidth;
  bar.style.transition = `width ${CONFIG.SWITCH_SECONDS}s linear`;
  bar.style.width = "100%";
}

function show(i) {
  // A discipline may have several 10-row pages, but all pages share the
  // discipline's normal display interval.
  current = (i + VIEWS.length) % VIEWS.length;
  currentPage = 0;
  render();
  startProgress();
  clearTimeout(switchTimer);
  const viewDefinition = VIEWS[current];
  const rows = people ? viewDefinition.build().rows : [];
  const pageCount = viewDefinition.paginated
    ? Math.max(
        1,
        Math.ceil(rows.length / CONFIG.DISCIPLINE_PAGE_SIZE)
      )
    : 1;
  const pageSeconds = CONFIG.SWITCH_SECONDS / pageCount;
  const endDelay = viewDefinition.paginated
    ? CONFIG.AUTO_SCROLL_END_DELAY_SECONDS
    : 0;
  // Each page is divided into: top pause, scrolling, and bottom pause.
  const scrollTime = Math.max(
    pageSeconds - CONFIG.AUTO_SCROLL_DELAY_SECONDS - endDelay,
    0
  );
  startAutoScroll(scrollTime * 1000);
  const advance = () => {
    if (viewDefinition.paginated && currentPage + 1 < pageCount) {
      currentPage++;
      render();
      startAutoScroll(scrollTime * 1000);
      switchTimer = setTimeout(advance, pageSeconds * 1000);
    } else {
      show(current + 1);
    }
  };
  switchTimer = setTimeout(advance, pageSeconds * 1000);
}

function init() {
  const navigation = getElement("tabs");
  VIEWS.forEach((view, index) => {
    const b = document.createElement("button");
    b.textContent = view.name;
    b.onclick = () => show(index);
    navigation.appendChild(b);
  });

  refreshAll().then(() => show(0));
  setInterval(refreshAll, CONFIG.REFRESH_SECONDS * 1000);
}

init();