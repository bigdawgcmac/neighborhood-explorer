/* Neighborhood explorer: MapLibre for the base map and tract shapes, deck.gl for the race dots. */
const DATA = 'data/';
const RED = '#c0302a';
const RACE = [  // censusdots.com scheme; "sat": brighter versions that stay visible on satellite imagery
  { k: 'white',    label: 'White',                color: '#2f6bff', sat: '#5aa0ff' },
  { k: 'black',    label: 'Black',                color: '#22a447', sat: '#66f266' },
  { k: 'hispanic', label: 'Hispanic or Latino',   color: '#f2b600', sat: '#ffe033' },
  { k: 'asian',    label: 'Asian',                color: '#e32222', sat: '#ff4a4a' },
  { k: 'other',    label: 'Other or multiracial', color: '#9a9a9a', sat: '#e0e0e0' },
];
const raceColor = r => state.basemap === 'satellite' ? r.sat : r.color;
const raceRGB = () => RACE.map(r => [1, 3, 5].map(i => parseInt(raceColor(r).slice(i, i + 2), 16)));
const SATELLITE = { type: 'raster', tileSize: 256, maxzoom: 19,
  tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' };
const SEQ = ['#e8f8f7', '#b5eeea', '#3ce0d8', '#00a9f4', '#2251ff', '#1734b0', '#0b1f65'];
const DIV = ['#8c1111', '#c0302a', '#e3685e', '#f4b3ab', '#e4e4e4', '#bccbff', '#6f8fff', '#2251ff', '#0b1f65'];
const DETAIL_ZOOM = 10.5;        // switch from state-wide dots to street-level dots
const MAX_LOADED_DOTS = 14e6;    // evict least-recently-used county dot files beyond this
const TOWN_STATES = ['CT', 'NJ'];

// quick links on the start panel (looked up by name)
const QUICK = {
  dmv: { compare: ['Alexandria city, VA', 'Arlington County, VA'], go: ['Washington, DC', 'Fairfax County, VA', 'Bethesda, MD', 'Baltimore, MD'] },
  nc:  { compare: ['Charlotte, NC', 'Raleigh, NC'], go: ['Durham, NC', 'Chapel Hill, NC', 'Asheville, NC'] },
  fl:  { compare: ['Miami, FL', 'Tampa, FL'], go: ['Orlando, FL', 'Jacksonville, FL', 'Miami Beach, FL'] },
  nj:  { compare: ['Hoboken, NJ', 'Jersey City, NJ'], go: ['Princeton, NJ', 'Newark, NJ', 'Montclair, NJ'] },
  ct:  { compare: ['Greenwich, CT', 'New Haven, CT'], go: ['Stamford, CT', 'Hartford, CT', 'Westport, CT'] },
};

// ---------- formatting ----------
const TOP = { income: 250001, homeval: 2000001, rent: 3501 };  // Census top-codes ("$250K+")
const num = v => v == null ? 'n/a' : Math.round(v).toLocaleString();
const pct = v => v == null ? 'n/a' : Math.round(v * 100) + '%';
const month = s => new Date(s + 'T00:00').toLocaleString('en-US', { month: 'short', year: 'numeric' });
function money(v) {
  if (v == null) return 'n/a';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (v >= 1e4) return '$' + Math.round(v / 1e3) + 'K';
  return '$' + Math.round(v).toLocaleString();
}
function fmtV(key, v) {
  if (v == null) return 'n/a';
  if (key === 'margin') return Math.abs(v) < 0.005 ? 'Even' : (v > 0 ? 'D+' : 'R+') + Math.round(Math.abs(v) * 100);
  if (TOP[key] && v >= TOP[key]) return money(TOP[key] - 1) + '+';
  return money(v);
}
const marginColor = v => v == null ? '#000' : v > 0 ? '#0b1f65' : RED;

// ---------- layers ----------
const moneyLabels = bins => [`Under ${money(bins[0])}`, ...bins.slice(0, -1).map((b, i) => `${money(b)}–${money(bins[i + 1]).slice(1)}`), `${money(bins.at(-1))} or more`];
const HV = [2e5, 3.5e5, 5e5, 7.5e5, 1e6, 1.5e6], RN = [1000, 1250, 1500, 2000, 2500, 3000];
let META;
const LAYERS = {
  none:    { title: 'Map only', unit: () => 'no data layer' },
  race:   { title: 'Population by race and ethnicity', unit: () => `1 dot = ${map.getZoom() < DETAIL_ZOOM ? META.dots_overview : META.dots_detail} people, 2020 Census` },
  income:  { title: 'Median household income by census tract', unit: () => '$, 2020–24', src: 'tracts', prop: 'income', fmt: 'income', bins: [5e4, 7.5e4, 1e5, 1.5e5, 2e5, 2.5e5], colors: SEQ },
  homeval: { title: 'Median home value by census tract', unit: () => '$, owner-reported, 2020–24', src: 'tracts', prop: 'homeval', fmt: 'homeval', bins: HV, colors: SEQ },
  zhvi:    { title: 'Typical home value by ZIP code', unit: () => `$, Zillow, ${month(META.zhvi_date)}`, src: 'zips', prop: 'zhvi', fmt: 'money', bins: HV, colors: SEQ },
  rent:    { title: 'Median gross rent by census tract', unit: () => '$ per month, 2020–24', src: 'tracts', prop: 'rent', fmt: 'rent', bins: RN, colors: SEQ },
  zori:    { title: 'Typical asking rent by ZIP code', unit: () => `$ per month, Zillow, ${month(META.zori_date)}`, src: 'zips', prop: 'zori', fmt: 'money', bins: RN, colors: SEQ },
  vote:    { title: '2024 presidential vote margin by census tract', unit: () => 'percentage points', src: 'tracts', prop: 'margin', fmt: 'margin',
             bins: [-.6, -.4, -.2, -.05, .05, .2, .4, .6], colors: DIV,
             labels: ['R+60 or more', 'R+40–60', 'R+20–40', 'R+5–20', 'Within 5 points', 'D+5–20', 'D+20–40', 'D+40–60', 'D+60 or more'] },
};
for (const L of Object.values(LAYERS)) if (L.bins && !L.labels) L.labels = moneyLabels(L.bins);
const fmtL = (L, v) => L.fmt === 'money' ? money(v) : fmtV(L.fmt, v);
function fillExpr(L) {
  const e = ['step', ['to-number', ['get', L.prop]], L.colors[0]];
  L.bins.forEach((b, i) => e.push(b, L.colors[i + 1]));
  return ['case', ['==', ['get', L.prop], null], '#ececec', e];
}

// ---------- geometry helpers ----------
function bboxOf(geom) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  const walk = c => typeof c[0] === 'number' ? (x0 = Math.min(x0, c[0]), x1 = Math.max(x1, c[0]), y0 = Math.min(y0, c[1]), y1 = Math.max(y1, c[1])) : c.forEach(walk);
  walk(geom.coordinates);
  return [x0, y0, x1, y1];
}
const centerOf = g => { const [a, b, c, d] = bboxOf(g); return [(a + c) / 2, (b + d) / 2]; };
const lngLatBounds = b => [[b[0], b[1]], [b[2], b[3]]];
const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

