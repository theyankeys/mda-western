/* MDA Round Two — submission monitoring.
   Loads /api/data (live KoboToolbox submissions) and districts.geojson, then draws every section.
   Thresholds for the checks are set here. */
(() => {
  // ---------------- settings ----------------
  const FORMS = ['CDD assessment', 'WHO SCT', 'Rapid assessment', 'District monitoring'];
  const SHORT = { 'CDD assessment': 'CDD', 'WHO SCT': 'WHO SCT', 'Rapid assessment': 'Rapid', 'District monitoring': 'District' };
  const COLOR = { 'CDD assessment': '#2a78d6', 'WHO SCT': '#eb6834', 'Rapid assessment': '#1baf7a', 'District monitoring': '#e0a000' };
  const HAS_GPS = { 'CDD assessment': true, 'WHO SCT': true, 'Rapid assessment': true, 'District monitoring': false };
  const MIN_OPEN_MIN = { 'CDD assessment': 2, 'WHO SCT': 10, 'Rapid assessment': 5, 'District monitoring': 5 }; // shorter = flagged
  const GPS_ACCURACY_M = 50;     // worse than this = flagged
  const LATE_UPLOAD_H = 24;      // sent this long after finishing = flagged
  const SILENT_DAYS = 2;         // collectors quiet this long are marked
  const RAPID_HH = 6, SCT_PEOPLE = 20;
  const REFRESH_MS = 5 * 60 * 1000;

  const fmt = d3.format(',');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const dot = (form) => { const i = el('i', 'sw'); i.style.background = COLOR[form] || '#999'; return i; };
  const td = (label, content, cls) => { const c = el('td', cls); c.dataset.label = label; if (content instanceof Node) c.appendChild(content); else c.textContent = content ?? '—'; return c; };

  let DATA = null, DISTRICTS = null, NAMES = [];
  let sort = { key: 'total', asc: false };
  let activeCheck = null;
  const fD = $('#f-district'), fF = $('#f-form'), fP = $('#f-period');
  fF.append(...FORMS.map((f) => new Option(f, f)));

  // ---------------- time helpers ----------------
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const dayOffset = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const subDay = (r) => (r.submitted_at || '').slice(0, 10) || r.date;
  function ago(iso) {
    if (!iso) return '—';
    const m = (Date.now() - Date.parse(iso)) / 60000;
    if (m < 1) return 'just now';
    if (m < 60) return `${Math.round(m)} min ago`;
    if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
    const d = Math.round(m / 1440);
    return d === 1 ? 'yesterday' : `${d} days ago`;
  }
  const when = (iso) => (iso ? d3.utcFormat('%d %b, %H:%M')(new Date(iso)) : '—');
  const openTxt = (m) => (m == null ? '—' : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} days`);

  // ---------------- filtering ----------------
  function inPeriod(rows) {
    const p = fP.value; if (p === 'all') return rows;
    const from = dayOffset(Number(p) - 1);
    return rows.filter((r) => subDay(r) >= from);
  }
  const inForm = (rows) => (fF.value ? rows.filter((r) => r.form === fF.value) : rows);
  const inDistrict = (rows) => (fD.value ? rows.filter((r) => r.district === fD.value) : rows);
  const scoped = () => inDistrict(inForm(inPeriod(DATA.submissions)));

  // ---------------- tooltip ----------------
  const tipEl = $('#tip');
  const tip = {
    show(e, title, lines) {
      tipEl.replaceChildren(el('b', null, title), ...lines.map((l) => el('div', null, l)));
      tipEl.hidden = false;
      const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      let x = e.clientX + 14, y = e.clientY + 14;
      if (x + w > innerWidth - 8) x = e.clientX - w - 14;
      if (y + h > innerHeight - 8) y = e.clientY - h - 14;
      tipEl.style.left = Math.max(4, x) + 'px'; tipEl.style.top = Math.max(4, y) + 'px';
    },
    hide() { tipEl.hidden = true; },
  };

  // ---------------- headline ----------------
  function drawHeadline() {
    const S = scoped();
    const set = (k, v) => $$(`[data-s="${k}"]`).forEach((e) => { e.textContent = v; });
    set('total', fmt(S.length));
    const split = $('#form-split'); split.replaceChildren();
    for (const f of fF.value ? [fF.value] : FORMS) {
      const s = el('span'); s.append(dot(f), el('em', null, SHORT[f]), el('b', null, fmt(S.filter((r) => r.form === f).length))); split.appendChild(s);
    }
    const scopeN = fD.value ? 1 : NAMES.length || 14;
    const dSub = new Set(S.map((r) => r.district).filter(Boolean)).size;
    set('districts', dSub); set('districts_all', scopeN);
    $$('[data-s-bar="districts"]').forEach((b) => { b.style.width = (100 * dSub) / scopeN + '%'; });
    const missing = NAMES.filter((n) => (!fD.value || n === fD.value) && !S.some((r) => r.district === n));
    set('districts_ctx', missing.length === 0 ? '✓ Every district has submitted' : `${missing.length} not yet submitted${fF.value ? ' this form' : ''}`);
    const people = new Set(S.map((r) => r.interviewer).filter(Boolean));
    const todayPeople = new Set(S.filter((r) => subDay(r) === todayStr()).map((r) => r.interviewer).filter(Boolean));
    set('collectors', fmt(people.size));
    set('collectors_ctx', `${todayPeople.size} active today`);
    const base = inDistrict(inForm(DATA.submissions));
    const t = base.filter((r) => subDay(r) === todayStr()).length, y = base.filter((r) => subDay(r) === dayOffset(1)).length;
    set('today', fmt(t));
    set('today_ctx', `${fmt(y)} yesterday${t || y ? (t > y ? ' · ▲ more today' : t < y ? ' · ▼ fewer today' : ' · same as yesterday') : ''}`);
  }

  // ---------------- district × form ----------------
  let MATRIX = [];
  function computeMatrix() {
    const S = inPeriod(DATA.submissions);
    MATRIX = NAMES.map((d) => {
      const rows = S.filter((r) => r.district === d);
      const o = { district: d, total: rows.length, collectors: new Set(rows.map((r) => r.interviewer).filter(Boolean)).size, last: d3.max(rows, (r) => r.submitted_at) || null };
      FORMS.forEach((f) => { o[f] = rows.filter((r) => r.form === f).length; });
      return o;
    });
  }
  function drawMatrix() {
    const rows = [...MATRIX].sort((a, b) => {
      const k = sort.key, va = a[k], vb = b[k];
      if (va == null || vb == null) return va == null && vb == null ? a.district.localeCompare(b.district) : va == null ? 1 : -1;
      const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return (sort.asc ? c : -c) || a.district.localeCompare(b.district);
    });
    $$('#matrix th').forEach((th) => { th.classList.toggle('sorted', th.dataset.sort === sort.key); th.classList.toggle('asc', th.dataset.sort === sort.key && sort.asc); });
    $('#matrix').classList.add('cards');
    const tb = $('#matrix tbody'); tb.replaceChildren();
    for (const r of rows) {
      const tr = el('tr'); if (r.district === fD.value) tr.classList.add('sel');
      tr.appendChild(td('District', r.district, 'dname first'));
      for (const f of FORMS) {
        const v = r[f];
        const c = td(SHORT[f], v ? fmt(v) : '—', 'r fc' + (v ? ' strong' : ' zero'));
        if (fF.value && fF.value !== f) c.style.opacity = 0.35;
        tr.appendChild(c);
      }
      tr.appendChild(td('Total', r.total ? fmt(r.total) : '—', 'r tot' + (r.total ? ' strong' : ' zero')));
      tr.appendChild(td('People', r.collectors ? String(r.collectors) : '—', 'r col' + (r.collectors ? '' : ' zero')));
      tr.appendChild(td('Last', r.last ? ago(r.last) : el('span', 'chip none', 'Nothing yet'), 'last'));
      tr.addEventListener('click', () => setDistrict(fD.value === r.district ? '' : r.district));
      tb.appendChild(tr);
    }
  }

  // ---------------- map ----------------
  let map, districtLayer, labelLayer, pointLayer, fitPending = true;
  function initMap() {
    map = L.map('map', { scrollWheelZoom: false, zoomSnap: 0.25, zoomDelta: 0.5 }).setView([5.45, -2.15], 8.5);
    map.on('click', () => map.scrollWheelZoom.enable());
    map.createPane('dlabels').style.zIndex = 450;
    map.createPane('points').style.zIndex = 500;
    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
    const sat = L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri' }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }),
    ]);
    pointLayer = L.layerGroup().addTo(map);
    labelLayer = L.layerGroup().addTo(map);
    L.control.layers({ Streets: streets, Satellite: sat }, { 'Submission points': pointLayer, 'District names': labelLayer }, { collapsed: true }).addTo(map);
    const lg = $('#map-legend');
    lg.append(...['CDD assessment', 'WHO SCT', 'Rapid assessment'].map((f) => { const s = el('span'); const k = el('i', 'dotk'); k.style.background = COLOR[f]; s.append(k, f); return s; }));
    const a = el('span'); const ka = el('i', 'sq'); ka.style.background = 'rgba(42,120,214,.28)'; a.append(ka, 'District has submitted');
    const b = el('span'); const kb = el('i', 'sq'); kb.style.background = 'rgba(160,158,150,.22)'; b.append(kb, 'Nothing yet');
    lg.append(a, b);
  }
  function addDistricts() {
    districtLayer = L.geoJSON(DISTRICTS, {
      style: districtStyle,
      onEachFeature: (f, l) => {
        const n = f.properties.district;
        l.on('mousemove', (e) => {
          const r = MATRIX.find((x) => x.district === n);
          tip.show(e.originalEvent, n, r ? [`${r.total} submission${r.total === 1 ? '' : 's'}`, ...FORMS.filter((x) => r[x]).map((x) => `${SHORT[x]}: ${r[x]}`), r.last ? `Last: ${ago(r.last)}` : 'Nothing received yet', 'Click to focus on this district'] : []);
        });
        l.on('mouseout', () => tip.hide());
        l.on('click', () => setDistrict(fD.value === n ? '' : n));
      },
    }).addTo(map);
    districtLayer.bringToBack();
    const labels = DISTRICTS.features.map((f) => {
      const s = el('span', null, f.properties.district);
      return { area: f.properties.area_sqkm || 1000, m: L.marker([f.properties.label_lat, f.properties.label_lon], { pane: 'dlabels', interactive: false, keyboard: false, icon: L.divIcon({ className: 'dlabel', html: s.outerHTML, iconSize: [0, 0] }) }) };
    });
    const sync = () => {
      const z = map.getZoom(), min = z >= 10.5 ? 0 : z >= 9.5 ? 150 : z >= 8.25 ? 400 : Infinity;
      labels.forEach(({ area, m }) => (area >= min ? labelLayer.addLayer(m) : labelLayer.removeLayer(m)));
    };
    map.on('zoomend', sync); sync();
  }
  function districtStyle(f) {
    const n = f.properties.district;
    const r = MATRIX.find((x) => x.district === n);
    const has = r && (fF.value ? r[fF.value] : r.total) > 0;
    const sel = fD.value === n;
    return { color: '#173a5e', weight: sel ? 3 : 1.2, opacity: 0.85, fillColor: has ? '#2a78d6' : '#a09e96', fillOpacity: fD.value && !sel ? 0.06 : has ? 0.24 : 0.16 };
  }
  function drawMap() {
    if (districtLayer) districtLayer.setStyle(districtStyle);
    pointLayer.clearLayers();
    for (const p of scoped()) {
      if (p.lat == null || p.lon == null) continue;
      const m = L.circleMarker([p.lat, p.lon], { pane: 'points', radius: 8, color: '#fff', weight: 2, fillColor: COLOR[p.form], fillOpacity: 0.95 });
      const box = el('div');
      box.appendChild(el('b', null, p.community || 'Unnamed community'));
      [['Form', p.form], ['Submitted by', p.interviewer], ['District', p.district], ['Sub-district', p.sub_district], ['Sent', `${when(p.submitted_at)} (${ago(p.submitted_at)})`], ['GPS accuracy', p.gps_accuracy_m != null ? `±${Math.round(p.gps_accuracy_m)} m` : null]]
        .forEach(([k, v]) => v && box.appendChild(el('div', null, `${k}: ${v}`)));
      m.bindPopup(box);
      m.bindTooltip(`${p.interviewer || 'Unknown'} · ${SHORT[p.form]}`, { direction: 'top', offset: [0, -6] });
      m.addTo(pointLayer);
    }
    if (fitPending && districtLayer) {
      let b = null;
      districtLayer.eachLayer((l) => { if (!fD.value || l.feature.properties.district === fD.value) { const lb = l.getBounds(); b = b ? b.extend(lb) : L.latLngBounds(lb.getSouthWest(), lb.getNorthEast()); } });
      if (b) map.fitBounds(b, { padding: [8, 8], maxZoom: 11 });
      fitPending = false;
    }
  }
  function ringHas(ring, x, y) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [x1, y1] = ring[i], [x2, y2] = ring[j]; if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) c = !c; } return c; }
  function districtAt(lat, lon) {
    if (!DISTRICTS) return null;
    for (const f of DISTRICTS.features) {
      const g = f.geometry, polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
      for (const p of polys) if (ringHas(p[0], lon, lat) && !p.slice(1).some((h) => ringHas(h, lon, lat))) return f.properties.district;
    }
    return 'outside the Western Region';
  }

  // ---------------- submissions per day ----------------
  function drawDaily() {
    const node = $('#daily');
    const S = inDistrict(inForm(DATA.submissions));
    const forms = fF.value ? [fF.value] : FORMS;
    $('#daily-legend').replaceChildren(...forms.map((f) => { const s = el('span'); const k = el('i', 'dotk'); k.style.background = COLOR[f]; s.append(k, f); return s; }));
    const first = S.map(subDay).filter(Boolean).sort()[0];
    if (!first) { node.replaceChildren(el('p', 'empty', 'No submissions yet.')); return; }
    const parse = d3.utcParse('%Y-%m-%d'), key = d3.utcFormat('%Y-%m-%d');
    const end = parse(todayStr());
    let days = d3.utcDay.range(parse(first), d3.utcDay.offset(end, 1));
    if (fP.value !== 'all') days = days.slice(-Number(fP.value));
    if (days.length < 3) days = d3.utcDay.range(d3.utcDay.offset(end, -2), d3.utcDay.offset(end, 1));
    const data = days.map((d) => { const k = key(d); const o = { d, k, total: 0 }; forms.forEach((f) => { o[f] = S.filter((r) => r.form === f && subDay(r) === k).length; o.total += o[f]; }); return o; });
    node.replaceChildren();
    const W = Math.max(260, node.clientWidth), H = Math.max(200, Math.min(320, Math.round(W * 0.5)));
    const m = { t: 18, r: 8, b: 26, l: 30 };
    const x = d3.scaleBand().domain(data.map((d) => d.k)).range([m.l, W - m.r]).padding(0.28);
    const y = d3.scaleLinear().domain([0, Math.max(4, d3.max(data, (d) => d.total))]).nice().range([H - m.b, m.t]);
    const svg = d3.select(node).append('svg').attr('width', W).attr('height', H).attr('role', 'img').attr('aria-label', 'Submissions per day by form');
    const ticks = y.ticks(4).filter(Number.isInteger);
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).tickValues(ticks).tickSize(-(W - m.l - m.r)).tickFormat('')).call((g) => g.select('.domain').remove());
    svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).tickValues(ticks).tickFormat(d3.format('d'))).call((g) => g.select('.domain').remove());
    const every = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor((W - m.l) / 56))));
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).tickValues(data.map((d) => d.k).filter((k, i) => (data.length - 1 - i) % every === 0)).tickFormat((k) => d3.utcFormat('%d %b')(parse(k))).tickSizeOuter(0));
    const stack = d3.stack().keys(forms)(data);
    const bw = x.bandwidth();
    svg.append('g').selectAll('g').data(stack).join('g').attr('fill', (s) => COLOR[s.key])
      .selectAll('rect').data((s) => s).join('rect')
      .attr('x', (d) => x(d.data.k)).attr('width', bw)
      .attr('y', (d) => y(d[1]) + (d[1] > d[0] ? 1 : 0)).attr('height', (d) => Math.max(0, y(d[0]) - y(d[1]) - (d[1] > d[0] ? 1 : 0)))
      .attr('rx', Math.min(3, bw / 4));
    svg.append('g').selectAll('text').data(data.filter((d) => d.total)).join('text').attr('class', 'val').attr('text-anchor', 'middle')
      .attr('x', (d) => x(d.k) + bw / 2).attr('y', (d) => y(d.total) - 5).text((d) => d.total);
    svg.append('g').selectAll('rect').data(data).join('rect').attr('x', (d) => x(d.k) - (x.step() - bw) / 2).attr('width', x.step()).attr('y', m.t).attr('height', H - m.t - m.b).attr('fill', 'transparent')
      .on('pointermove', (e, d) => tip.show(e, d3.utcFormat('%A %d %b')(d.d), [`${d.total} submission${d.total === 1 ? '' : 's'}`, ...forms.filter((f) => d[f]).map((f) => `${SHORT[f]}: ${d[f]}`)]))
      .on('pointerleave', tip.hide);
  }

  // ---------------- collectors ----------------
  let PEOPLE = [];
  function drawPeople() {
    const S = scoped();
    PEOPLE = d3.rollups(S.filter((r) => r.interviewer), (v) => ({
      n: v.length, last: d3.max(v, (r) => r.submitted_at),
      districts: [...new Set(v.map((r) => r.district).filter(Boolean))],
      forms: FORMS.filter((f) => v.some((r) => r.form === f)),
      byForm: Object.fromEntries(FORMS.map((f) => [f, v.filter((r) => r.form === f).length])),
    }), (r) => r.interviewer.replace(/\s+/g, ' ').trim()).map(([name, v]) => ({ name, ...v })).sort((a, b) => (b.last || '').localeCompare(a.last || ''));
    $('#people').classList.add('cards');
    const tb = $('#people tbody'); tb.replaceChildren();
    if (!PEOPLE.length) { const tr = el('tr'); const c = el('td', 'empty', 'No submissions for this selection yet.'); c.colSpan = 4; tr.appendChild(c); tb.appendChild(tr); return; }
    for (const p of PEOPLE) {
      const tr = el('tr');
      const who = el('span', 'who'); who.append(el('span', 'nm', p.name), el('span', 'dist', p.districts.join(', ') || 'No district'));
      tr.appendChild(td('Name', who, 'first'));
      const fs = el('span', 'forms'); p.forms.forEach((f) => { const i = el('i'); i.style.background = COLOR[f]; i.title = f; fs.appendChild(i); }); fs.append(' ' + p.forms.map((f) => SHORT[f]).join(', '));
      tr.appendChild(td('Forms', fs));
      tr.appendChild(td('Sent', fmt(p.n), 'r strong'));
      const days = (Date.now() - Date.parse(p.last)) / 864e5;
      const c = el('span'); c.append(ago(p.last) + ' ');
      if (subDay({ submitted_at: p.last }) === todayStr()) c.appendChild(el('span', 'chip good', 'Active today'));
      else if (days >= SILENT_DAYS) c.appendChild(el('span', 'chip bad', `Silent ${Math.floor(days)}+ days`));
      tr.appendChild(td('Last sent', c));
      tb.appendChild(tr);
    }
  }

  // ---------------- latest feed ----------------
  function drawFeed() {
    const ol = $('#feed'); ol.replaceChildren();
    const S = [...scoped()].sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || '')).slice(0, 20);
    if (!S.length) { ol.appendChild(el('li', 'empty', 'No submissions for this selection yet.')); return; }
    for (const r of S) {
      const li = el('li');
      li.append(dot(r.form), el('span', 'what', `${r.interviewer || 'Unknown'} · ${SHORT[r.form]}`), el('span', 'when', ago(r.submitted_at)), el('span', 'where', [r.community, r.district].filter(Boolean).join(', ') || 'No location given'));
      li.title = when(r.submitted_at);
      ol.appendChild(li);
    }
  }

  // ---------------- checks ----------------
  const CHECKS = [
    { id: 'gps_out', label: 'GPS outside selected district', test: (r) => r.lat != null && DISTRICTS && r.district && districtAt(r.lat, r.lon) !== r.district, detail: (r) => `GPS lies in ${districtAt(r.lat, r.lon)}` },
    { id: 'gps_missing', label: 'No GPS recorded', test: (r) => HAS_GPS[r.form] && (r.lat == null || r.lon == null) },
    { id: 'gps_low', label: `GPS accuracy worse than ${GPS_ACCURACY_M} m`, test: (r) => r.gps_accuracy_m != null && r.gps_accuracy_m > GPS_ACCURACY_M, detail: (r) => `GPS accuracy ±${Math.round(r.gps_accuracy_m)} m` },
    { id: 'rapid_hh', label: `Rapid with fewer than ${RAPID_HH} households`, test: (r) => r.form === 'Rapid assessment' && r.items != null && r.items < RAPID_HH, detail: (r) => `${r.items} of ${RAPID_HH} households` },
    { id: 'sct_20', label: `WHO SCT with fewer than ${SCT_PEOPLE} people`, test: (r) => r.form === 'WHO SCT' && r.items != null && r.items < SCT_PEOPLE, detail: (r) => `${r.items} of ${SCT_PEOPLE} people` },
    { id: 'short', label: 'Form completed very quickly', test: (r) => r.duration_min != null && r.duration_min < MIN_OPEN_MIN[r.form], detail: (r) => `Form open only ${openTxt(r.duration_min)}` },
    { id: 'late', label: `Sent ${LATE_UPLOAD_H}+ hours after finishing`, test: (r) => r.upload_delay_h != null && r.upload_delay_h >= LATE_UPLOAD_H, detail: (r) => `Sent ${Math.round(r.upload_delay_h)} h after finishing` },
    { id: 'dup', label: 'Possible duplicate', test: null },
    { id: 'no_district', label: 'No district selected', test: (r) => !r.district },
  ];
  let ISSUES = [];
  function findIssues(S) {
    const out = [];
    for (const c of CHECKS) {
      if (!c.test) continue;
      for (const r of S) if (c.test(r)) out.push({ check: c.id, label: c.label, detail: c.detail ? c.detail(r) : c.label, r });
    }
    const k = (r) => [r.form, (r.community || '').toLowerCase().replace(/[^a-z0-9]/g, ''), (r.interviewer || '').toLowerCase().trim(), subDay(r)].join('|');
    d3.groups(S.filter((r) => r.community && r.form !== 'District monitoring'), k).forEach(([, g]) => { if (g.length > 1) g.forEach((r) => out.push({ check: 'dup', label: 'Possible duplicate', detail: `Same collector, community and form ×${g.length} that day`, r })); });
    d3.groups(S.filter((r) => r.form === 'District monitoring' && r.district), (r) => r.district).forEach(([, g]) => { if (g.length > 1) g.forEach((r) => out.push({ check: 'dup', label: 'Possible duplicate', detail: `${g.length} district forms for ${r.district}`, r })); });
    return out;
  }
  function drawChecks() {
    const S = scoped();
    ISSUES = findIssues(S);
    const cards = $('#check-cards'); cards.replaceChildren();
    for (const c of CHECKS) {
      const n = ISSUES.filter((i) => i.check === c.id).length;
      const b = el('button', 'check ' + (n ? 'has' : 'ok')); b.type = 'button';
      b.setAttribute('aria-pressed', String(activeCheck === c.id));
      b.append(el('b', null, n ? fmt(n) : '✓ 0'), el('span', null, c.label));
      b.addEventListener('click', () => { activeCheck = activeCheck === c.id ? null : c.id; drawChecks(); });
      cards.appendChild(b);
    }
    const list = activeCheck ? ISSUES.filter((i) => i.check === activeCheck) : ISSUES;
    $('#issues').classList.add('cards');
    const tb = $('#issues tbody'); tb.replaceChildren();
    if (!list.length) { const tr = el('tr'); const c = el('td', 'empty', activeCheck ? '✓ Nothing found for this check.' : `✓ No issues in ${fmt(S.length)} submission${S.length === 1 ? '' : 's'}.`); c.colSpan = 6; tr.appendChild(c); tb.appendChild(tr); return; }
    for (const i of [...list].sort((a, b) => (b.r.submitted_at || '').localeCompare(a.r.submitted_at || '')).slice(0, 300)) {
      const tr = el('tr');
      const chip = el('span', 'chip warn', `⚠ ${i.detail}`); chip.title = i.label;
      tr.append(td('Check', chip, 'first'), td('Form', SHORT[i.r.form]), td('District', i.r.district || '—'), td('Community', i.r.community || '—'), td('Collector', i.r.interviewer || '—'), td('When', when(i.r.submitted_at)));
      tb.appendChild(tr);
    }
  }

  // ---------------- CSV ----------------
  function csv(rows, cols) {
    const q = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [cols.map((c) => q(c[1])).join(','), ...rows.map((r) => cols.map((c) => q(typeof c[0] === 'function' ? c[0](r) : r[c[0]])).join(','))].join('\n');
  }
  function download(name, text) {
    const a = el('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const CSVS = {
    districts: () => csv(MATRIX, [['district', 'District'], ...FORMS.map((f) => [f, f]), ['total', 'Total'], ['collectors', 'Collectors'], [(r) => r.last || '', 'Last submission (GMT)']]),
    collectors: () => csv(PEOPLE, [['name', 'Name'], [(p) => p.districts.join('; '), 'District'], ...FORMS.map((f) => [(p) => p.byForm[f], f]), ['n', 'Total sent'], ['last', 'Last sent (GMT)']]),
    checks: () => csv(ISSUES, [['label', 'Check'], ['detail', 'Detail'], [(i) => i.r.form, 'Form'], [(i) => i.r.district, 'District'], [(i) => i.r.community, 'Community'], [(i) => i.r.interviewer, 'Collector'], [(i) => i.r.submitted_at, 'Sent (GMT)'], [(i) => i.r.id, 'Kobo submission ID']]),
  };

  // ---------------- render ----------------
  function setDistrict(d) { fD.value = d; fitPending = true; render(); }
  function render() {
    if (!DATA) return;
    $('#clear-filters').hidden = !(fD.value || fF.value || fP.value !== 'all');
    computeMatrix();
    drawHeadline();
    drawMatrix();
    drawMap();
    drawDaily();
    drawPeople();
    drawFeed();
    drawChecks();
  }

  async function load() {
    const live = $('#live-dot'), upd = $('#updated'), err = $('#error');
    try {
      const res = await fetch('/api/data', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not load data');
      DATA = body;
      err.hidden = true; live.className = 'dot live';
      upd.textContent = `Live · updated ${d3.timeFormat('%d %b %Y, %H:%M')(new Date(DATA.generated_at))}`;
      render();
    } catch (e) {
      live.className = 'dot err'; upd.textContent = 'Update failed — showing the last data loaded';
      err.textContent = 'Could not load the latest data: ' + e.message; err.hidden = false;
    }
  }

  // ---------------- wire up ----------------
  initMap();
  fetch('districts.geojson').then((r) => r.json()).then((gj) => {
    DISTRICTS = gj;
    NAMES = gj.features.map((f) => f.properties.district).sort();
    fD.replaceChildren(new Option(`All ${NAMES.length} districts`, ''), ...NAMES.map((n) => new Option(n, n)));
    addDistricts();
    render();
  }).catch(() => {});
  fD.addEventListener('change', () => { fitPending = true; render(); });
  fF.addEventListener('change', render);
  fP.addEventListener('change', render);
  $('#clear-filters').addEventListener('click', () => { fD.value = ''; fF.value = ''; fP.value = 'all'; activeCheck = null; fitPending = true; render(); });
  $$('#matrix th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.sort; sort = { key: k, asc: sort.key === k ? !sort.asc : k === 'district' }; drawMatrix();
  }));
  $$('#matrix .sw[data-form]').forEach((i) => { i.style.background = COLOR[i.dataset.form]; });
  $$('[data-csv]').forEach((b) => b.addEventListener('click', () => { if (DATA) download(`mda-${b.dataset.csv}-${todayStr()}.csv`, CSVS[b.dataset.csv]()); }));
  let rt, lastW = innerWidth;
  addEventListener('resize', () => { if (innerWidth === lastW) return; lastW = innerWidth; clearTimeout(rt); rt = setTimeout(render, 200); });
  load();
  setInterval(load, REFRESH_MS);
})();
