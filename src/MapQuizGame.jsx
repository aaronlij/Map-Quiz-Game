import React, { useEffect, useRef, useState } from "react";
import { ComposableMap, Geographies, Geography, ZoomableGroup } from "react-simple-maps";

/**
 * Map Quiz Game – Stable Build r4
 *
 * Big fixes + features per your requests:
 * - **US States now works** (using robust GeoJSON; no Albers-USA center edge cases).
 * - Added subnational datasets: **Mexico States**, **India States/UTs**, **Israel Districts**.
 * - **Explore** now supports **countries and subcountries** via Wikipedia REST (with image zoom modal).
 * - **Typing mode** no longer reveals the answer; it only highlights the target region.
 * - **Hard Mode** controls:
 *    • Hide borders  • Disable hover/click highlight (Click mode only)
 * - Strict geometry validation to avoid null/ill-shaped coordinates crashing the projection.
 *
 * Existing tests kept; added new guard tests.
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

/******************** Datasets ********************/
// Using robust Click-That-Hood GeoJSON mirrors for subnationals
const DATASETS = {
  world: {
    label: "World Countries",
    url: "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json",
    projection: { name: "geoEqualEarth", scale: 160, center: [0, 20] },
    getName: (geo) => geo?.properties?.name || geo?.properties?.NAME || "",
    exploreScope: "country", // restcountries
  },
  us: {
    label: "US States",
    url: "https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/united-states.geojson",
    projection: { name: "geoEqualEarth", scale: 700, center: [-98, 38] },
    getName: (geo) => geo?.properties?.name || geo?.properties?.NAME || "",
    exploreScope: { country: "United States" }, // wikipedia
  },
  canada: {
    label: "Canada Provinces/Territories",
    url: "https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/canada.geojson",
    projection: { name: "geoEqualEarth", scale: 380, center: [-96, 62] },
    getName: (geo) => geo?.properties?.name || geo?.properties?.NAME || "",
    exploreScope: { country: "Canada" },
  },
  mexico: {
    label: "Mexico States",
    url: "https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/mexico.geojson",
    projection: { name: "geoEqualEarth", scale: 900, center: [-102, 24] },
    getName: (geo) => geo?.properties?.name || geo?.properties?.NAME || "",
    exploreScope: { country: "Mexico" },
  },
  india: {
    label: "India States & UTs",
    url: "https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/india.geojson",
    projection: { name: "geoEqualEarth", scale: 1100, center: [79, 22] },
    getName: (geo) => geo?.properties?.name || geo?.properties?.NAME || "",
    exploreScope: { country: "India" },
  },
  israel: {
    label: "Israel Districts",
    url: "https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/israel.geojson",
    projection: { name: "geoEqualEarth", scale: 5000, center: [35, 31.5] },
    getName: (geo) => geo?.properties?.name || geo?.properties?.NAME || "",
    exploreScope: { country: "Israel" },
  },
};

const MODES = { explore: "Explore", click: "Click Prompt", type: "Type Prompt" };

