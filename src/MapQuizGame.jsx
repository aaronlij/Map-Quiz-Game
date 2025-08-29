import React, { useEffect, useRef, useState } from "react";
import { ComposableMap, Geographies, Geography, ZoomableGroup } from "react-simple-maps";

/**
 * Map Quiz Game – Stable Build r5a (ASCII-safe)
 *
 * Fixes for "Expecting Unicode escape sequence \uXXXX":
 *  - Removed non-ASCII characters from string literals and JSX (replaced with ASCII or \u escapes).
 *  - Fixed accidental backslash-escaped JSX attributes (e.g., className=\"...\").
 *  - Kept existing behavior and tests; added ASCII-safe versions.
 *
 * Features retained from r5:
 *  - Light/Dark mode (persisted in localStorage)
 *  - Lives (5) with Game Over overlay + Reset
 *  - Countdown mode (10/20/30/60s) that subtracts a life on timeout
 *  - High score per dataset+mode (localStorage)
 *  - Datasets: World, USA-48, Canada, Mexico, India, UK Countries, UK Counties, Australia, NYC Boroughs, Israel (from /public/data/israel.json)
 */

/******************** Utils ********************/
const safeList = (v) => (Array.isArray(v) ? v : []);
const isNum = (x) => typeof x === "number" && isFinite(x);
const norm = (s) =>
  (s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Validate that a feature has usable polygon coordinates */
function isRenderableFeature(f) {
  if (!f || !f.geometry) return false;
  const { type, coordinates } = f.geometry;
  if (!coordinates) return false;
  const hasFirstNumber = (arr) =>
    Array.isArray(arr) && arr.length > 0 &&
    Array.isArray(arr[0]) && arr[0].length > 0 &&
    Array.isArray(arr[0][0]) && arr[0][0].length > 0 &&
    isNum(arr[0][0][0]);
  if (type === "Polygon") return hasFirstNumber(coordinates);
  if (type === "MultiPolygon") return Array.isArray(coordinates) && coordinates.length > 0 && hasFirstNumber(coordinates[0]);
  return false; // ignore non-polygons
}

// Utility: pick a readable name from varying UK property keys (plain JS)
function pickName(props, keys) {
  keys = Array.isArray(keys) && keys.length
    ? keys
    : ["name", "NAME", "NAME_1", "NAME_2"];
  if (!props || typeof props !== "object") return "";
  // Try preferred keys in order
  for (const k of keys) {
    const v = props[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  // Fallback: first non-empty string prop (handles ctyua17nm, lad18nm, etc.)
  for (const k in props) {
    const v = props[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

// --- UK-specific name resolver (handles ONS fields & code->name) ---
const UK_COUNTRY_CODE_MAP = {
  E92000001: "England",
  S92000003: "Scotland",
  W92000004: "Wales",
  N92000002: "Northern Ireland",
};

function pickNameUK(props) {
  if (!props || typeof props !== "object") return "";

  // Prefer known *name* fields used in UK datasets
  const candidates = [
    props.name, props.NAME, props.NAME_1, props.NAME_2,
    props.ctry17nm, props.ctry19nm, props.ctry20nm, props.country,
    props.ctyua17nm, props.ctyua19nm, props.lad17nm, props.lad18nm,
    props.area_name, props.layer, props.laua_name
  ].filter(v => typeof v === "string" && v.trim());

  if (candidates.length) return candidates[0];

  // Map common code fields -> country name (for nations layer)
  const code =
    props.ctry17cd || props.ctry19cd || props.gss_code ||
    props.ctyua17cd || props.lad17cd || props.lad18cd ||
    props.code || props.id;

  if (typeof code === "string" && UK_COUNTRY_CODE_MAP[code]) {
    return UK_COUNTRY_CODE_MAP[code];
  }

  // If the only string looks like a GSS code (e.g., E92000001), return empty
  // so the feature is filtered out rather than prompting with a code.
  if (typeof code === "string" && /^[A-Z]{1,3}\d{5,}$/.test(code)) return "";

  // As a last resort, pick the first string prop that's not code-like
  for (const k in props) {
    const v = props[k];
    if (typeof v === "string" && v.trim() && !/^[A-Z]{1,3}\d{5,}$/.test(v)) {
      return v;
    }
  }
  return "";
}

/******************** Datasets ********************/
const CTH = (slug) => `https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/${slug}.geojson`;

const DATASETS = {
  world: {
    label: "World",
    url: "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json",
    projection: { name: "geoEqualEarth", scale: 160, center: [0, 20] },
    getName: (geo) => geo?.properties?.name || geo?.properties?.NAME || "",
    exploreScope: "country",
  },
  usa48: {
    label: "USA",
    url: CTH("united-states"),
    projection: { name: "geoEqualEarth", scale: 700, center: [-98, 38] },
    getName: (geo) => geo?.properties?.name || geo?.properties?.NAME || "",
    exploreScope: { country: "United States" },
    filter: (name) => !["alaska","hawaii","puerto rico","guam","american samoa","northern mariana islands","united states virgin islands","district of columbia"].includes(norm(name)),
  },
  canada: {
    label: "Canada",
    url: CTH("canada"),
    projection: { name: "geoEqualEarth", scale: 380, center: [-96, 62] },
    getName: (geo) => geo?.properties?.name || geo?.properties?.NAME || "",
    exploreScope: { country: "Canada" },
  },
  mexico: {
    label: "Mexico",
    url: CTH("mexico"),
    projection: { name: "geoEqualEarth", scale: 900, center: [-102, 24] },
    getName: (geo) => geo?.properties?.name || geo?.properties?.NAME || "",
    exploreScope: { country: "Mexico" },
  },
  india: {
    label: "India",
    url: CTH("india"),
    projection: { name: "geoEqualEarth", scale: 1100, center: [79, 22] },
    getName: (geo) => geo?.properties?.name || geo?.properties?.NAME || "",
    exploreScope: { country: "India" },
  },
  israel: {
    label: "Israel",
    // load from your repo's public folder to avoid CORS/license surprises
    url: "/data/israel.json",
    projection: { name: "geoEqualEarth", scale: 5200, center: [35.2, 31.7] },
    getName: (geo) => geo?.properties?.name || geo?.properties?.NAME || geo?.properties?.district || geo?.properties?.District || geo?.properties?.name_en || geo?.properties?.english_name || "",
    exploreScope: { country: "Israel" },
  },
uk_countries: {
  label: "UK",
  url: "/data/topo_uk_level_1.json", // you uploaded this to public/data/
  projection: { name: "geoEqualEarth", scale: 1300, center: [-2, 54] },
  getName: (geo) => pickNameUK(geo && geo.properties),
  exploreScope: { country: "United Kingdom" },
},
uk_counties: {
  label: "UK (Counties)",
  url: "/data/topo_uk_level_2.json",
  projection: { name: "geoEqualEarth", scale: 1300, center: [-2, 54] },
  getName: (geo) => pickNameUK(geo && geo.properties),
  exploreScope: { country: "United Kingdom" },
},
  australia: {
    label: "Australia",
    url: CTH("australia"),
    projection: { name: "geoEqualEarth", scale: 900, center: [134, -25] },
    getName: (geo) => geo?.properties?.name || geo?.properties?.NAME || "",
    exploreScope: { country: "Australia" },
  },
  nyc: {
    label: "NYC",
    url: CTH("new-york-city-boroughs"),
    projection: { name: "geoEqualEarth", scale: 30000, center: [-73.94, 40.70] },
    getName: (geo) => geo?.properties?.name || geo?.properties?.boro_name || geo?.properties?.NAME || "",
    exploreScope: { city: "New York City", country: "United States" },
  },
};

const DATASET_ORDER = [
  "world",
  "usa48",
  "nyc",
  "canada",
  "australia",
  "uk_countries",
  "uk_counties",
  "mexico",
  "india",
  "israel"
];

const MODES = { explore: "Explore", click: "Click", type: "Type" };

/******************** Matching ********************/
const NAME_ALIASES = {
  // Canada (sample)
  ontario: ["on"], quebec: ["qc", "pq", "quebec"], "newfoundland and labrador": ["newfoundland", "nl"],
  "prince edward island": ["pei"], "nova scotia": ["ns"], "new brunswick": ["nb"], "british columbia": ["bc"],
  "northwest territories": ["nwt"], nunavut: ["nu"], yukon: ["yt"],
  // US postal (sample)
  alabama:["al"], alaska:["ak"], arizona:["az"], arkansas:["ar"], california:["ca"], colorado:["co"],
  connecticut:["ct"], delaware:["de"], florida:["fl"], georgia:["ga"], hawaii:["hi"], idaho:["id"],
  illinois:["il"], indiana:["in"], iowa:["ia"], kansas:["ks"], kentucky:["ky"], louisiana:["la"],
  maine:["me"], maryland:["md"], massachusetts:["ma"], michigan:["mi"], minnesota:["mn"],
  mississippi:["ms"], missouri:["mo"], montana:["mt"], nebraska:["ne"], nevada:["nv"],
  "new hampshire":["nh"], "new jersey":["nj"], "new mexico":["nm"], "new york":["ny"],
  "north carolina":["nc"], "north dakota":["nd"], ohio:["oh"], oklahoma:["ok"], oregon:["or"],
  pennsylvania:["pa"], "rhode island":["ri"], "south carolina":["sc"], "south dakota":["sd"],
  tennessee:["tn"], texas:["tx"], utah:["ut"], vermont:["vt"], virginia:["va"], washington:["wa"],
  "west virginia":["wv"], wisconsin:["wi"], wyoming:["wy"],
  // World exonyms
  "cote d'ivoire":["ivory coast", "cote divoire"], czechia:["czech republic"], eswatini:["swaziland"], myanmar:["burma"],
  "democratic republic of the congo":["drc","dr congo","congo-kinshasa"], "republic of the congo":["congo-brazzaville"],
  "united states of america":["united states","usa","us"], "united kingdom":["uk","great britain","britain"],
};
const matchesAnswer = (answer, canonical) => {
  const a = norm(answer), c = norm(canonical);
  if (a === c) return true;
  const aliases = NAME_ALIASES[c] || [];
  return aliases.some((alt) => norm(alt) === a);
};

/******************** Explore data fetchers ********************/
async function fetchCountryInfo(countryName) {
  try {
    const full = `https://restcountries.com/v3.1/name/${encodeURIComponent(countryName)}?fullText=true`;
    let res = await fetch(full);
    let data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      const loose = `https://restcountries.com/v3.1/name/${encodeURIComponent(countryName)}`;
      res = await fetch(loose);
      data = await res.json();
    }
    if (Array.isArray(data) && data.length > 0) {
      const c = data[0] || {};
      const capital = safeList(c.capital)[0] || "";
      return {
        name: c?.name?.common || countryName,
        official: c?.name?.official || countryName,
        population: c?.population,
        capital,
        region: c?.region,
        subregion: c?.subregion,
        flag: c?.flags?.svg || c?.flags?.png,
        coat: c?.coatOfArms?.svg || c?.coatOfArms?.png,
        area: c?.area,
        languages: c?.languages,
        currencies: c?.currencies,
      };
    }
  } catch (_) {}
  return null;
}

async function fetchSubnationalInfo(name, context) {
  const tryTitles = [
    context?.city ? `${name}, ${context.city}` : null,
    context?.country ? `${name}, ${context.country}` : null,
    context?.country ? `${name} (${context.country})` : null,
    `${name} (state)`, `${name} (province)`, `${name} (district)`, `${name} (territory)`,
    name,
  ].filter(Boolean);
  for (const title of tryTitles) {
    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const j = await res.json();
      const image = j?.originalimage?.source || j?.thumbnail?.source || null;
      return {
        title: j?.title || name,
        description: j?.description || j?.extract || "",
        summary: j?.extract || "",
        image,
        flag: null,
        coat: null,
        sourceUrl: j?.content_urls?.desktop?.page || null,
      };
    } catch (_) { /* try next */ }
  }
  return { title: name, description: "", summary: "", image: null, flag: null, coat: null, sourceUrl: null };
}

/******************** Merged Geographies (for multi-file datasets) ********************/
function MergedGeographies({ urls, children }) {
  const [fc, setFc] = useState(null);
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const parts = await Promise.all(urls.map(async (u) => {
          try { const r = await fetch(u); const j = await r.json(); return j; } catch { return null; }
        }));
        const features = [];
        for (const j of parts) {
          const list = j?.features || [];
          for (const f of list) if (isRenderableFeature(f)) features.push(f);
        }
        if (!cancel) setFc({ type: "FeatureCollection", features });
      } catch { if (!cancel) setFc({ type: "FeatureCollection", features: [] }); }
    })();
    return () => { cancel = true; };
  }, [urls && urls.join(",")]);

  if (!fc) return children({ geographies: [] });
  return (
    <Geographies geography={fc}>{children}</Geographies>
  );
}