// ---------- state ----------
const cache = {};
let R = null;  // active region
const saved = JSON.parse(localStorage.getItem('ne-settings') || '{}');
const state = { metric: saved.metric || 'race', source: saved.source || 'census', A: null, B: null, picking: false, pinMode: false,
  basemap: saved.basemap || 'streets', opacity: { streets: 0.82, satellite: 0.6, ...saved.opacity } };
const saveSettings = () => localStorage.setItem('ne-settings', JSON.stringify(
  { basemap: state.basemap, opacity: state.opacity, metric: state.metric, source: state.source }));
const opacity = () => state.opacity[state.basemap];
const layerKey = () => state.metric === 'homeval' ? (state.source === 'zillow' ? 'zhvi' : 'homeval')
                    : state.metric === 'rent' ? (state.source === 'zillow' ? 'zori' : 'rent') : state.metric;
const $ = id => document.getElementById(id);
const busy = msg => { $('loading').textContent = msg || ''; $('loading').style.display = msg ? 'block' : 'none'; };

// ---------- map ----------
const map = new maplibregl.Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/positron',
  center: [-77.1, 38.85], zoom: 9, attributionControl: { compact: true } });
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
const overlay = new deck.MapboxOverlay({ interleaved: true, layers: [] });
const metaP = fetch(DATA + 'regions.json').then(r => r.json()).catch(() => null);  // load data while the base map loads
let firstSymbol, baseLayers = [], ready = false, markers = [];
const EMPTY = { type: 'FeatureCollection', features: [] };

map.on('load', async () => {
  const style = map.getStyle().layers;
  firstSymbol = style.find(l => l.type === 'symbol')?.id;
  baseLayers = style.filter(l => l.type !== 'symbol')  // hidden under satellite; labels stay
    .map(l => ({ id: l.id, vis: l.layout?.visibility || 'visible' }));
  map.addSource('satellite', SATELLITE);
  map.addLayer({ id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' },
                 paint: { 'raster-brightness-max': 0.9 } }, style[0].id);
  for (const s of ['tracts', 'zips', 'sel', 'borders']) map.addSource(s, { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'tract-fill', type: 'fill', source: 'tracts', paint: { 'fill-opacity': 0.82 } }, firstSymbol);
  map.addLayer({ id: 'zip-fill', type: 'fill', source: 'zips', paint: { 'fill-opacity': 0.82 } }, firstSymbol);
  map.addLayer({ id: 'tract-hit', type: 'fill', source: 'tracts', paint: { 'fill-color': '#000', 'fill-opacity': 0 } }, firstSymbol);
  map.addLayer({ id: 'tract-line', type: 'line', source: 'tracts', minzoom: 9, paint: { 'line-color': '#ffffff', 'line-width': 0.5 } }, firstSymbol);
  map.addLayer({ id: 'zip-line', type: 'line', source: 'zips', paint: { 'line-color': '#ffffff', 'line-width': 1 } }, firstSymbol);
  // state lines on multi-state tabs: solid red over a thin white edge so they read on streets and satellite
  const borderWidth = ['interpolate', ['linear'], ['zoom'], 5, 1.6, 10, 2.6, 14, 3.6];
  map.addLayer({ id: 'border-casing', type: 'line', source: 'borders', layout: { 'line-join': 'round', 'line-cap': 'round' },
                 paint: { 'line-color': '#ffffff', 'line-opacity': 0.85, 'line-width': ['+', borderWidth, 2] } });
  map.addLayer({ id: 'border-line', type: 'line', source: 'borders', layout: { 'line-join': 'round', 'line-cap': 'round' },
                 paint: { 'line-color': '#e3120b', 'line-width': borderWidth } });
  map.addLayer({ id: 'hover', type: 'line', source: 'tracts', filter: ['==', ['get', 'id'], ''], paint: { 'line-color': '#000', 'line-width': 1.5 } });
  map.addLayer({ id: 'sel-line', type: 'line', source: 'sel', paint: {
    'line-color': ['match', ['get', 'role'], 'A', '#2251ff', '#000'], 'line-width': 3,
    'line-dasharray': ['match', ['get', 'role'], 'A', ['literal', [1, 0]], ['literal', [2, 1]]] } });
  map.addControl(overlay);
  ready = true;
  setBasemap(state.basemap);
  renderPins();

  META = await metaP;
  if (!META) { busy('Could not load data. Open the map with "Open map.bat" (it starts a small local server).'); return; }
  const ids = META.order.filter(id => META.regions[id]);
  $('tabs').innerHTML = ids.map(id => `<button data-r="${id}">${META.regions[id].name}</button>`).join('');
  await showRegion(ids[0]);
  wireMapEvents();
});

