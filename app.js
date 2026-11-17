/* MDA Round Two monitoring dashboard.
   Loads /api/data (live KoboToolbox data) and districts.geojson, then draws every section.
   Targets come from the form instructions; change them here if the plan changes. */
(() => {
  // ---------------- settings ----------------
  const TARGET_COVERAGE = 65;      // % minimum effective coverage
  const HH_PER_DISTRICT = 24;      // rapid assessment: 2 sub-districts × 2 communities × 6 households
  const SCT_PER_DISTRICT = 1;      // WHO SCT: 1 community (20 households) per district
  const MON_PER_DISTRICT = 1;      // district monitoring form
  const LOW_N = 30;                // coverage based on fewer people than this is flagged
  const REFRESH_MS = 5 * 60 * 1000;

  // Fixed colours per form (identity) — same everywhere on the page.
  const FORM_COLOR = { 'CDD assessment': '#2a78d6', 'WHO SCT': '#eb6834', 'Rapid assessment': '#1baf7a', 'District monitoring': '#eda100' };
  const STATUS = { good: '#0ca30c', warn: '#fab219', bad: '#d03b3b', none: '#b9b7b0' };

  const fmt = d3.format(',');
  const pctTxt = (v, dp = 0) => (v == null ? '—' : v.toFixed(dp) + '%');
  const pct = (a, b) => (b > 0 ? (100 * a) / b : null);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  let DATA = null, DISTRICTS = null, NAMES = [];
  let sort = { key: 'district', asc: true };
  let metric = 'coverage';
  const fDistrict = $('#f-district'), fPeriod = $('#f-period');

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
      tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
    },
    hide() { tipEl.hidden = true; },
  };

  // ---------------- filtering ----------------
  const todayUTC = () => new Date().toISOString().slice(0, 10);
  function cutoff() {
    const p = fPeriod.value;
    if (p === 'all') return null;
    const d = new Date(); d.setUTCDate(d.getUTCDate() - (Number(p) - 1));
    return d.toISOString().slice(0, 10);
  }
  const inPeriod = (rows) => { const c = cutoff(); return c ? rows.filter((r) => r.date && r.date >= c) : rows; };
  const inDistrict = (rows) => { const d = fDistrict.value; return d ? rows.filter((r) => r.district === d) : rows; };
  const scoped = (rows) => inDistrict(inPeriod(rows));
  const nDistricts = () => (fDistrict.value ? 1 : NAMES.length || 14);

  // ---------------- per-district figures ----------------
  function districtRows() {
    const S = inPeriod(DATA.submissions), H = inPeriod(DATA.rapid_hh), T = inPeriod(DATA.sct_sites), C = inPeriod(DATA.cdd), M = inPeriod(DATA.monitor);
    return NAMES.map((name) => {
      const h = H.filter((r) => r.district === name);
      const persons = d3.sum(h, (r) => +r.persons || 0), treated = d3.sum(h, (r) => +r.treated || 0);
      const seen = d3.sum(h, (r) => +r.adults_seen || 0), aware = d3.sum(h, (r) => +r.adults_aware || 0);
      const t = T.filter((r) => r.district === name);
      const sctRank = { Good: 3, 'Cannot conclude': 2, Inadequate: 1 };
      const worst = t.length ? t.reduce((a, b) => (sctRank[b.decision] < sctRank[a.decision] ? b : a)) : null;
      return {
        district: name,
        mon: M.some((r) => r.district === name) ? 1 : 0,
        hh: h.length, hh_pct: Math.min(100, (100 * h.length) / HH_PER_DISTRICT),
        persons, treated, coverage: pct(treated, persons),
        seen, aware, awareness: pct(aware, seen),
        sct: worst ? sctRank[worst.decision] : 0, sct_label: worst ? worst.decision : null, sct_sites: t.length,
        sct_swallowed: worst ? worst.swallowed : null, sct_interviewed: worst ? worst.interviewed : null,
        cdd: C.filter((r) => r.district === name).length,
        last: d3.max(S.filter((r) => r.district === name), (r) => r.date) || null,
      };
    });
  }

  // ---------------- small helpers ----------------
  function chip(kind, text) { return el('span', 'chip ' + kind, text); }
  function coverageKind(cov) { return cov == null ? 'none' : cov >= TARGET_COVERAGE ? 'good' : 'bad'; }
  function sctKind(l) { return !l ? 'none' : l === 'Good' ? 'good' : l === 'Inadequate' ? 'bad' : 'warn'; }
  function sctIcon(l) { return l === 'Good' ? '✓ ' : l === 'Inadequate' ? '✕ ' : '● '; }
  function empty(node, msg) { node.replaceChildren(el('p', 'empty', msg)); }

  // horizontal bars with counts + share
  function hbar(node, rows, opts = {}) {
    node.replaceChildren();
    if (!rows.length) return empty(node, opts.empty || 'No answers yet.');
    const total = opts.total ?? d3.sum(rows, (r) => r.value);
    const W = Math.max(220, node.clientWidth);
    const barH = opts.barH || 18, gap = 8;
    const H = rows.length * (barH + gap);
    const svg = d3.select(node).append('svg').attr('width', W).attr('height', H).attr('role', 'img').attr('aria-label', opts.aria || 'Bar chart');
    const probe = svg.append('g');
    const tw = (s, c) => probe.append('text').attr('class', c || null).text(s).node().getComputedTextLength();
    const left = Math.min((d3.max(rows, (r) => tw(r.label)) || 0) + 10, W * 0.48);
    const lab = (r) => `${fmt(r.value)}${total ? ` · ${Math.round((100 * r.value) / total)}%` : ''}`;
    const right = (d3.max(rows, (r) => tw(lab(r), 'val')) || 0) + 10;
    probe.remove();
    const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.value) || 1]).range([left, W - right]);
    const g = svg.selectAll('g').data(rows).join('g').attr('transform', (r, i) => `translate(0,${i * (barH + gap)})`);
    g.append('text').attr('x', left - 8).attr('y', barH / 2).attr('dy', '.35em').attr('text-anchor', 'end').text((r) => r.label)
      .each(function () { const t = d3.select(this); let s = t.text(); while (this.getComputedTextLength() > left - 10 && s.length > 3) { s = s.slice(0, -2); t.text(s + '…'); } });
    g.append('path').attr('fill', opts.color || 'var(--accent)').attr('d', (r) => {
      const w = Math.max(0, x(r.value) - left), rr = Math.min(4, w, barH / 2);
      return `M${left},0h${w - rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${barH - 2 * rr}a${rr},${rr} 0 0 1 -${rr},${rr}h-${w - rr}z`;
    });
    g.append('text').attr('class', 'val').attr('x', (r) => x(r.value) + 6).attr('y', barH / 2).attr('dy', '.35em').text(lab);
    g.append('rect').attr('y', -gap / 2).attr('width', W).attr('height', barH + gap).attr('fill', 'transparent')
      .on('pointermove', (e, r) => tip.show(e, r.label, [`Mentioned ${fmt(r.value)} time${r.value === 1 ? '' : 's'}`, total ? `${Math.round((100 * r.value) / total)}% of all mentions` : ''].filter(Boolean)))
      .on('pointerleave', tip.hide);
  }
  function countTopic(topic, form) {
    const rows = scoped(DATA.multi).filter((r) => r.topic === topic && (!form || r.form === form));
    return d3.rollups(rows, (v) => v.length, (r) => r.option).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }

  // ---------------- summary ----------------
  function drawSummary() {
    const H = scoped(DATA.rapid_hh), M = scoped(DATA.monitor), T = scoped(DATA.sct_sites), C = scoped(DATA.cdd);
    const persons = d3.sum(H, (r) => +r.persons || 0), treated = d3.sum(H, (r) => +r.treated || 0);
    const cov = pct(treated, persons);
    const n = nDistricts();
    const set = (k, v) => $$(`[data-s="${k}"]`).forEach((e) => { e.textContent = v; });
    const bar = (k, v) => $$(`[data-s-bar="${k}"]`).forEach((e) => { e.style.width = Math.min(100, v || 0) + '%'; });

    const covEl = $('[data-s="coverage"]');
    covEl.textContent = pctTxt(cov);
    covEl.style.color = cov == null ? '' : cov >= TARGET_COVERAGE ? 'var(--good)' : 'var(--bad)';
    const ctx = $('[data-s="coverage_ctx"]'); ctx.replaceChildren();
    if (cov == null) ctx.textContent = 'No rapid-assessment households yet · target 65%';
    else {
      ctx.append(`${fmt(treated)} of ${fmt(persons)} people treated · target 65% `);
      ctx.append(cov >= TARGET_COVERAGE ? chip('good', '✓ above') : chip('bad', '✕ below'));
      if (persons < LOW_N) ctx.append(el('span', 'flag', 'low n'));
    }
    const hhT = HH_PER_DISTRICT * n; set('hh', fmt(H.length)); set('hh_target', fmt(hhT)); bar('hh', (100 * H.length) / hhT);
    set('hh_ctx', `${Math.round((100 * H.length) / hhT)}% of target · ${HH_PER_DISTRICT} per district`);
    const monN = new Set(M.map((r) => r.district)).size; set('mon', monN); set('mon_target', MON_PER_DISTRICT * n); bar('mon', (100 * monN) / n);
    const sctN = T.length; set('sct', sctN); set('sct_target', SCT_PER_DISTRICT * n); bar('sct', (100 * sctN) / n);
    const good = T.filter((r) => r.decision === 'Good').length, bad = T.filter((r) => r.decision === 'Inadequate').length;
    set('sct_ctx', sctN ? `${good} good · ${sctN - good - bad} cannot conclude · ${bad} inadequate` : 'No SCT sites assessed yet');
    set('cdd_n', fmt(C.length));
    set('cdd_trained', pctTxt(pct(C.filter((r) => r.trained === 'Yes').length, C.length)));
    set('cdd_socmob', pctTxt(pct(C.filter((r) => r.social_mobilization === 'Yes').length, C.length)));
  }

  // ---------------- scorecard ----------------
  let SCORE = [];
  function drawScorecard() {
    SCORE = districtRows();
    const rows = [...SCORE].sort((a, b) => {
      const k = sort.key, va = a[k], vb = b[k];
      if (va == null || vb == null) return va == null && vb == null ? a.district.localeCompare(b.district) : va == null ? 1 : -1; // blanks always last
      const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return (sort.asc ? c : -c) || a.district.localeCompare(b.district);
    });
    $$('#score-table th').forEach((th) => { th.classList.toggle('sorted', th.dataset.sort === sort.key); th.classList.toggle('asc', th.dataset.sort === sort.key && sort.asc); });
    const tb = $('#score-table tbody'); tb.replaceChildren();
    for (const r of rows) {
      const tr = el('tr'); tr.dataset.district = r.district;
      if (r.district === fDistrict.value) tr.classList.add('sel');
      tr.appendChild(el('td', 'dname', r.district));
      const tdM = el('td', 'c'); tdM.appendChild(r.mon ? chip('good', '✓ Received') : chip('none', 'Not yet')); tr.appendChild(tdM);
      const tdH = el('td'); const pb = el('span', 'pbar'); const tk = el('span', 'track'); const fi = el('i'); fi.style.width = r.hh_pct + '%'; tk.appendChild(fi);
      pb.append(tk, el('span', 'lab', `${r.hh} / ${HH_PER_DISTRICT}`)); tdH.appendChild(pb); tr.appendChild(tdH);
      const tdC = el('td', 'r');
      if (r.coverage == null) tdC.appendChild(el('span', 'muted', '—'));
      else { tdC.appendChild(chip(coverageKind(r.coverage), (r.coverage >= TARGET_COVERAGE ? '✓ ' : '✕ ') + pctTxt(r.coverage))); tdC.appendChild(el('span', 'muted', ` n=${r.persons}`)); if (r.persons < LOW_N) tdC.appendChild(el('span', 'flag', 'low n')); }
      tr.appendChild(tdC);
      const tdA = el('td', 'r'); tdA.textContent = r.awareness == null ? '—' : pctTxt(r.awareness); if (r.awareness == null) tdA.className = 'r muted'; tr.appendChild(tdA);
      const tdS = el('td'); tdS.appendChild(r.sct_label ? chip(sctKind(r.sct_label), `${sctIcon(r.sct_label)}${r.sct_label} (${r.sct_swallowed}/20)`) : chip('none', 'Not done')); tr.appendChild(tdS);
      tr.appendChild(el('td', 'r' + (r.cdd ? '' : ' muted'), r.cdd ? String(r.cdd) : '—'));
      tr.appendChild(el('td', r.last ? '' : 'muted', r.last ? d3.utcFormat('%d %b')(new Date(r.last)) : '—'));
      tr.addEventListener('click', () => setDistrict(fDistrict.value === r.district ? '' : r.district));
      tb.appendChild(tr);
    }
  }

  // ---------------- map ----------------
  let map, districtLayer, labelLayer, pointLayer, fitted = false;
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
  }
  function addDistricts() {
    districtLayer = L.geoJSON(DISTRICTS, {
      style: districtStyle,
      onEachFeature: (f, l) => {
        l.on('mousemove', (e) => { const r = SCORE.find((x) => x.district === f.properties.district); tip.show(e.originalEvent, f.properties.district, districtTipLines(r)); });
        l.on('mouseout', () => { tip.hide(); districtLayer.resetStyle(l); });
        l.on('mouseover', () => l.setStyle({ weight: 3 }));
        l.on('click', () => setDistrict(fDistrict.value === f.properties.district ? '' : f.properties.district));
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
  function metricValue(r) {
    if (!r) return null;
    return { coverage: r.coverage, hh: r.hh_pct, mon: r.mon, sct: r.sct_label }[metric];
  }
  function districtFill(r) {
    if (!r) return [STATUS.none, 0.15];
    if (metric === 'coverage') return r.coverage == null ? [STATUS.none, 0.18] : [r.coverage >= TARGET_COVERAGE ? STATUS.good : STATUS.bad, r.persons < LOW_N ? 0.2 : 0.45];
    if (metric === 'hh') { if (!r.hh) return [STATUS.none, 0.18]; const p = r.hh_pct; return [p >= 75 ? '#1c5cab' : p >= 50 ? '#3987e5' : p >= 25 ? '#86b6ef' : '#cde2fb', 0.65]; }
    if (metric === 'mon') return r.mon ? [STATUS.good, 0.4] : [STATUS.none, 0.18];
    if (metric === 'sct') return r.sct_label ? [STATUS[sctKind(r.sct_label)], 0.45] : [STATUS.none, 0.18];
    return [STATUS.none, 0.15];
  }
  function districtStyle(f) {
    const r = SCORE.find((x) => x.district === f.properties.district);
    const [c, o] = districtFill(r);
    const sel = fDistrict.value === f.properties.district;
    return { color: '#173a5e', weight: sel ? 3 : 1.2, opacity: 0.85, fillColor: c, fillOpacity: fDistrict.value && !sel ? o * 0.4 : o };
  }
  function districtTipLines(r) {
    if (!r) return [];
    return [
      `Coverage: ${r.coverage == null ? 'no data' : pctTxt(r.coverage) + ` (${fmt(r.treated)} of ${fmt(r.persons)})`}`,
      `Rapid households: ${r.hh} of ${HH_PER_DISTRICT}`,
      `Monitoring form: ${r.mon ? 'received' : 'not yet'}`,
      `WHO SCT: ${r.sct_label ? `${r.sct_label} (${r.sct_swallowed}/20)` : 'not done'}`,
      'Click to focus on this district',
    ];
  }
  function drawLegend() {
    const lg = $('#map-legend'); lg.replaceChildren();
    const item = (color, label, round) => { const s = el('span'); const i = el('i', round ? 'round' : null); i.style.background = color; s.append(i, label); return s; };
    if (metric === 'coverage') lg.append(item(STATUS.good, '65% or more'), item(STATUS.bad, 'Below 65%'), item(STATUS.none, 'No data'), el('span', 'muted', 'Paler = fewer than 30 people'));
    if (metric === 'hh') lg.append(item('#cde2fb', 'Under 25%'), item('#86b6ef', '25–49%'), item('#3987e5', '50–74%'), item('#1c5cab', '75%+ of 24'), item(STATUS.none, 'None yet'));
    if (metric === 'mon') lg.append(item(STATUS.good, 'Form received'), item(STATUS.none, 'Not yet'));
    if (metric === 'sct') lg.append(item(STATUS.good, 'Good'), item(STATUS.warn, 'Cannot conclude'), item(STATUS.bad, 'Inadequate'), item(STATUS.none, 'Not done'));
    lg.append(el('span', 'muted', '·'));
    ['CDD assessment', 'WHO SCT', 'Rapid assessment'].forEach((f) => lg.append(item(FORM_COLOR[f], f, true)));
  }
  function drawMap() {
    if (districtLayer) districtLayer.setStyle(districtStyle);
    drawLegend();
    pointLayer.clearLayers();
    const dec = new Map(DATA.sct_sites.map((r) => [String(r.id), r]));
    for (const p of scoped(DATA.submissions)) {
      if (p.lat == null || p.lon == null || !FORM_COLOR[p.form]) continue;
      const m = L.circleMarker([p.lat, p.lon], { pane: 'points', radius: 7, color: '#fff', weight: 2, fillColor: FORM_COLOR[p.form], fillOpacity: 0.95 });
      const box = el('div'); box.appendChild(el('b', null, p.community || 'Unnamed community'));
      const lines = [['Form', p.form], ['District', p.district], ['Sub-district', p.sub_district], ['Date', p.date], ['Collector', p.interviewer]];
      const s = dec.get(String(p.id)); if (s) lines.push(['SCT result', `${s.decision} (${s.swallowed}/20 swallowed)`]);
      const inD = districtAt(p.lat, p.lon); if (inD && inD !== p.district) lines.push(['⚠ GPS check', `point lies in ${inD}`]);
      lines.forEach(([k, v]) => v && box.appendChild(el('div', null, `${k}: ${v}`)));
      m.bindPopup(box); m.addTo(pointLayer);
    }
    if ((!fitted || fitPending) && districtLayer) {
      let b = null;
      districtLayer.eachLayer((l) => { if (!fDistrict.value || l.feature.properties.district === fDistrict.value) b = b ? b.extend(l.getBounds()) : L.latLngBounds(l.getBounds().getSouthWest(), l.getBounds().getNorthEast()); });
      if (b) map.fitBounds(b, { padding: [8, 8], maxZoom: 11 });
      fitted = true; fitPending = false;
    }
  }
  let fitPending = false;
  function ringHas(ring, x, y) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [x1, y1] = ring[i], [x2, y2] = ring[j]; if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) c = !c; } return c; }
  function districtAt(lat, lon) {
    if (!DISTRICTS) return null;
    for (const f of DISTRICTS.features) {
      const g = f.geometry, polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
      for (const p of polys) if (ringHas(p[0], lon, lat) && !p.slice(1).some((h) => ringHas(h, lon, lat))) return f.properties.district;
    }
    return 'outside the Western Region';
  }

  // ---------------- progress chart ----------------
  function drawProgress() {
    const node = $('#progress-chart');
    const n = nDistricts();
    const series = [
      { key: 'Rapid households', short: 'Households', color: FORM_COLOR['Rapid assessment'], target: HH_PER_DISTRICT * n, rows: inDistrict(DATA.rapid_hh) },
      { key: 'Monitoring forms', short: 'Monitoring', color: FORM_COLOR['District monitoring'], target: MON_PER_DISTRICT * n, rows: inDistrict(DATA.monitor), distinct: true },
      { key: 'SCT sites', short: 'SCT', color: FORM_COLOR['WHO SCT'], target: SCT_PER_DISTRICT * n, rows: inDistrict(DATA.sct_sites) },
    ];
    const lg = $('#progress-legend'); lg.replaceChildren(...series.map((s) => { const sp = el('span'); const i = el('i'); i.style.background = s.color; i.style.borderRadius = '50%'; sp.append(i, `${s.key} (target ${s.target})`); return sp; }));
    const dates = [...DATA.submissions, ...DATA.rapid_hh].map((r) => r.date).filter(Boolean).sort();
    if (!dates.length) return empty(node, 'No submissions yet.');
    const parse = d3.utcParse('%Y-%m-%d');
    let start = d3.utcDay.offset(parse(dates[0]), -1), end = parse(todayUTC());
    if (end <= start) end = d3.utcDay.offset(start, 2);
    const days = d3.utcDay.range(start, d3.utcDay.offset(end, 1));
    for (const s of series) {
      s.pts = days.map((d) => {
        const key = d3.utcFormat('%Y-%m-%d')(d);
        const upto = s.rows.filter((r) => r.date && r.date <= key);
        const count = s.distinct ? new Set(upto.map((r) => r.district)).size : upto.length;
        return { t: d, count, p: Math.min(100, (100 * count) / s.target) };
      });
    }
    node.replaceChildren();
    const W = Math.max(280, node.clientWidth), H = Math.max(260, Math.min(420, Math.round(W * 0.62)));
    const probe = d3.select(node).append('svg').attr('width', 10).attr('height', 10);
    const endW = d3.max(series, (s) => probe.append('text').attr('class', 'val').text(`${s.short} ${Math.round(s.pts[s.pts.length - 1].p)}%`).node().getComputedTextLength()) + 12;
    probe.remove();
    const m = { t: 12, r: endW + 22, b: 26, l: 40 };
    const x = d3.scaleUtc().domain([start, end]).range([m.l, W - m.r]);
    const y = d3.scaleLinear().domain([0, 100]).range([H - m.b, m.t]);
    const svg = d3.select(node).append('svg').attr('width', W).attr('height', H).attr('role', 'img').attr('aria-label', 'Cumulative progress toward targets');
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).tickValues([0, 25, 50, 75, 100]).tickSize(-(W - m.l - m.r)).tickFormat('')).call((g) => g.select('.domain').remove());
    svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).tickValues([0, 25, 50, 75, 100]).tickFormat((v) => v + '%')).call((g) => g.select('.domain').remove());
    const every = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor((W - m.l - m.r) / 70))));
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(d3.utcDay.every(every)).tickFormat(d3.utcFormat('%d %b')));
    const line = d3.line().x((d) => x(d.t)).y((d) => y(d.p)).curve(d3.curveStepAfter);
    // end labels, nudged apart
    // end labels: start from the lowest and push the others up so none overlap or drop below the axis
    const ends = series.map((s) => ({ s, y: Math.min(y(s.pts[s.pts.length - 1].p), H - m.b - 6) })).sort((a, b) => b.y - a.y || a.s.pts[a.s.pts.length - 1].p - b.s.pts[b.s.pts.length - 1].p);
    for (let i = 1; i < ends.length; i++) if (ends[i - 1].y - ends[i].y < 14) ends[i].y = ends[i - 1].y - 14;
    for (const s of series) {
      svg.append('path').datum(s.pts).attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', 2.25).attr('d', line);
      const last = s.pts[s.pts.length - 1];
      svg.append('circle').attr('cx', x(last.t)).attr('cy', y(last.p)).attr('r', 4).attr('fill', s.color).attr('stroke', '#fff').attr('stroke-width', 2);
      const ly = ends.find((e) => e.s === s).y;
      svg.append('circle').attr('cx', x(last.t) + 12).attr('cy', ly).attr('r', 3.5).attr('fill', s.color);
      svg.append('text').attr('class', 'val').attr('x', x(last.t) + 19).attr('y', ly).attr('dy', '.35em').text(`${s.short} ${Math.round(last.p)}%`);
    }
    const hover = svg.append('line').attr('y1', m.t).attr('y2', H - m.b).attr('stroke', '#bbb').attr('visibility', 'hidden');
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b).attr('fill', 'transparent')
      .on('pointermove', (e) => {
        const t = d3.utcDay.floor(x.invert(d3.pointer(e)[0])); const i = Math.max(0, Math.min(days.length - 1, d3.utcDay.count(start, t)));
        hover.attr('x1', x(days[i])).attr('x2', x(days[i])).attr('visibility', 'visible');
        tip.show(e, d3.utcFormat('%a %d %b %Y')(days[i]), series.map((s) => `${s.key}: ${s.pts[i].count} of ${s.target} (${Math.round(s.pts[i].p)}%)`));
      })
      .on('pointerleave', () => { hover.attr('visibility', 'hidden'); tip.hide(); });
  }

  // ---------------- reasons & answers ----------------
  function drawReasons() {
    const sets = [['#r1', '#n-r1', 'Reasons not treated'], ['#r2', '#n-r2', 'Reasons for refusal'], ['#r3', '#n-r3', 'Why not swallowed']];
    for (const [id, nid, topic] of sets) {
      const rows = countTopic(topic);
      const total = d3.sum(rows, (r) => r.value);
      $(nid).textContent = total ? `· ${fmt(total)} mention${total === 1 ? '' : 's'}` : '';
      hbar($(id), rows, { empty: 'None reported yet.', aria: topic, color: '#d97750' });
    }
    hbar($('#a-chal'), countTopic('District challenges'), { empty: 'None reported yet.', aria: 'District challenges', color: '#6a6964', barH: 14 });
    hbar($('#a-rec'), countTopic('Recommendations for NTDP'), { empty: 'None reported yet.', aria: 'Recommendations', color: '#6a6964', barH: 14 });
    hbar($('#a-chan'), countTopic('Social mobilization channels (community)'), { empty: 'None reported yet.', aria: 'Mobilization channels', color: '#6a6964', barH: 14 });
    hbar($('#a-src'), countTopic('Sources of information'), { empty: 'None reported yet.', aria: 'Sources of information', color: '#6a6964', barH: 14 });
  }

  // ---------------- supervision table ----------------
  function yn(v) { return v === 'Yes' ? chip('good', '✓ Yes') : v === 'No' ? chip('bad', '✕ No') : el('span', 'muted', '—'); }
  function drawSupervision() {
    const tb = $('#mon-table tbody'); tb.replaceChildren();
    const rows = scoped(DATA.monitor);
    if (!rows.length) { const tr = el('tr'); const td = el('td', 'empty', 'No district monitoring forms yet for this selection.'); td.colSpan = 7; tr.appendChild(td); tb.appendChild(tr); return; }
    for (const r of rows) {
      const tr = el('tr');
      tr.appendChild(el('td', 'dname', r.district));
      const a = el('td', 'c'); a.appendChild(yn(r.logistics_adequate)); tr.appendChild(a);
      tr.appendChild(el('td', 'r', fmt(r.ivm_in_stock)));
      tr.appendChild(el('td', 'r', fmt(r.health_workers_trained)));
      tr.appendChild(el('td', 'r', fmt(r.cdds_trained)));
      const b = el('td', 'c'); b.appendChild(yn(r.data_plan)); tr.appendChild(b);
      const c = el('td', 'c'); c.appendChild(yn(r.dhims_entry)); tr.appendChild(c);
      tb.appendChild(tr);
    }
  }

  // ---------------- data quality ----------------
  let ISSUES = [];
  function findIssues() {
    const out = [];
    const S = scoped(DATA.submissions);
    for (const p of S) {
      const base = { form: p.form, district: p.district || '—', community: p.community || '—', collector: p.interviewer || '—', date: p.date };
      if (!p.district) out.push({ issue: 'No district selected', ...base });
      if (p.form !== 'District monitoring' && (p.lat == null || p.lon == null)) out.push({ issue: 'Missing GPS', ...base });
      if (p.lat != null && DISTRICTS) { const d = districtAt(p.lat, p.lon); if (p.district && d !== p.district) out.push({ issue: `GPS falls in ${d}`, ...base }); }
    }
    const dupKey = (p) => [p.form, (p.community || '').toLowerCase().trim(), p.interviewer, p.date].join('|');
    d3.groups(S.filter((p) => p.form !== 'District monitoring' && p.community), dupKey).forEach(([, g]) => { if (g.length > 1) g.forEach((p) => out.push({ issue: `Possible duplicate (${g.length}×)`, form: p.form, district: p.district || '—', community: p.community, collector: p.interviewer || '—', date: p.date })); });
    d3.groups(scoped(DATA.monitor), (r) => r.district).forEach(([d, g]) => { if (g.length > 1) out.push({ issue: `${g.length} monitoring forms for one district`, form: 'District monitoring', district: d, community: '—', collector: '—', date: d3.max(g, (r) => r.date) }); });
    for (const h of scoped(DATA.rapid_hh)) if ((+h.treated || 0) > (+h.persons || 0)) out.push({ issue: 'More treated than living in household', form: 'Rapid assessment', district: h.district || '—', community: h.community || '—', collector: '—', date: h.date });
    for (const t of scoped(DATA.sct_sites)) if (t.interviewed && t.interviewed < 20) out.push({ issue: `SCT has ${t.interviewed} of 20 interviews`, form: 'WHO SCT', district: t.district || '—', community: t.community || '—', collector: t.interviewer || '—', date: t.date });
    return out;
  }
  function drawQuality() {
    ISSUES = findIssues();
    const chips = $('#q-chips'); chips.replaceChildren();
    const cat = (t) => (t.startsWith('GPS falls') ? 'GPS outside stated district' : t.startsWith('Possible duplicate') ? 'Possible duplicates' : t.startsWith('SCT has') ? 'SCT with fewer than 20 interviews' : t.includes('monitoring forms for one') ? 'Repeated monitoring forms' : t);
    const groups = d3.rollups(ISSUES, (v) => v.length, (r) => cat(r.issue));
    const S = scoped(DATA.submissions);
    const chipBox = (big, small) => { const d = el('div', 'qchip'); d.append(el('b', null, big), el('span', null, small)); return d; };
    chips.appendChild(chipBox(fmt(S.length), 'submissions checked'));
    chips.appendChild(chipBox(fmt(ISSUES.length), ISSUES.length === 1 ? 'issue found' : 'issues found'));
    groups.forEach(([k, v]) => chips.appendChild(chipBox(fmt(v), k)));
    const tb = $('#issue-table tbody'); tb.replaceChildren();
    if (!ISSUES.length) { const tr = el('tr'); const td = el('td', 'empty', '✓ No issues found for this selection.'); td.colSpan = 6; tr.appendChild(td); tb.appendChild(tr); }
    for (const r of ISSUES.slice(0, 200)) {
      const tr = el('tr'); const td = el('td'); td.appendChild(chip('warn', '⚠ ' + r.issue)); tr.appendChild(td);
      [r.form, r.district, r.community, r.collector, r.date || '—'].forEach((v) => tr.appendChild(el('td', null, v)));
      tb.appendChild(tr);
    }
    const en = d3.rollups(S.filter((r) => r.interviewer), (v) => ({ n: v.length, last: d3.max(v, (r) => r.date) }), (r) => r.interviewer).sort((a, b) => b[1].n - a[1].n);
    const et = $('#enum-table tbody'); et.replaceChildren();
    if (!en.length) { const tr = el('tr'); const td = el('td', 'empty', 'No submissions yet.'); td.colSpan = 3; tr.appendChild(td); et.appendChild(tr); }
    for (const [name, v] of en) { const tr = el('tr'); tr.append(el('td', null, name), el('td', 'r', fmt(v.n)), el('td', null, v.last || '—')); et.appendChild(tr); }
  }

  // ---------------- CSV ----------------
  function csv(rows, cols) {
    const q = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [cols.map((c) => q(c[1])).join(','), ...rows.map((r) => cols.map((c) => q(typeof c[0] === 'function' ? c[0](r) : r[c[0]])).join(','))].join('\n');
  }
  function download(name, text) {
    const a = el('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const CSVS = {
    scorecard: () => csv(SCORE, [['district', 'District'], [(r) => (r.mon ? 'Received' : 'Not yet'), 'Monitoring form'], ['hh', 'Rapid households'], [() => HH_PER_DISTRICT, 'Household target'], ['treated', 'People treated'], ['persons', 'People in households'], [(r) => (r.coverage == null ? '' : r.coverage.toFixed(1)), 'Coverage %'], [(r) => (r.awareness == null ? '' : r.awareness.toFixed(1)), 'Awareness %'], ['sct_label', 'SCT result'], ['sct_swallowed', 'SCT swallowed of 20'], ['cdd', 'CDDs assessed'], ['last', 'Last activity']]),
    monitor: () => csv(scoped(DATA.monitor), [['district', 'District'], ['date', 'Submitted'], ['logistics_adequate', 'Logistics adequate'], ['ivm_in_stock', 'IVM in stock'], ['moxidectin_in_stock', 'Moxidectin in stock'], ['health_workers_trained', 'Health workers trained'], ['cdds_trained', 'CDDs trained'], ['communities', 'Communities'], ['social_mobilization', 'Social mobilization'], ['data_plan', 'Data plan'], ['dhims_entry', 'DHIMS 2 entry'], ['hard_to_reach', 'Hard-to-reach areas']]),
    cdd: () => csv(scoped(DATA.cdd), [['district', 'District'], ['community', 'Community'], ['date', 'Date'], ['trained', 'Trained before distribution'], ['social_mobilization', 'Social mobilization done'], ['expected_pay', 'Expected pay']]),
    issues: () => csv(ISSUES, [['issue', 'Issue'], ['form', 'Form'], ['district', 'District'], ['community', 'Community'], ['collector', 'Collector'], ['date', 'Date']]),
  };

  // ---------------- render ----------------
  function setDistrict(d) { fDistrict.value = d; fitPending = true; render(); }
  function render() {
    if (!DATA) return;
    drawSummary();
    drawScorecard();
    drawMap();
    drawProgress();
    drawReasons();
    drawSupervision();
    drawQuality();
  }

  async function load() {
    const dot = $('#live-dot'), upd = $('#updated'), err = $('#error');
    try {
      const res = await fetch('/api/data', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not load data');
      DATA = body;
      err.hidden = true; dot.className = 'dot live';
      upd.textContent = `Live · updated ${d3.timeFormat('%d %b %Y, %H:%M')(new Date(DATA.generated_at))} · ${fmt(DATA.submissions.length)} submissions in total`;
      render();
    } catch (e) {
      dot.className = 'dot err'; upd.textContent = 'Update failed — showing the last data loaded';
      err.textContent = 'Could not load the latest data: ' + e.message; err.hidden = false;
    }
  }

  // ---------------- wire up ----------------
  initMap();
  fetch('districts.geojson').then((r) => r.json()).then((gj) => {
    DISTRICTS = gj;
    NAMES = gj.features.map((f) => f.properties.district).sort();
    fDistrict.replaceChildren(new Option(`All ${NAMES.length} districts`, ''), ...NAMES.map((n) => new Option(n, n)));
    addDistricts();
    render();
  }).catch(() => { NAMES = []; });
  fDistrict.addEventListener('change', () => { fitPending = true; render(); });
  fPeriod.addEventListener('change', render);
  $$('#score-table th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.sort; sort = { key: k, asc: sort.key === k ? !sort.asc : k === 'district' || k === 'last' ? k === 'district' : false }; drawScorecard();
  }));
  $$('#map-metric button').forEach((b) => b.addEventListener('click', () => {
    metric = b.dataset.m; $$('#map-metric button').forEach((x) => x.setAttribute('aria-selected', String(x === b))); drawMap();
  }));
  $$('[data-csv]').forEach((b) => b.addEventListener('click', () => { if (DATA) download(`mda-${b.dataset.csv}-${todayUTC()}.csv`, CSVS[b.dataset.csv]()); }));
  $('#print-btn').addEventListener('click', () => window.print());
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 200); });
  load();
  setInterval(load, REFRESH_MS);
})();