/******************** Component ********************/
export default function MapQuizGame() {
  
  // Zoom settings
const MIN_ZOOM = 0.5;   // was 0.8
const MAX_ZOOM = 24;    // was 8
const ZOOM_STEP = 1.8;  // was 1.5
  // THEME
  const [theme, setTheme] = useState(() => (typeof localStorage !== "undefined" && localStorage.getItem("mqg_theme")) || "light");
  useEffect(() => { try { localStorage.setItem("mqg_theme", theme); } catch {} }, [theme]);

 // Sync theme-color meta with current theme
useEffect(() => {
  const barColor = theme === "dark" ? "#0b0f14" : "#ffffff";
  let tag = document.querySelector('meta[name="theme-color"]');
  if (!tag) {
    tag = document.createElement("meta");
    tag.name = "theme-color";
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", barColor);
}, [theme]);


  // UI state
  const [dataset, setDataset] = useState("world");
  const [mode, setMode] = useState("click"); // explore | click | type

  // Hard mode toggles (Click mode only)
 const [hardMode, setHardMode] = useState(false);

  // Game state
  const [prompt, setPrompt] = useState(null);
  const [input, setInput] = useState("");
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [lives, setLives] = useState(5);
  const [message, setMessage] = useState("");
  const [gameOver, setGameOver] = useState(false);

  // Visual feedback for Click mode card: 'correct' | 'wrong' | null
const [flash, setFlash] = useState(null);
const flashTimerRef = useRef(null);
const triggerFlash = (kind) => {
  if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
  setFlash(kind);
  flashTimerRef.current = setTimeout(() => setFlash(null), 600);
};

  // High score per dataset+mode
  const hsKey = (d=dataset,m=mode) => `mqg_hs_v1_${d}_${m}`;
  const [highScore, setHighScore] = useState(() => Number((typeof localStorage !== "undefined" && localStorage.getItem(hsKey())) || 0));
  useEffect(() => { try { setHighScore(Number(localStorage.getItem(hsKey())) || 0); } catch {} }, [dataset, mode]);
  const bumpHighScore = (val) => {
    try {
      if (val > (Number(localStorage.getItem(hsKey())) || 0)) {
        localStorage.setItem(hsKey(), String(val));
        setHighScore(val);
      }
    } catch {}
  };

  // Explore state
  const [selectedName, setSelectedName] = useState(null);
  const [info, setInfo] = useState(null);
  const [modalImg, setModalImg] = useState(null);

  // Zoom/pan state
  const [zoom, setZoom] = useState(1);

  // Geography load tracking
  const namesRef = useRef([]);
  const lastLenRef = useRef(0);
  const [geoVersion, setGeoVersion] = useState(0);

  const conf = DATASETS[dataset];

  // Countdown timer
  const [timerOn, setTimerOn] = useState(false);
  const [duration, setDuration] = useState(20); // seconds
  const [timeLeft, setTimeLeft] = useState(duration);
  useEffect(() => { setTimeLeft(duration); }, [duration, dataset, mode, geoVersion]);
  useEffect(() => {
    if (!timerOn || gameOver || (mode !== "click" && mode !== "type")) return;
    const id = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          setLives((l) => {
            const next = Math.max(0, l - 1);
            if (next === 0) setGameOver(true);
            return next;
          });
          return duration; // restart timer
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timerOn, duration, mode, gameOver]);

  // Reset on dataset change
  useEffect(() => {
    setZoom(1);
    setMessage("");
    setPrompt(null);
    setSelectedName(null);
    setInfo(null);
    setLives(5);
    setGameOver(false);
  }, [dataset]);

  // Regenerate prompt when features load or mode changes
  useEffect(() => {
    if ((mode === "click" || mode === "type") && namesRef.current.length) {
      const list = namesRef.current;
      setPrompt(list[Math.floor(Math.random() * list.length)] || null);
      setInput("");
      setMessage("");
      setTimeLeft(duration);
    } else if (mode !== "explore") {
      setPrompt(null);
    }
  }, [geoVersion, mode, dataset]);

  const onGeoClick = (geo) => {
    if (gameOver) return;
    const name = conf.getName(geo);
    if (!name) return;

    if (mode === "explore") {
      setSelectedName(name);
      setInfo(null);
      if (conf.exploreScope === "country") {
        fetchCountryInfo(name).then(setInfo);
      } else {
        fetchSubnationalInfo(name, conf.exploreScope).then(setInfo);
      }
      return;
    }

    if (mode === "click") {
    if (!prompt) return;

    // correct click
    if (norm(name) === norm(prompt)) {
      setScore((s) => { const val = s + 1; bumpHighScore(val); return val; });
      setStreak((s) => s + 1);
      setMessage("Correct!");
      triggerFlash('correct');
      const list = namesRef.current;
      if (list.length) setPrompt(list[Math.floor(Math.random() * list.length)]);
      setTimeLeft(duration);
    } else {
      // wrong click -> lose a life, reset streak, show what they clicked,
      // and choose a new prompt (preferably not the same as the old prompt or the clicked region)
      setStreak(0);
      setLives((l) => {
        const next = Math.max(0, l - 1);
        if (next === 0) setGameOver(true);
        return next;
      });
      setMessage(`That was ${name}.`);
      triggerFlash('wrong');


      // build candidate list excluding the previous prompt and the clicked name
      const all = namesRef.current || [];
      const candidates = all.filter((n) => norm(n) !== norm(prompt) && norm(n) !== norm(name));

      if (candidates.length) {
        setPrompt(candidates[Math.floor(Math.random() * candidates.length)]);
      } else {
        // fallback: pick anything except the old prompt
        const fallback = all.filter((n) => norm(n) !== norm(prompt));
        setPrompt(fallback.length ? fallback[Math.floor(Math.random() * fallback.length)] : null);
      }

      setTimeLeft(duration);
    }
    return;
  }

    if (mode === "type") {
      setMessage("A region is highlighted. Type its name to score.");
    }
  };

  const submitTyped = (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (gameOver || !prompt) return;
    if (matchesAnswer(input, prompt)) {
      setScore((s) => { const val = s + 1; bumpHighScore(val); return val; });
      setStreak((s) => s + 1);
      setMessage("Correct!");
      setInput("");
      const list = namesRef.current;
      if (list.length) setPrompt(list[Math.floor(Math.random() * list.length)]);
      setTimeLeft(duration);
    } else {
      setStreak(0);
      setLives((l) => {
        const next = Math.max(0, l - 1);
        if (next === 0) setGameOver(true);
        return next;
      });
      setMessage("Not quite. Try again.");
      setInput("");
      setTimeLeft(duration);
    }
  };

  const resetAll = () => {
    setScore(0); setStreak(0); setLives(5); setMessage(""); setInput(""); setPrompt(null); setGameOver(false); setSelectedName(null); setInfo(null); setTimeLeft(duration);
  };

  const highlightName = mode === "type" ? prompt : null;

  // Theme palette via CSS variables
  const vars = theme === "dark" ? {
    "--bg":"#0b0f14",
    "--text":"#e5e7eb",
    "--card":"#111827",
    "--border":"#1f2937",
    "--map":"#374151",
    "--stroke":"#9CA3AF",
    "--hover":"#F59E0B",
    "--pressed":"#D97706",
    "--hl":"#10B981",
  } : {
    "--bg":"#ffffff",
    "--text":"#111827",
    "--card":"#fafafa",
    "--border":"#e5e7eb",
    "--map":"#E5E7EB",
    "--stroke":"#6B7280",
    "--hover":"#F59E0B",
    "--pressed":"#FDE68A",
    "--hl":"#A7F3D0",
  };

const baseFill = "var(--map)";
const isHard = hardMode && mode === "click";
const strokeColor = isHard ? "transparent" : "var(--stroke)";
const strokeWidth = isHard ? 0 : 0.5;
const hoverFill = isHard ? baseFill : "var(--hover)";
const pressedFill = isHard ? baseFill : "var(--pressed)";

  // Light CSS (no framework)
  const css = `
    .mqg-root{min-height:100vh;box-sizing:border-box;padding:16px;background:var(--bg);color:var(--text)}
    .mqg-container{max-width:1200px;margin:0 auto}
    .mqg-header{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;justify-content:space-between;margin-bottom:12px}
    .mqg-title{font-size:28px;font-weight:700;margin:0}
    .mqg-selects{display:flex;gap:8px;flex-wrap:wrap}
    .mqg-btn,.mqg-select,.mqg-input{border:1px solid var(--border);border-radius:10px;padding:8px 12px;background:var(--card);color:var(--text)}
    .mqg-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}
@media(min-width:900px){
  .mqg-grid { grid-template-columns: 2fr 360px; }  /* map gets more space */
}
.mqg-card.map-card {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--card);
  display: flex;
  flex-direction: column;
}
.mqg-map-container {
  flex: 1;
  width: 100%;
  height: calc(100vh - 120px);
}
.mqg-map-container svg {
  width: 100%;
  height: 100%;
}

    .mqg-stat{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center}
    .mqg-stat .box{border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--bg)}
    .mqg-zoom{display:flex;gap:8px}
    .mqg-message{border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--bg);font-size:14px}
    .mqg-label{font-size:11px;letter-spacing:.04em;opacity:.8;text-transform:uppercase}
    .mqg-strong{font-weight:600}
    .mqg-flex-row{display:flex;gap:12px;align-items:center}
    .mqg-modal{position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:50}
    .mqg-img{max-height:90vh;max-width:90vw}
    .mqg-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .mqg-meter{font-variant-numeric:tabular-nums}
    .mqg-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;color:white;z-index:60}
    .mqg-panel{background:#111827;border-radius:12px;padding:24px;min-width:280px;border:1px solid #374151}
    .mqg-panel h2{margin:0 0 8px 0}
    .mqg-flag {
  height: 40px;
  width: auto;           /* prevent width:100% rules from stretching */
  max-width: 100%;
  object-fit: contain;
  display: block;
  margin: 8px 0;
}
.mqg-coat {
  height: 40px;
  width: auto;
  object-fit: contain;
  display: block;
  margin: 8px auto;      /* center smaller emblem */
}
/* flash feedback on the message box */
.mqg-msg {
  border:1px solid var(--border);
  border-radius:10px;
  padding:10px;
  background:var(--bg);
  font-size:14px;
  transition: background-color .25s ease, box-shadow .25s ease, border-color .25s ease;
}
.mqg-msg.mqg-correct {
  background: rgba(16,185,129,.25);  /* green fill */
  border-color: rgba(16,185,129,.8);
  box-shadow: 0 0 0 2px rgba(16,185,129,.4) inset;
}
.mqg-msg.mqg-wrong {
  background: rgba(239,68,68,.25);   /* red fill */
  border-color: rgba(239,68,68,.8);
  box-shadow: 0 0 0 2px rgba(239,68,68,.4) inset;
}
html, body { background: var(--bg); margin: 0;
  padding: 0;
  min-height: 100%; }
.mqg-root {
  padding-top: max(16px, env(safe-area-inset-top));
  padding-bottom: max(16px, env(safe-area-inset-bottom));
  padding-left: max(16px, env(safe-area-inset-left));
  padding-right: max(16px, env(safe-area-inset-right));
}

  `;

  // Geo renderer
  const GeoLayer = ({ children }) => {
    if (conf?.urls) {
      return <MergedGeographies urls={conf.urls}>{children}</MergedGeographies>;
    }
    return <Geographies geography={conf.url}>{children}</Geographies>;
  };

  return (
    <div className="mqg-root" style={vars}>
      <style>{css}</style>
      <div className="mqg-container">
        <header className="mqg-header">
          <div className="mqg-row">
            <h1 className="mqg-title">Map Quiz Game</h1>
            <button className="mqg-btn" onClick={()=> setTheme(t=> t==='light'?'dark':'light')}>{theme === 'light' ? 'Dark' : 'Light'} mode</button>
          </div>
          <div className="mqg-selects">
            <select className="mqg-select" value={dataset} onChange={(e)=> setDataset(e.target.value)} aria-label="Dataset">
              {DATASET_ORDER.map((key) => {
    const ds = DATASETS[key];
    return (
      <option key={key} value={key}>
        {ds.label}
      </option>
    );
  })}
            </select>
            <select className="mqg-select" value={mode} onChange={(e)=>{setMode(e.target.value); setMessage(''); setInput('');}} aria-label="Mode">
              {Object.entries(MODES).map(([key,label])=> (<option key={key} value={key}>{label}</option>))}
            </select>
            <button className="mqg-btn" onClick={resetAll}>Reset</button>
          </div>
        </header>

        <section className="mqg-grid">
          
   <div className="mqg-card map-card">
  <div className="mqg-map-container">
    <ComposableMap
      projection={conf.projection.name}
      projectionConfig={{ scale: conf.projection.scale }}
    >
        <ZoomableGroup
          zoom={zoom}
          center={conf.projection.center}
          minZoom={typeof MIN_ZOOM !== "undefined" ? MIN_ZOOM : 0.8}
          maxZoom={typeof MAX_ZOOM !== "undefined" ? MAX_ZOOM : 8}
        >
          <GeoLayer>
            {({ geographies }) => {
              const raw = safeList(geographies);
              const list = raw.filter((g) => {
                if (!isRenderableFeature(g)) return false;
                const nm = conf.getName(g);
                if (!nm) return false;
                if (typeof conf.filter === "function" && !conf.filter(nm)) return false;
                return true;
              });

              namesRef.current = list.map((g) => conf.getName(g));

              if (lastLenRef.current !== list.length) {
                lastLenRef.current = list.length;
                setTimeout(() => setGeoVersion((v) => v + 1), 0);
              }

              if (list.length === 0) {
                return (
                  <g>
                    <text x={0} y={20} style={{ fill: "currentColor", fontSize: 12 }}>
                      No regions loaded for this dataset. Try another dataset or source.
                    </text>
                  </g>
                );
              }

              return list.map((geo, idx) => {
                const name = conf.getName(geo);
                const isHL = !!highlightName && norm(name) === norm(highlightName);
                const key = geo.rsmKey || name || idx;
                return (
                  <Geography
                    key={key}
                    geography={geo}
                    onClick={() => onGeoClick(geo)}
                    style={{
                      default: {
                        fill: isHL ? "var(--hl)" : baseFill,
                        stroke: strokeColor,
                        strokeWidth,
                        outline: "none",
                      },
                      hover: { fill: isHL ? "var(--hl)" : hoverFill, outline: "none" },
                      pressed: { fill: isHL ? "var(--hl)" : pressedFill, outline: "none" },
                    }}
                  />
                );
              });
            }}
          </GeoLayer>
        </ZoomableGroup>
      </ComposableMap>
    </div>
  </div>

  <aside
    className="mqg-card mqg-pad"
    style={{ display: "flex", flexDirection: "column", gap: 12 }}
  >
    <div className="mqg-stat">
      <div className="box">
        <div className="mqg-label">Score</div>
        <div className="mqg-strong" style={{ fontSize: 22 }}>{score}</div>
      </div>
      <div className="box">
        <div className="mqg-label">Streak</div>
        <div className="mqg-strong" style={{ fontSize: 22 }}>{streak}</div>
      </div>
      <div className="box">
        <div className="mqg-label">Lives</div>
        <div className="mqg-strong" style={{ fontSize: 22 }}>{lives}</div>
      </div>
    </div>

    <div className="mqg-row mqg-meter">
      <div className="mqg-label">High score:</div>
      <div className="mqg-strong">{highScore}</div>
    </div>

    <div className="mqg-zoom">
      <button
        className="mqg-btn"
        onClick={() =>
          setZoom((z) =>
            Math.max(typeof MIN_ZOOM !== "undefined" ? MIN_ZOOM : 0.8, z / (typeof ZOOM_STEP !== "undefined" ? ZOOM_STEP : 1.5))
          )
        }
      >
        -
      </button>
      <button
        className="mqg-btn"
        onClick={() =>
          setZoom((z) =>
            Math.min(typeof MAX_ZOOM !== "undefined" ? MAX_ZOOM : 8, z * (typeof ZOOM_STEP !== "undefined" ? ZOOM_STEP : 1.5))
          )
        }
      >
        +
      </button>
      <button className="mqg-btn" onClick={() => setZoom(1)}>Reset View</button>
    </div>

    {(mode === "click" || mode === "type") && (
      <div className="mqg-row">
        <label className="mqg-label">Countdown:</label>
        <input
          type="checkbox"
          checked={timerOn}
          onChange={(e) => setTimerOn(e.target.checked)}
        />
        <select
          className="mqg-select"
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          disabled={!timerOn}
        >
          {[10, 20, 30, 60].map((s) => (
            <option key={s} value={s}>
              {s}s
            </option>
          ))}
        </select>
        {timerOn && <span className="mqg-strong mqg-meter">Time left: {timeLeft}s</span>}
      </div>
    )}

    {mode === "click" && (
     <div className="mqg-card mqg-pad" style={{ background: "var(--bg)" }}>
        <div className="mqg-label">Click this region</div>
        <div
  className="mqg-strong"
  aria-live="polite"
  style={{ fontSize: 28, marginTop: 4 }}
>
  {prompt || "Loading..."}
</div>
        <div
          className="mqg-flex-row"
          style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}
        >
          <label className="mqg-flex-row" style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              checked={hardMode}
              onChange={(e) => setHardMode(e.target.checked)}
            />{" "}
            HARD MODE!
          </label>
        </div>
      </div>
    )}

    {mode === "type" && (
      <form
        onSubmit={submitTyped}
        className="mqg-card mqg-pad"
        style={{ background: "var(--bg)", display: "flex", flexDirection: "column", gap: 8 }}
      >
        <div className="mqg-label">Type the highlighted region</div>
        <input
          className="mqg-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Start typing the name... (aliases OK)"
          aria-label="Type region name"
        />
        <button type="submit" className="mqg-btn">Submit</button>
      </form>
    )}

{message && (
  <div
    className={
      "mqg-msg " +
      (flash === "correct" ? "mqg-correct" : flash === "wrong" ? "mqg-wrong" : "")
    }
  >
    {message}
  </div>
)}

    {mode === "explore" && selectedName && (
      <div className="mqg-card mqg-pad" style={{ background: "var(--bg)" }}>
        <div
  className="mqg-strong"
  style={{ fontSize: 28, marginBottom: 8 }}
>
  {selectedName}
</div>
        {info ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {info.flag && (
  <img
    src={info.flag}
    alt="flag"
    className="mqg-flag"
    style={{ cursor: "zoom-in" }}
    onClick={() => setModalImg(info.flag)}
  />
)}
{info.coat && (
  <img
    src={info.coat}
    alt="coat of arms"
    className="mqg-coat"
    style={{ cursor: "zoom-in" }}
    onClick={() => setModalImg(info.coat)}
  />
)}
{info.image && !info.flag && (
  <img
    src={info.image}
    alt="image"
    style={{ height: 96, width: "auto", objectFit: "contain", cursor: "zoom-in" }}
    onClick={() => setModalImg(info.image)}
  />
)}

            {info.official && (
              <div>
                <strong>Official:</strong> {info.official}
              </div>
            )}
            {info.capital && (
              <div>
                <strong>Capital:</strong> {info.capital}
              </div>
            )}
            {info.population && (
              <div>
                <strong>Population:</strong>{" "}
                {info.population?.toLocaleString?.()}
              </div>
            )}
            {info.area && (
              <div>
                <strong>Area:</strong> {info.area?.toLocaleString?.()} km^2
              </div>
            )}
            {(info.region || info.subregion) && (
              <div>
                <strong>Region:</strong> {info.region}
                {info.subregion ? ` - ${info.subregion}` : ""}
              </div>
            )}
            {info.summary && (
              <p style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.25 }}>
                {info.summary}
              </p>
            )}
            {info.sourceUrl && (
              <a
                href={info.sourceUrl}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 12, color: "#60a5fa", textDecoration: "underline" }}
              >
                Wikipedia
              </a>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 14, opacity: 0.7 }}>Loading details...</div>
        )}
      </div>
    )}
      </aside>
  </section>