// ---------- regions ----------
async function showRegion(id) {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.r === id));
  if (!cache[id]) {
    busy(`Loading ${META.regions[id].name}…`);
    const files = ['tracts.geojson', 'places.geojson', 'zips.geojson', 'search.json', 'dots/manifest.json'];
    const [tracts, places, zips, search, dots] = await Promise.all(files.map(f => fetch(`${DATA}${id}/${f}`).then(r => r.json())));
    const reg = { id, meta: META.regions[id], tracts, places, zips, search, dots, chunks: new Map(),
      tractById: new Map(tracts.features.map(f => [f.properties.id, f])),
      placeById: new Map(places.features.map(f => [f.properties.id, f])),
      zipById: new Map(zips.features.map(f => [f.properties.zip, f])) };
    reg.overview = await loadDots(`${DATA}${id}/dots/overview.bin`, dots.overview);
    reg.borders = reg.meta.states.length > 1
      ? await fetch(`${DATA}${id}/borders.geojson`).then(r => r.json()).catch(() => EMPTY) : EMPTY;
    cache[id] = reg;
  }
  R = cache[id];
  map.getSource('tracts').setData(R.tracts);
  map.getSource('zips').setData(R.zips);
  map.getSource('borders').setData(R.borders);
  map.fitBounds(lngLatBounds(R.meta.view), { padding: 20, duration: 0 });
  $('note').textContent = noteText();
  busy('');
  applyLayer();
  render();
}
$('tabs').addEventListener('click', ev => { const b = ev.target.closest('[data-r]'); if (b) showRegion(b.dataset.r); });

function noteText() {
  const ct = R.meta.states.includes('Connecticut')
    ? ' Connecticut reports 2024 results by town, so tracts show their town’s margin.' : '';
  return `Note: Dots are placed at random inside each 2020 Census block. Race groups other than Hispanic are non-Hispanic. ` +
    `Vote margins are 2024 precinct results reallocated to tracts by household population.${ct} Small tracts can have wide margins of error.`;
}

// ---------- race dots ----------
async function loadDots(url, info) {
  const buf = await (await fetch(url)).arrayBuffer();
  const n = info.n, q = new Uint16Array(buf, 0, 2 * n), g = new Uint8Array(buf, 4 * n, n);
  const [x0, y0, x1, y1] = info.bbox, sx = (x1 - x0) / 65535, sy = (y1 - y0) / 65535;
  const pos = new Float32Array(2 * n);
  for (let i = 0; i < n; i++) { pos[2 * i] = x0 + q[2 * i] * sx; pos[2 * i + 1] = y0 + q[2 * i + 1] * sy; }
  return { n, pos, g, bbox: info.bbox, used: performance.now() };
}
function colorize(d) {  // (re)build the color buffer for the current basemap; cached so panning doesn't re-upload
  const rgb = raceRGB(), col = new Uint8Array(3 * d.n);
  for (let i = 0; i < d.n; i++) { const c = rgb[d.g[i]]; col[3 * i] = c[0]; col[3 * i + 1] = c[1]; col[3 * i + 2] = c[2]; }
  d.palette = state.basemap;
  d.data = { length: d.n, attributes: { getPosition: { value: d.pos, size: 2 }, getFillColor: { value: col, size: 3, normalized: true } } };
}
function dotRadius(z) {  // pixels, eased by zoom
  const stops = [[5, 0.45], [10, 0.6], [11, 0.75], [13, 1.05], [15, 1.9], [17, 4], [19, 8]];
  if (z <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) if (z <= stops[i][0]) {
    const [za, ra] = stops[i - 1], [zb, rb] = stops[i], t = (z - za) / (zb - za);
    return ra * Math.pow(rb / ra, t);
  }
  return stops.at(-1)[1];
}
function dotLayer(id, d, detail) {
  if (d.palette !== state.basemap) colorize(d);
  return new deck.ScatterplotLayer({
    id, beforeId: firstSymbol, opacity: detail ? Math.min(1, opacity() + 0.08) : opacity() * 0.92,
    radiusUnits: 'pixels', radiusScale: dotRadius(map.getZoom()), getRadius: 1, data: d.data,
  });
}
let dotsPending = new Set();
function updateDots() {
  if (!R || layerKey() !== 'race') { setDots([]); $('exTitle').innerHTML = exTitle(); return; }
  const z = map.getZoom(), b = map.getBounds(), view = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  const layers = [];
  if (z < DETAIL_ZOOM) layers.push(dotLayer(`ov-${R.id}`, R.overview, false));
  else {
    const visible = R.dots.chunks.filter(c => overlaps(c.bbox, view));
    let missing = false;
    for (const c of visible) {
      const d = R.chunks.get(c.id);
      if (d) { d.used = performance.now(); layers.push(dotLayer(`c-${c.id}`, d, true)); continue; }
      missing = true;
      const key = R.id + c.id;
      if (!dotsPending.has(key)) {
        dotsPending.add(key);
        const reg = R;
        loadDots(`${DATA}${reg.id}/dots/${c.id}.bin`, c).then(d => { reg.chunks.set(c.id, d); dotsPending.delete(key); evict(); updateDots(); });
      }
    }
    if (missing) layers.unshift(dotLayer(`ov-${R.id}`, R.overview, false));
    busy(missing ? 'Loading street-level dots…' : '');
  }
  setDots(layers);
  $('exTitle').innerHTML = exTitle();
}
let dotLayers = [];
const setDots = layers => { dotLayers = layers; overlay.setProps({ layers }); };
function evict() {
  const all = Object.values(cache).flatMap(reg => [...reg.chunks].map(([id, d]) => ({ reg, id, d })));
  let total = all.reduce((s, x) => s + x.d.n, 0);
  for (const x of all.sort((a, b) => a.d.used - b.d.used)) {
    if (total <= MAX_LOADED_DOTS) break;
    x.reg.chunks.delete(x.id); total -= x.d.n;
  }
}