/******************** Matching ********************/
const NAME_ALIASES = {
  // Canada
  ontario: ["on"], quebec: ["qc", "pq", "québec"], "newfoundland and labrador": ["newfoundland", "nl"],
  "prince edward island": ["pei"], "nova scotia": ["ns"], "new brunswick": ["nb"], "british columbia": ["bc"],
  "northwest territories": ["nwt"], nunavut: ["nu"], yukon: ["yt"],
  // US
  alabama: ["al"], alaska: ["ak"], arizona: ["az"], arkansas: ["ar"], california: ["ca"], colorado: ["co"],
  connecticut: ["ct"], delaware: ["de"], florida: ["fl"], georgia: ["ga"], hawaii: ["hi"], idaho: ["id"],
  illinois: ["il"], indiana: ["in"], iowa: ["ia"], kansas: ["ks"], kentucky: ["ky"], louisiana: ["la"],
  maine: ["me"], maryland: ["md"], massachusetts: ["ma"], michigan: ["mi"], minnesota: ["mn"],
  mississippi: ["ms"], missouri: ["mo"], montana: ["mt"], nebraska: ["ne"], nevada: ["nv"],
  "new hampshire": ["nh"], "new jersey": ["nj"], "new mexico": ["nm"], "new york": ["ny"],
  "north carolina": ["nc"], "north dakota": ["nd"], ohio: ["oh"], oklahoma: ["ok"], oregon: ["or"],
  pennsylvania: ["pa"], "rhode island": ["ri"], "south carolina": ["sc"], "south dakota": ["sd"],
  tennessee: ["tn"], texas: ["tx"], utah: ["ut"], vermont: ["vt"], virginia: ["va"], washington: ["wa"],
  "west virginia": ["wv"], wisconsin: ["wi"], wyoming: ["wy"],
  // World exonyms
  "cote d'ivoire": ["ivory coast", "cote divoire"], czechia: ["czech republic"], eswatini: ["swaziland"], myanmar: ["burma"],
  "democratic republic of the congo": ["drc", "dr congo", "congo-kinshasa"], "republic of the congo": ["congo-brazzaville"],
  "united states of america": ["united states", "usa", "us"], "united kingdom": ["uk", "great britain", "britain"],
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

async function fetchSubnationalInfo(name, countryLabel) {
  // Use Wikipedia REST summary; try "Name, Country" then fallbacks
  const tryTitles = [
    `${name}, ${countryLabel}`,
    `${name} (${countryLabel})`,
    `${name} (state)`, `${name} (province)`, `${name} (district)`, `${name} (union territory)`,
    name,
  ];
  for (const title of tryTitles) {
    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const j = await res.json();
      // Prefer originalimage for zoom; fallback to thumbnail
      const image = j?.originalimage?.source || j?.thumbnail?.source || null;
      return {
        title: j?.title || name,
        description: j?.description || j?.extract || "",
        summary: j?.extract || "",
        image, // generic image if available
        // Flags/coats are inconsistent for subnationals; attempt heuristics
        flag: null,
        coat: null,
        sourceUrl: j?.content_urls?.desktop?.page || null,
      };
    } catch (_) { /* try next */ }
  }
  return { title: name, description: "", summary: "", image: null, flag: null, coat: null, sourceUrl: null };
}