</div>

      {modalImg && (
        <div className="mqg-modal" onClick={()=> setModalImg(null)}>
          <img src={modalImg} alt="zoom" className="mqg-img" />
        </div>
      )}

      {gameOver && (
        <div className="mqg-overlay" role="dialog" aria-modal="true">
          <div className="mqg-panel">
            <h2>Game Over</h2>
            <div className="mqg-row"><div className="mqg-label">Score</div><div className="mqg-strong">{score}</div></div>
            <div className="mqg-row"><div className="mqg-label">High Score</div><div className="mqg-strong">{highScore}</div></div>
            <div className="mqg-row" style={{marginTop:12}}>
              <button className="mqg-btn" onClick={resetAll}>Play Again</button>
            </div>
          </div>
        </div>
      )}

      {/* DEV TESTS - keep existing, add ASCII-safe */}
      {typeof window !== "undefined" && (
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try { if (!window.__MAP_QUIZ_TESTED__) {
                window.__MAP_QUIZ_TESTED__ = true;
                function assert(name, cond){ console[cond ? 'log' : 'error']('Test ' + (cond ? 'passed' : 'failed') + ':', name); }
                const normFn = ${norm.toString()};
                assert('norm(Que\u00E9bec) -> quebec', normFn('Qu\u00E9bec') === 'quebec');
                const matchFn = ${matchesAnswer.toString()};
                assert('matches PEI', matchFn('PEI','Prince Edward Island') === true);
                assert('matches NY', matchFn('NY','New York') === true);
                assert('matches Ivory Coast', matchFn('Ivory Coast',"Cote d'Ivoire") === true);
                const safeListFn = ${safeList.toString()};
                assert('safeList(null) -> []', Array.isArray(safeListFn(null)) && safeListFn(null).length === 0);
                assert('safeList(undefined) -> []', Array.isArray(safeListFn(undefined)) && safeListFn(undefined).length === 0);
                const isRenderable = ${isRenderableFeature.toString()};
                const nullGeom = { geometry: null };
                const emptyPoly = { geometry: { type: 'Polygon', coordinates: [] } };
                const badPoly = { geometry: { type: 'Polygon', coordinates: [[], []] } };
                const goodPoly = { geometry: { type: 'Polygon', coordinates: [[[0,0],[1,1],[1,0],[0,0]]] } };
                const goodMulti = { geometry: { type: 'MultiPolygon', coordinates: [[[[0,0],[1,1],[1,0],[0,0]]]] } };
                assert('null geometry rejected', isRenderable(nullGeom) === false);
                assert('empty polygon rejected', isRenderable(emptyPoly) === false);
                assert('bad polygon rejected', isRenderable(badPoly) === false);
                assert('valid polygon accepted', isRenderable(goodPoly) === true);
                assert('valid multipolygon accepted', isRenderable(goodMulti) === true);
              }} catch(e) { console.warn('tests skipped', e?.message||e); }
            `,
          }}
        />
      )}
    </div>
  );
}