// ---------- legend + takeaway ----------
const exTitle = () => { const L = LAYERS[layerKey()]; return `${L.title}, <span>${L.unit()}</span>`; };
function applyLayer() {
  if (!R) return;
  const key = layerKey(), L = LAYERS[key];
  const vis = (id, on) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  vis('tract-fill', L.src === 'tracts');
  vis('zip-fill', L.src === 'zips');
  vis('zip-line', L.src === 'zips');
  vis('tract-line', key !== 'none');
  vis('hover', key !== 'none');
  map.setPaintProperty('tract-line', 'line-color', key === 'race' ? '#c9c9c9' : '#ffffff');
  if (L.src === 'tracts') map.setPaintProperty('tract-fill', 'fill-color', fillExpr(L));
  if (L.src === 'zips') map.setPaintProperty('zip-fill', 'fill-color', fillExpr(L));
  for (const id of ['tract-fill', 'zip-fill']) map.setPaintProperty(id, 'fill-opacity', opacity());
  $('opacity').value = Math.round(opacity() * 100);
  document.querySelectorAll('.layers > button').forEach(b => b.classList.toggle('active', b.dataset.m === state.metric));
  document.querySelectorAll('.seg').forEach(s => {
    s.style.display = s.dataset.for === state.metric ? 'block' : 'none';
    s.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.s === state.source));
  });
  $('legend').classList.toggle('sat', state.basemap === 'satellite');
  $('legend').innerHTML = key === 'none' ? ''
    : key === 'race'
    ? RACE.map(r => `<div><i class="dot" style="background:${raceColor(r)}"></i>${r.label}</div>`).join('')
    : L.labels.map((t, i) => ({ t, c: L.colors[i] })).reverse().concat([{ t: 'No data', c: '#ececec' }])
        .map(x => `<div><i style="background:${x.c}"></i>${x.t}</div>`).join('');
  updateDots();
  map.once('idle', takeaway);
}

// population-weighted median of a tract value over the tracts in view
function weightedMedian(rows) {
  rows.sort((a, b) => a.v - b.v);
  const half = rows.reduce((s, r) => s + r.w, 0) / 2;
  let acc = 0;
  for (const r of rows) { acc += r.w; if (acc >= half) return r.v; }
  return null;
}
function takeaway() {
  if (!R) return;
  const key = layerKey(), L = LAYERS[key];
  if (key === 'none') { $('takeaway').innerHTML = 'Find a place, drop pins, then pick a layer above to add data on top'; return; }
  const layer = L && L.src === 'zips' ? 'zip-fill' : 'tract-hit';
  const seen = new Set(), props = [];
  for (const f of map.queryRenderedFeatures({ layers: [layer] })) {
    const id = layer === 'zip-fill' ? f.properties.zip : f.properties.id;
    if (seen.has(id)) continue;
    seen.add(id);
    props.push(layer === 'zip-fill' ? R.zipById.get(id).properties : R.tractById.get(id).properties);
  }
  let html = '';
  if (!props.length) html = 'Zoom or pan to an area with data';
  else if (key === 'race') {
    const pop = props.reduce((s, p) => s + (p.pop || 0), 0);
    const sh = k => props.reduce((s, p) => s + (p[k] || 0) * (p.pop || 0), 0) / pop;
    html = `Residents are <b>${pct(sh('white'))}</b> White, <b>${pct(sh('hispanic'))}</b> Hispanic, <b>${pct(sh('black'))}</b> Black and <b>${pct(sh('asian'))}</b> Asian`;
  } else if (L.src === 'zips') {
    const z = props.filter(p => p[L.prop] != null).sort((a, b) => a[L.prop] - b[L.prop]);
    html = z.length ? `The middle ZIP is <b>${money(z[z.length >> 1][L.prop])}</b>; the highest is <b>${money(z.at(-1)[L.prop])}</b> (ZIP ${z.at(-1).zip})` : 'No Zillow data in view';
  } else {
    const rows = props.filter(p => p[L.prop] != null && p.pop).map(p => ({ v: p[L.prop], w: p.pop, p }));
    if (!rows.length) html = 'No data in view';
    else if (key === 'vote') {
      const pop = rows.reduce((s, r) => s + r.w, 0), dem = rows.filter(r => r.v > 0).reduce((s, r) => s + r.w, 0);
      html = `<b>${pct(dem / pop)}</b> of residents live in tracts that voted Democratic; the typical resident’s tract is <b style="color:${marginColor(weightedMedian(rows))}">${fmtV('margin', weightedMedian(rows))}</b>`;
    } else {
      const top = rows.reduce((a, b) => b.v > a.v ? b : a);
      html = `Half of residents live in tracts above <b>${fmtL(L, weightedMedian(rows))}</b>; the highest is <b>${fmtL(L, top.v)}</b> in ${top.p.label}`;
    }
  }
  $('takeaway').innerHTML = `<span class="k">In this view</span>${html}`;
}