/******************** Component ********************/
export default function MapQuizGame() {
  // UI state
  const [dataset, setDataset] = useState("world"); // world, us, canada, mexico, india, israel
  const [mode, setMode] = useState("click"); // explore | click | type

  // Hard mode toggles (Click mode only)
  const [hideBorders, setHideBorders] = useState(false);
  const [disableHighlights, setDisableHighlights] = useState(false);

  // Game state
  const [prompt, setPrompt] = useState(null);
  const [input, setInput] = useState("");
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [lives, setLives] = useState(3);
  const [message, setMessage] = useState("");

  // Explore state
  const [selectedName, setSelectedName] = useState(null);
  const [info, setInfo] = useState(null);
  const [modalImg, setModalImg] = useState(null);

  // Zoom/pan state
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState(DATASETS.world.projection.center);

  // Geography load tracking
  const namesRef = useRef([]);
  const lastLenRef = useRef(0);
  const [geoVersion, setGeoVersion] = useState(0);

  const conf = DATASETS[dataset];

  useEffect(() => {
    setCenter(conf.projection.center);
    setZoom(1);
    setMessage("");
    // Reset prompt; will regenerate post-load
    setPrompt(null);
  }, [dataset]);

  // Regenerate prompt when features load or mode changes
  useEffect(() => {
    if ((mode === "click" || mode === "type") && namesRef.current.length) {
      const list = namesRef.current;
      setPrompt(list[Math.floor(Math.random() * list.length)] || null);
      setInput("");
      setMessage("");
    } else if (mode !== "explore") {
      setPrompt(null);
    }
  }, [geoVersion, mode, dataset]);

  const onGeoClick = (geo) => {
    const name = conf.getName(geo);
    if (!name) return;

    if (mode === "explore") {
      setSelectedName(name);
      setInfo(null);
      if (conf.exploreScope === "country") {
        fetchCountryInfo(name).then(setInfo);
      } else if (conf.exploreScope?.country) {
        fetchSubnationalInfo(name, conf.exploreScope.country).then(setInfo);
      }
      return;
    }

    if (mode === "click") {
      if (!prompt) return;
      if (norm(name) === norm(prompt)) {
        setScore((s) => s + 1);
        setStreak((s) => s + 1);
        setMessage("Correct!");
        const list = namesRef.current;
        if (list.length) setPrompt(list[Math.floor(Math.random() * list.length)]);
      } else {
        setStreak(0);
        setLives((l) => Math.max(0, l - 1));
        setMessage(`That was ${name}.`);
      }
      return;
    }

    if (mode === "type") {
      // No solving by click; only guidance
      setMessage("A region is highlighted. Type its name to score.");
    }
  };

  const submitTyped = (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!prompt) return;
    if (matchesAnswer(input, prompt)) {
      setScore((s) => s + 1);
      setStreak((s) => s + 1);
      setMessage("Correct!");
      setInput("");
      const list = namesRef.current;
      if (list.length) setPrompt(list[Math.floor(Math.random() * list.length)]);
    } else {
      setStreak(0);
      setLives((l) => Math.max(0, l - 1));
      setMessage("Not quite. Try again.");
      setInput("");
    }
  };

  // Zoom helpers
  const zoomIn = () => setZoom((z) => Math.min(8, z * 1.5));
  const zoomOut = () => setZoom((z) => Math.max(0.8, z / 1.5));
  const zoomReset = () => { setZoom(1); setCenter(conf.projection.center); };

  // Highlight name for typing mode
  const highlightName = mode === "type" ? prompt : null;

  // Geography styles (respect Hard Mode in Click)
  const baseFill = "#E5E7EB";
  const strokeColor = hideBorders ? "transparent" : "#6B7280";
  const strokeWidth = hideBorders ? 0 : 0.5;
  const hoverFill = disableHighlights && mode === "click" ? baseFill : "#F59E0B";
  const pressedFill = disableHighlights && mode === "click" ? baseFill : "#FDE68A";

  return (
    <div className="min-h-screen w-full p-4 text-[#111] bg-white">
      <div className="max-w-7xl mx-auto">
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between mb-3">
          <div>
            <h1 className="text-3xl font-bold">Map Quiz Game</h1>
            <p className="text-sm opacity-80">Datasets: World • US • Canada • Mexico • India • Israel • Modes: Explore, Click, Type</p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <select className="border rounded px-3 py-2" value={dataset} onChange={(e) => setDataset(e.target.value)} aria-label="Dataset">
              {Object.entries(DATASETS).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
            <select className="border rounded px-3 py-2" value={mode} onChange={(e) => { setMode(e.target.value); setMessage(""); setInput(""); }} aria-label="Mode">
              {Object.entries(MODES).map(([key, label]) => (<option key={key} value={key}>{label}</option>))}
            </select>
            <button className="border rounded px-3 py-2" onClick={() => { setScore(0); setStreak(0); setLives(3); setMessage(""); setInput(""); }}>Reset</button>
          </div>
        </header>

        <section className="grid md:grid-cols-[1fr_360px] gap-4 items-start">
          <div className="w-full rounded border overflow-hidden">
            <ComposableMap projection={conf.projection.name} projectionConfig={{ scale: conf.projection.scale }}>
              <ZoomableGroup zoom={zoom} center={conf.projection.center} minZoom={0.8} maxZoom={8}>
                <Geographies geography={conf.url}>
                  {({ geographies }) => {
                    const raw = safeList(geographies);
                    const list = raw.filter((g) => isRenderableFeature(g) && conf.getName(g));
                    namesRef.current = list.map((g) => conf.getName(g));
                    if (lastLenRef.current !== list.length) { lastLenRef.current = list.length; setTimeout(() => setGeoVersion((v) => v + 1), 0); }

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
                            default: { fill: isHL ? "#A7F3D0" : baseFill, stroke: strokeColor, strokeWidth, outline: "none" },
                            hover: { fill: isHL ? "#86EFAC" : hoverFill, outline: "none" },
                            pressed: { fill: isHL ? "#86EFAC" : pressedFill, outline: "none" },
                          }}
                        />
                      );
                    });
                  }}
                </Geographies>
              </ZoomableGroup>
            </ComposableMap>
          </div>

          <aside className="rounded border p-3 space-y-3 bg-[#fafafa]">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded border p-2"><div className="text-xs uppercase opacity-70">Score</div><div className="text-2xl font-bold">{score}</div></div>
              <div className="rounded border p-2"><div className="text-xs uppercase opacity-70">Streak</div><div className="text-2xl font-bold">{streak}</div></div>
              <div className="rounded border p-2"><div className="text-xs uppercase opacity-70">Lives</div><div className="text-2xl font-bold">{lives}</div></div>
            </div>

            <div className="flex gap-2">
              <button className="border rounded px-3 py-2" onClick={() => setZoom((z) => Math.max(0.8, z / 1.5))}>−</button>
              <button className="border rounded px-3 py-2" onClick={() => setZoom((z) => Math.min(8, z * 1.5))}>＋</button>
              <button className="border rounded px-3 py-2" onClick={() => { setZoom(1); setCenter(conf.projection.center); }}>Reset View</button>
            </div>

            {mode === "click" && (
              <div className="rounded bg-white border p-2 space-y-2">
                <div className="text-sm">Click this region:</div>
                {/* Do NOT reveal the answer in typing mode; here we are in click mode so showing is OK */}
                <div className="font-semibold">{prompt || "Loading..."}</div>
                <div className="flex items-center gap-3 pt-1 border-t mt-1">
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={hideBorders} onChange={(e) => setHideBorders(e.target.checked)} /> Hide borders</label>
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={disableHighlights} onChange={(e) => setDisableHighlights(e.target.checked)} /> Disable highlights</label>
                </div>
              </div>
            )}

            {mode === "type" && (
              <form onSubmit={submitTyped} className="rounded bg-white border p-2 space-y-2">
                <div className="text-xs uppercase opacity-70">Type the highlighted region</div>
                {/* DO NOT reveal the target name here */}
                <input value={input} onChange={(e) => setInput(e.target.value)} className="w-full border rounded px-3 py-2" placeholder="Start typing the name... (aliases OK)" aria-label="Type region name" />
                <button type="submit" className="border rounded px-3 py-2">Submit</button>
              </form>
            )}

            {message && <div className="rounded border p-2 bg-white text-sm">{message}</div>}

            {mode === "explore" && selectedName && (
              <div className="rounded bg-white border p-2">
                <div className="text-lg font-bold mb-1">{selectedName}</div>
                {info ? (
                  <div className="space-y-2">
                    {info.flag && (
                      <img src={info.flag} alt="flag" className="h-10 cursor-zoom-in" onClick={() => setModalImg(info.flag)} />
                    )}
                    {info.coat && (
                      <img src={info.coat} alt="coat of arms" className="h-10 cursor-zoom-in" onClick={() => setModalImg(info.coat)} />
                    )}
                    {info.image && !info.flag && (
                      <img src={info.image} alt="image" className="h-24 object-contain cursor-zoom-in" onClick={() => setModalImg(info.image)} />
                    )}
                    {info.official && <div><strong>Official:</strong> {info.official}</div>}
                    {info.capital && <div><strong>Capital:</strong> {info.capital}</div>}
                    {info.population && <div><strong>Population:</strong> {info.population?.toLocaleString?.()}</div>}
                    {info.area && <div><strong>Area:</strong> {info.area?.toLocaleString?.()} km²</div>}
                    {info.region && <div><strong>Region:</strong> {info.region}{info.subregion ? ` • ${info.subregion}` : ""}</div>}
                    {info.summary && <p className="text-sm opacity-80 leading-snug">{info.summary}</p>}
                    {info.sourceUrl && (
                      <a className="text-xs text-blue-600 underline" href={info.sourceUrl} target="_blank" rel="noreferrer">Wikipedia</a>
                    )}
                  </div>
                ) : (
                  <div className="text-sm opacity-70">Loading details…</div>
                )}
              </div>
            )}
          </aside>
        </section>
      </div>

      {/* Image Modal */}
      {modalImg && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setModalImg(null)}>
          <img src={modalImg} alt="zoom" className="max-h-[90vh] max-w-[90vw]" />
        </div>
      )}

      {/* DEV TESTS – keep existing, add guard tests */}
      {typeof window !== "undefined" && (
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try { if (!window.__MAP_QUIZ_TESTED__) {
                window.__MAP_QUIZ_TESTED__ = true;
                function assert(name, cond){ console[cond ? 'log' : 'error']('Test ' + (cond ? 'passed' : 'failed') + ':', name); }
                // Existing tests – unchanged
                const normFn = ${norm.toString()};
                assert('norm(Québec) -> quebec', normFn('Québec') === 'quebec');
                const matchFn = ${matchesAnswer.toString()};
                assert('matches PEI', matchFn('PEI','Prince Edward Island') === true);
                assert('matches NY', matchFn('NY','New York') === true);
                assert('matches Ivory Coast', matchFn('Ivory Coast',"Cote d'Ivoire") === true);
                const safeListFn = ${safeList.toString()};
                assert('safeList(null) -> []', Array.isArray(safeListFn(null)) && safeListFn(null).length === 0);
                assert('safeList(undefined) -> []', Array.isArray(safeListFn(undefined)) && safeListFn(undefined).length === 0);
                // New tests – geometry guards
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