// ---------- map events ----------
function wireMapEvents() {
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
  map.on('mousemove', e => {
    if (!R) return;
    const key = layerKey(), L = LAYERS[key];
    const zf = L.src === 'zips' ? map.queryRenderedFeatures(e.point, { layers: ['zip-fill'] })[0] : null;
    const tf = map.queryRenderedFeatures(e.point, { layers: ['tract-hit'] })[0];
    map.getCanvas().style.cursor = state.pinMode ? 'crosshair' : tf ? 'pointer' : '';
    map.setFilter('hover', ['==', ['get', 'id'], tf ? tf.properties.id : '']);
    if (!tf && !zf) return popup.remove();
    let html;
    if (zf) html = `<b>ZIP ${zf.properties.zip}</b> · ${money(R.zipById.get(zf.properties.zip).properties[L.prop])}`;
    else {
      const p = R.tractById.get(tf.properties.id).properties;
      html = key === 'none' ? `<b>${p.label}</b> · ${p.town || p.county}`
        : key === 'race'
        ? `<b>${p.label}</b> · ${RACE.filter(r => p[r.k] >= 0.1).map(r => `${pct(p[r.k])} ${r.label}`).join(', ') || 'n/a'}`
        : `<b>${p.label}</b> · ${fmtL(L, p[L.prop])}`;
    }
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  });
  map.on('mouseout', () => popup.remove());
  map.on('click', e => {
    if (e.originalEvent.target.closest?.('.pin, .tag')) return;  // marker clicks are handled by the marker
    if (state.pinMode) { setPinMode(false); return addPin(e.lngLat); }
    const f = map.queryRenderedFeatures(e.point, { layers: ['tract-hit'] })[0];
    if (f) select(tractEntity(f.properties.id));
  });
  map.on('contextmenu', e => { e.originalEvent.preventDefault(); addPin(e.lngLat); });
  map.on('zoom', () => setDots(dotLayers.map(l => l.clone({ radiusScale: dotRadius(map.getZoom()) }))));
  map.on('moveend', () => { updateDots(); takeaway(); });
}

// ---------- entities ----------
function tractEntity(id) {
  const f = R.tractById.get(id), p = f.properties, st = p.county.slice(-2);
  const town = p.town && findEntity(`${p.town}, ${st}`);
  return { kind: 'tract', id, p, geom: f.geometry, title: p.label, sub: `Tract ${p.tract} · ${p.county}`,
           county: R.placeById.get('c:' + id.slice(0, 5))?.properties, town: town?.properties,
           zip: p.zip && R.zipById.get(p.zip) ? R.zipById.get(p.zip).properties : null, ct: st === 'CT' };
}
function placeEntity(f) {
  const p = f.properties, typ = p.type === 'CDP' ? 'Census-designated place' : p.type[0].toUpperCase() + p.type.slice(1);
  return { kind: 'place', id: p.id, p, geom: f.geometry, title: p.name, sub: `${typ} totals`, county: null, town: null, zip: null, ct: p.name.endsWith('CT') };
}
function findEntity(name) {  // prefer towns, then counties/cities, then other places
  const rank = f => f.properties.id[0] === 's' ? 0 : f.properties.id[0] === 'c' ? 1 : f.properties.type === 'CDP' ? 3 : 2;
  return R.places.features.filter(f => f.properties.name === name).sort((a, b) => rank(a) - rank(b))[0];
}

// ---------- selection + right panel ----------
function select(e) {
  if (state.picking && state.A) { state.B = e; state.picking = false; }
  else { state.A = e; state.B = null; }
  render();
}
function updateBanner() {
  const msg = state.pinMode ? 'Click the map to drop a pin · Esc to cancel'
    : state.picking ? 'Click a neighborhood or search a place to compare with A' : '';
  $('banner').textContent = msg;
  $('banner').style.display = msg ? 'block' : 'none';
}
function render() {
  updateBanner();
  markers.forEach(m => m.remove()); markers = [];
  const feats = [];
  for (const [role, e] of [['A', state.A], ['B', state.B]]) {
    if (!e) continue;
    feats.push({ type: 'Feature', properties: { role }, geometry: e.geom });
    const el = document.createElement('div'); el.className = 'tag ' + role.toLowerCase(); el.textContent = role;
    markers.push(new maplibregl.Marker({ element: el }).setLngLat(centerOf(e.geom)).addTo(map));
  }
  if (ready) map.getSource('sel').setData({ type: 'FeatureCollection', features: feats });
  $('right').innerHTML = !state.A ? startHTML() : state.B ? compareHTML(state.A, state.B) : singleHTML(state.A);
}

function startHTML() {
  const q = QUICK[R?.id] || { go: [] };
  const ok = n => R && findEntity(n);
  return `<div class="kicker">Get started</div><h2>Click any neighborhood on the map, or search a place</h2>
    <div class="sub">Or try one of these:</div>
    <div class="start">
      ${q.compare && q.compare.every(ok) ? `<a data-cmp="${q.compare.join('|')}">Compare ${q.compare.map(n => n.replace(/( city| County)?, [A-Z]{2}$/, '')).join(' with ')} →</a>` : ''}
      ${q.go.filter(ok).map(n => `<a data-go="${n}">${n} →</a>`).join('')}
    </div>`;
}
const bar = (w, c) => `<div class="t"><div style="width:${Math.max(0, Math.min(100, w * 100))}%;background:${c}"></div></div>`;
const raceBars = p => `<div class="bars">${RACE.map(r => `<div class="r"><span>${r.label}</span>${bar(p[r.k] || 0, raceColor(r))}<b>${pct(p[r.k])}</b></div>`).join('')}</div>`;
function voteBar(p) {
  if (p.dem == null) return '';
  return `<div class="vbar"><div style="width:${p.dem * 100}%;background:#0b1f65"></div><div style="width:${Math.max(0, 1 - p.dem - p.rep) * 100}%;background:#d0d0d0"></div><div style="width:${p.rep * 100}%;background:${RED}"></div></div>
    <div class="vlab"><span>Harris <b>${pct(p.dem)}</b></span><span>Trump <b>${pct(p.rep)}</b></span></div>`;
}
const shortName = n => n.replace(/, [A-Z]{2}$/, '');
const vsRef = (e, k) => { const ref = e.town || e.county; return ref && e.p[k] != null && ref[k] != null ? `<div class="note">vs. ${fmtV(k, ref[k])} for ${shortName(ref.name)}</div>` : ''; };

function singleHTML(e) {
  const p = e.p, z = e.zip;
  const links = [e.town, e.county].filter(Boolean).filter((x, i, a) => a.findIndex(y => y.id === x.id) === i)
    .map(x => `<button class="link" data-ent="${x.id}">${shortName(x.name)} totals →</button>`).join('');
  return `<div class="kicker">${e.kind === 'tract' ? 'Census tract' : 'Place'}</div>
    <h2>${e.title}</h2>
    <div class="sub">${e.sub} · Population <b>${num(p.pop)}</b>${z ? ` · ZIP ${z.zip}` : ''}</div>
    <div class="actions"><button class="link" data-act="compare">+ Compare with another area</button>${links}</div>
    <section><h4>Race and ethnicity, <span>% of residents</span></h4>${raceBars(p)}</section>
    <section><h4>Household income, <span>median</span></h4><div class="big">${fmtV('income', p.income)}</div>${vsRef(e, 'income')}</section>
    <section><h4>Home value</h4>
      <div class="kv"><span>Census median, owner-reported</span><b>${fmtV('homeval', p.homeval)}</b></div>
      ${z ? `<div class="kv"><span>Zillow typical value, ZIP ${z.zip}</span><b>${money(z.zhvi)}</b></div>
             <div class="note">${z.zhvi_chg == null ? '' : (z.zhvi_chg >= 0 ? '+' : '') + (z.zhvi_chg * 100).toFixed(1) + '% vs. a year earlier · '}${month(META.zhvi_date)}</div>` : ''}
      ${vsRef(e, 'homeval')}
    </section>
    <section><h4>Rent, <span>per month</span></h4>
      <div class="kv"><span>Census median gross rent</span><b>${fmtV('rent', p.rent)}</b></div>
      ${z ? `<div class="kv"><span>Zillow typical asking rent, ZIP ${z.zip}</span><b>${money(z.zori)}</b></div>` : ''}
    </section>
    <section><h4>2024 presidential vote, <span>margin</span></h4>
      <div class="big" style="color:${marginColor(p.margin)}">${fmtV('margin', p.margin)}</div>${voteBar(p)}
      <div class="note">${num(p.votes_total)} votes${e.kind === 'tract' ? (e.ct ? ', town-level result (Connecticut)' : ', estimated from precincts') : ''}</div>
    </section>`;
}

function pair(label, va, vb, f, scale) {  // scale: fixed bar maximum (1 for shares); default = larger of the two
  const m = scale || Math.max(va || 0, vb || 0) || 1;
  const row = (tag, v, c) => `<div class="pr"><span class="tag sm ${tag}">${tag.toUpperCase()}</span>${bar((v || 0) / m, c)}<b>${f(v)}</b></div>`;
  return `<div class="pair"><div class="pl">${label}</div>${row('a', va, '#2251ff')}${row('b', vb, '#000')}</div>`;
}
function compareHTML(a, b) {
  const pa = a.p, pb = b.p, za = a.zip || {}, zb = b.zip || {};
  const mg = e => `<b style="color:${marginColor(e.p.margin)}">${fmtV('margin', e.p.margin)}</b>`;
  return `<div class="kicker">Comparison</div>
    <div class="cmp-head"><span class="tag a">A</span><div><b>${a.title}</b><div class="sub">${a.sub}</div></div>
      <span class="tag b">B</span><div><b>${b.title}</b><div class="sub">${b.sub}</div></div></div>
    <div class="actions"><button class="link" data-act="swap">Swap</button><button class="link" data-act="clearB">Clear comparison</button></div>
    <section><h4>Population</h4>${pair('Residents', pa.pop, pb.pop, num)}</section>
    <section><h4>Race and ethnicity, <span>% of residents</span></h4>${RACE.map(r => pair(r.label, pa[r.k], pb[r.k], pct, 1)).join('')}</section>
    <section><h4>Household income, <span>median</span></h4>${pair('Census', pa.income, pb.income, v => fmtV('income', v))}</section>
    <section><h4>Home value</h4>${pair('Census median', pa.homeval, pb.homeval, v => fmtV('homeval', v))}
      ${za.zhvi || zb.zhvi ? pair(`Zillow, ZIP ${za.zip || '–'} vs. ${zb.zip || '–'}`, za.zhvi, zb.zhvi, money) : ''}</section>
    <section><h4>Rent, <span>per month</span></h4>${pair('Census median', pa.rent, pb.rent, v => fmtV('rent', v))}
      ${za.zori || zb.zori ? pair('Zillow asking rent', za.zori, zb.zori, money) : ''}</section>
    <section><h4>2024 presidential vote, <span>margin</span></h4>
      <div class="kv"><span><span class="tag sm a">A</span></span>${mg(a)}</div>
      <div class="kv"><span><span class="tag sm b">B</span></span>${mg(b)}</div></section>`;
}

$('right').addEventListener('click', ev => {
  const t = ev.target.closest('[data-act],[data-ent],[data-go],[data-cmp]');
  if (!t) return;
  if (t.dataset.ent) { const e = placeEntity(R.placeById.get(t.dataset.ent)); select(e); fly(e); }
  else if (t.dataset.go) { const e = placeEntity(findEntity(t.dataset.go)); select(e); fly(e); }
  else if (t.dataset.cmp) {
    const [a, b] = t.dataset.cmp.split('|').map(n => placeEntity(findEntity(n)));
    state.A = a; state.B = b; state.picking = false; render();
    const [x0, y0, x1, y1] = [bboxOf(a.geom), bboxOf(b.geom)].reduce((u, v) => [Math.min(u[0], v[0]), Math.min(u[1], v[1]), Math.max(u[2], v[2]), Math.max(u[3], v[3])]);
    map.fitBounds([[x0, y0], [x1, y1]], { padding: 40 });
  }
  else if (t.dataset.act === 'compare') { state.picking = true; render(); }
  else if (t.dataset.act === 'swap') { [state.A, state.B] = [state.B, state.A]; render(); }
  else if (t.dataset.act === 'clearB') { state.B = null; state.picking = false; render(); }
});
const fly = e => map.fitBounds(lngLatBounds(bboxOf(e.geom)), { padding: 40, maxZoom: 15 });
function goPoint(lon, lat, name, zoom = 14.3) {
  map.flyTo({ center: [lon, lat], zoom });
  map.once('moveend', () => {
    const f = map.queryRenderedFeatures(map.project([lon, lat]), { layers: ['tract-hit'] })[0];
    if (!f) return;
    const e = tractEntity(f.properties.id);
    if (name && name !== e.title) { e.sub = `${e.title} · ${e.sub}`; e.title = name; }
    select(e);
  });
}

// ---------- left panel ----------
document.querySelector('.layers').addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.m) { state.metric = b.dataset.m; state.source = 'census'; }
  if (b.dataset.s) state.source = b.dataset.s;
  saveSettings();
  applyLayer();
});

const q = $('q'), res = $('results');
let hits = [];
function searchIndex(s) {
  const score = label => { const l = label.toLowerCase(); return l.startsWith(s) ? 0 : l.includes(' ' + s) ? 1 : l.includes(s) ? 2 : -1; };
  const typeRank = { town: 0, city: 0, county: 1, district: 0, borough: 0, township: 0, village: 1, CDP: 2, 'ZIP code': 3 };
  const areas = R.search.areas.map(a => ({ a, s: score(a[0]) })).filter(x => x.s >= 0)
    .sort((x, y) => x.s - y.s || (typeRank[x.a[1]] ?? 2) - (typeRank[y.a[1]] ?? 2)).slice(0, 6)
    .map(({ a }) => ({ label: a[0], hint: a[1], kind: 'area', id: a[2], bbox: a.slice(3) }));
  const nbs = R.search.neighborhoods.map(n => ({ n, s: score(n[0]) })).filter(x => x.s >= 0).sort((x, y) => x.s - y.s).slice(0, 5)
    .map(({ n }) => ({ label: n[0], hint: n[1] ? `Neighborhood · ${n[1]}` : 'Neighborhood', kind: 'place', lon: n[2], lat: n[3] }));
  return [...areas, ...nbs].slice(0, 9);
}
q.addEventListener('input', () => {
  const s = q.value.trim().toLowerCase();
  hits = s && R ? searchIndex(s) : [];
  if (s) hits.push({ label: `Search address “${q.value.trim()}”`, hint: 'OpenStreetMap', kind: 'geocode', text: q.value.trim() });
  res.innerHTML = hits.map((h, i) => `<div data-i="${i}" class="${i ? '' : 'hi'}">${h.label}<span>${h.hint}</span></div>`).join('');
  res.style.display = hits.length ? 'block' : 'none';
});
q.addEventListener('keydown', ev => { if (ev.key === 'Enter' && hits.length) choose(hits[0]); });
res.addEventListener('click', ev => { const d = ev.target.closest('[data-i]'); if (d) choose(hits[+d.dataset.i]); });
document.addEventListener('click', ev => { if (!ev.target.closest('.search')) res.style.display = 'none'; });

async function choose(h) {
  res.style.display = 'none';
  q.value = h.kind === 'geocode' ? h.text : h.label;
  if (h.kind === 'area' && h.id.startsWith('z:')) {
    const c = centerOf(R.zipById.get(h.id.slice(2)).geometry);
    map.fitBounds(lngLatBounds(h.bbox), { padding: 40, duration: 0 });
    goPoint(c[0], c[1], h.label, Math.max(map.getZoom(), 12));
  } else if (h.kind === 'area') { const e = placeEntity(R.placeById.get(h.id)); select(e); fly(e); }
  else if (h.kind === 'place') goPoint(h.lon, h.lat, h.label);
  else {
    const [x0, y0, x1, y1] = R.meta.bounds;
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&viewbox=${x0},${y1},${x1},${y0}&bounded=1&q=${encodeURIComponent(h.text)}`;
    try {
      const r = await (await fetch(url)).json();
      if (r[0]) goPoint(+r[0].lon, +r[0].lat, h.text.split(',')[0]); else q.value = `No match in ${R.meta.name}`;
    } catch { q.value = 'Address search unavailable'; }
  }
}

// ---------- basemap: streets or satellite ----------
function setBasemap(b) {
  state.basemap = b;
  saveSettings();
  const sat = b === 'satellite';
  for (const l of baseLayers) map.setLayoutProperty(l.id, 'visibility', sat ? 'none' : l.vis);
  map.setLayoutProperty('satellite', 'visibility', sat ? 'visible' : 'none');
  document.querySelectorAll('#basemap button').forEach(x => x.classList.toggle('active', x.dataset.b === b));
  $('opacity').value = Math.round(opacity() * 100);
  applyLayer();  // opacity, legend and dot colors
  render();      // panel bar colors
}
$('basemap').addEventListener('click', ev => { const b = ev.target.closest('[data-b]'); if (b && ready) setBasemap(b.dataset.b); });
$('opacity').addEventListener('input', ev => {
  state.opacity[state.basemap] = ev.target.value / 100;
  saveSettings();
  if (!ready) return;
  for (const id of ['tract-fill', 'zip-fill']) map.setPaintProperty(id, 'fill-opacity', opacity());
  updateDots();
});

// ---------- pins (saved in this browser) ----------
const PIN_KEY = 'ne-pins';
let pins = JSON.parse(localStorage.getItem(PIN_KEY) || '[]'), pinMarkers = new Map(), pinPopup = null;
const savePins = () => localStorage.setItem(PIN_KEY, JSON.stringify(pins));
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function setPinMode(on) {
  state.pinMode = on;
  $('pinMode').textContent = on ? 'Cancel' : '+ Drop a pin';
  map.getCanvas().style.cursor = on ? 'crosshair' : '';
  updateBanner();
}
function addPin(ll) {
  const p = { id: Date.now().toString(36), name: `Pin ${pins.length + 1}`, lon: +ll.lng.toFixed(6), lat: +ll.lat.toFixed(6) };
  pins.push(p);
  savePins(); renderPins(); openPin(p, true);
}
function renderPins() {
  pinMarkers.forEach(m => m.remove()); pinMarkers.clear();
  for (const p of pins) {
    const el = document.createElement('div');
    el.className = 'pin';
    el.innerHTML = '<i></i><span></span>';
    el.lastChild.textContent = p.name;
    el.addEventListener('click', ev => { ev.stopPropagation(); openPin(p); });
    pinMarkers.set(p.id, new maplibregl.Marker({ element: el, anchor: 'left', offset: [-9, 0] }).setLngLat([p.lon, p.lat]).addTo(map));
  }
  $('pinCount').textContent = pins.length ? `(${pins.length})` : '';
  $('pinList').innerHTML = pins.map(p => `<div class="pin-row"><a data-pin="${p.id}" title="Go to pin">${esc(p.name)}</a><button data-del="${p.id}">Remove</button></div>`).join('');
}
function openPin(p, edit) {
  pinPopup?.remove();
  const box = document.createElement('div');
  box.className = 'pin-pop';
  box.innerHTML = `<input maxlength="60" aria-label="Pin name">
    <div class="actions"><button class="link" data-a="stats">Neighborhood stats →</button><button class="link" data-a="del">Remove</button></div>
    <div class="note">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</div>`;
  const input = box.querySelector('input');
  input.value = p.name;
  input.addEventListener('input', () => {
    p.name = input.value.trim() || 'Pin';
    savePins();
    pinMarkers.get(p.id).getElement().lastChild.textContent = p.name;
    $('pinList').querySelector(`[data-pin="${p.id}"]`).textContent = p.name;
  });
  input.addEventListener('keydown', ev => { if (ev.key === 'Enter') pinPopup.remove(); });
  box.addEventListener('click', ev => {
    const a = ev.target.closest('[data-a]')?.dataset.a;
    if (a === 'del') removePin(p.id);
    if (a === 'stats') { pinPopup.remove(); goPoint(p.lon, p.lat, p.name, Math.max(map.getZoom(), 13)); }
  });
  pinPopup = new maplibregl.Popup({ offset: 14, maxWidth: '240px' }).setLngLat([p.lon, p.lat]).setDOMContent(box).addTo(map);
  if (edit) { input.focus(); input.select(); }
}
function removePin(id) {
  pins = pins.filter(p => p.id !== id);
  savePins(); pinPopup?.remove(); renderPins();
}
$('pinMode').addEventListener('click', () => setPinMode(!state.pinMode));
$('pinList').addEventListener('click', async ev => {
  const del = ev.target.closest('[data-del]');
  if (del) return removePin(del.dataset.del);
  const a = ev.target.closest('[data-pin]');
  if (!a) return;
  const p = pins.find(x => x.id === a.dataset.pin);
  const inside = ([x0, y0, x1, y1]) => p.lon >= x0 && p.lon <= x1 && p.lat >= y0 && p.lat <= y1;
  const rid = META?.order.find(id => META.regions[id] && inside(META.regions[id].bounds));
  if (rid && rid !== R?.id) await showRegion(rid);
  map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 14) });
  openPin(p);
});
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && state.pinMode) setPinMode(false); });
render();
