/* MDA Round Two — submission monitoring dashboard.
   Loads /api/data (live KoboToolbox submissions) and districts.geojson (the 10 districts in this
   activity), then draws every card. */
(() => {
  // ---------------- settings ----------------
  const FORMS = ['CDD assessment', 'WHO SCT', 'Rapid assessment', 'District monitoring'];
  const SHORT = { 'CDD assessment': 'CDD', 'WHO SCT': 'WHO SCT', 'Rapid assessment': 'Rapid', 'District monitoring': 'District' };
  const COLOR = { 'CDD assessment': '#2a78d6', 'WHO SCT': '#eb6834', 'Rapid assessment': '#1baf7a', 'District monitoring': '#e3a008' };
  const REFRESH_MS = 5 * 60 * 1000;

  const fmt = d3.format(',');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const swatch = (form) => { const i = el('i', 'sw'); i.style.background = COLOR[form] || '#999'; return i; };
  const plural = (n, w) => `${fmt(n)} ${w}${n === 1 ? '' : 's'}`;

  let RAW = null, DATA = null, DISTRICTS = null, NAMES = [];
  let fitPending = true;
  const fD = $('#f-district'), fF = $('#f-form'), fP = $('#f-period');
  fF.append(...FORMS.map((f) => new Option(f, f)));

  // ---------------- time ----------------
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const dayOffset = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const subDay = (r) => (r.submitted_at || '').slice(0, 10) || r.date;
  const parseDay = d3.utcParse('%Y-%m-%d'), keyDay = d3.utcFormat('%Y-%m-%d');
  function ago(iso) {
    if (!iso) return '—';
    const m = (Date.now() - Date.parse(iso)) / 60000;
    if (m < 1) return 'just now';
    if (m < 60) return `${Math.round(m)} min ago`;
    if (m < 1440) return `${Math.round(m / 60)} h ago`;
    const d = Math.round(m / 1440);
    return d === 1 ? 'yesterday' : `${d} days ago`;
  }
  const when = (iso) => (iso ? d3.utcFormat('%d %b, %H:%M')(new Date(iso)) : '—');

  // ---------------- filtering ----------------
  const inPeriod = (rows) => { if (fP.value === 'all') return rows; const from = dayOffset(Number(fP.value) - 1); return rows.filter((r) => subDay(r) >= from); };
  const inForm = (rows) => (fF.value ? rows.filter((r) => r.form === fF.value) : rows);
  const inDistrict = (rows) => (fD.value ? rows.filter((r) => r.district === fD.value) : rows);
  const scoped = () => inDistrict(inForm(inPeriod(DATA)));
  const formsShown = () => (fF.value ? [fF.value] : FORMS);

  // ---------------- tooltip ----------------
  const tipEl = $('#tip');
  const tip = {
    show(e, title, lines) {
      tipEl.replaceChildren(el('b', null, title), ...lines.filter(Boolean).map((l) => el('div', null, l)));
      tipEl.hidden = false;
      const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      let x = e.clientX + 14, y = e.clientY + 14;
      if (x + w > innerWidth - 8) x = e.clientX - w - 14;
      if (y + h > innerHeight - 8) y = e.clientY - h - 14;
      tipEl.style.left = Math.max(4, x) + 'px'; tipEl.style.top = Math.max(4, y) + 'px';
    },
    hide() { tipEl.hidden = true; },
  };
  addEventListener('scroll', () => tip.hide(), { passive: true });

  // ---------------- per-district / per-person ----------------
  let BYD = [], PEOPLE = [];
  function compute() {
    const S = inForm(inPeriod(DATA));
    BYD = NAMES.map((d) => {
      const rows = S.filter((r) => r.district === d);
      const o = { district: d, total: rows.length, collectors: new Set(rows.map((r) => r.interviewer).filter(Boolean)).size, last: d3.max(rows, (r) => r.submitted_at) || null };
      FORMS.forEach((f) => { o[f] = rows.filter((r) => r.form === f).length; });
      return o;
    });
    const P = scoped().filter((r) => r.interviewer);
    PEOPLE = d3.rollups(P, (v) => {
      const o = { n: v.length, last: d3.max(v, (r) => r.submitted_at), districts: [...new Set(v.map((r) => r.district).filter(Boolean))] };
      FORMS.forEach((f) => { o[f] = v.filter((r) => r.form === f).length; });
      return o;
    }, (r) => r.interviewer.replace(/\s+/g, ' ').trim()).map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.n - a.n || (b.last || '').localeCompare(a.last || ''));
  }

  // ---------------- KPIs ----------------
  function drawKpis() {
    const S = scoped();
    const set = (k, v) => $$(`[data-s="${k}"]`).forEach((e) => { e.textContent = v; });
    set('total', fmt(S.length));
    const fb = $('#formbar'); fb.replaceChildren();
    const fk = $('#formkey'); fk.replaceChildren();
    for (const f of formsShown()) {
      const n = S.filter((r) => r.form === f).length;
      if (n) { const i = el('i'); i.style.background = COLOR[f]; i.style.flex = String(n); fb.appendChild(i); }
      const s = el('span'); s.append(swatch(f), SHORT[f], el('b', null, fmt(n))); fk.appendChild(s);
    }
    // districts
    const scopeNames = fD.value ? [fD.value] : NAMES;
    const done = scopeNames.filter((d) => S.some((r) => r.district === d));
    set('districts', done.length); set('districts_all', scopeNames.length);
    const g = $('#dgrid'); g.replaceChildren(); g.style.gridTemplateColumns = `repeat(${Math.max(1, NAMES.length)}, 1fr)`;
    for (const d of NAMES) {
      const r = BYD.find((x) => x.district === d);
      const i = el('i', r && r.total ? 'on' : '');
      if (fD.value && fD.value !== d) i.style.opacity = 0.25;
      i.addEventListener('mousemove', (e) => tip.show(e, d, [r && r.total ? plural(r.total, 'submission') : 'Nothing yet', r && r.last ? `Last: ${ago(r.last)}` : null]));
      i.addEventListener('mouseleave', tip.hide);
      i.addEventListener('click', () => setDistrict(fD.value === d ? '' : d));
      g.appendChild(i);
    }
    const missing = scopeNames.filter((d) => !done.includes(d));
    set('districts_ctx', missing.length ? `Not yet: ${missing.join(', ')}` : '✓ Every district has submitted');
    // collectors
    set('collectors', fmt(PEOPLE.length));
    const active = PEOPLE.filter((p) => subDay({ submitted_at: p.last }) === todayStr()).length;
    set('active_today', `● ${active} active today`);
    set('collectors_ctx', PEOPLE.length ? `Most forms: ${PEOPLE[0].name} (${PEOPLE[0].n})` : 'No submissions yet');
    // today + sparkline (last 14 days)
    const base = inDistrict(inForm(DATA));
    const t = base.filter((r) => subDay(r) === todayStr()).length, y = base.filter((r) => subDay(r) === dayOffset(1)).length;
    set('today', fmt(t));
    set('today_ctx', `${fmt(y)} yesterday${t > y ? ' · ▲ up' : t < y ? ' · ▼ down' : ''}`);
    const days = d3.range(13, -1, -1).map((n) => { const k = dayOffset(n); return { k, n: base.filter((r) => subDay(r) === k).length }; });
    const node = $('#spark'); node.replaceChildren();
    const W = node.clientWidth || 200, H = 34, bw = W / days.length;
    const ys = d3.scaleLinear().domain([0, Math.max(1, d3.max(days, (d) => d.n))]).range([0, H - 2]);
    const svg = d3.select(node).append('svg').attr('width', W).attr('height', H);
    svg.selectAll('rect').data(days).join('rect').attr('x', (d, i) => i * bw + 1).attr('width', Math.max(1, bw - 2))
      .attr('y', (d) => H - Math.max(2, ys(d.n))).attr('height', (d) => Math.max(2, ys(d.n))).attr('rx', 2)
      .attr('fill', (d, i) => (i === days.length - 1 ? '#0f2a44' : d.n ? '#9fc2ec' : '#e6e8eb'))
      .on('mousemove', (e, d) => tip.show(e, d3.utcFormat('%a %d %b')(parseDay(d.k)), [plural(d.n, 'submission')])).on('mouseleave', tip.hide);
  }

  // ---------------- horizontal stacked bars (districts, people) ----------------
  function stackedBars(node, rows, opts) {
    node.replaceChildren();
    if (!rows.length) { node.appendChild(el('p', 'empty', opts.empty)); return; }
    const forms = formsShown();
    const W = Math.max(260, node.clientWidth);
    const rowH = opts.rowH || 30, barH = 14;
    const H = rows.length * rowH;
    const svg = d3.select(node).append('svg').attr('width', W).attr('height', H).attr('role', 'img').attr('aria-label', opts.aria);
    const probe = svg.append('g');
    const tw = (s, c) => probe.append('text').attr('class', c || null).text(s).node().getComputedTextLength();
    const left = Math.min(d3.max(rows, (r) => tw(r.label, 'dname')) + 14, W * 0.42);
    const right = Math.min(d3.max(rows, (r) => tw(opts.right(r), 'val') + (opts.rightMuted ? tw(' ' + opts.rightMuted(r), 'muted') : 0)) + 12, W * 0.4);
    probe.remove();
    const max = opts.max || d3.max(rows, (r) => r.total) || 1;
    const x = d3.scaleLinear().domain([0, max]).range([0, W - left - right]);
    const g = svg.selectAll('g.row').data(rows).join('g').attr('class', (r) => 'row' + (opts.selected && opts.selected(r) ? ' sel' : '')).attr('transform', (r, i) => `translate(0,${i * rowH})`);
    g.append('rect').attr('class', 'bg').attr('width', W).attr('height', rowH).attr('rx', 6).attr('fill', 'transparent');
    g.append('text').attr('class', 'dname').attr('x', left - 10).attr('y', rowH / 2).attr('dy', '.35em').attr('text-anchor', 'end').text((r) => r.label)
      .each(function () { const t = d3.select(this); let s = t.text(); while (this.getComputedTextLength() > left - 14 && s.length > 3) { s = s.slice(0, -2); t.text(s + '…'); } });
    g.append('rect').attr('x', left).attr('y', (rowH - barH) / 2).attr('width', W - left - right).attr('height', barH).attr('rx', 4).attr('fill', '#f1f2f4');
    g.each(function (r) {
      let x0 = left;
      const segs = forms.filter((f) => r[f]).map((f) => ({ f, v: r[f] }));
      segs.forEach((s, i) => {
        const w = x(s.v);
        const isFirst = i === 0, isLast = i === segs.length - 1;
        d3.select(this).append('path').attr('fill', COLOR[s.f]).attr('d', roundedBar(x0, (rowH - barH) / 2, Math.max(1, w - (isLast ? 0 : 2)), barH, isFirst ? 4 : 0, isLast ? 4 : 0));
        x0 += w;
      });
      const tx = r.total ? left + x(r.total) + 8 : left + 8;
      const t = d3.select(this).append('text').attr('x', tx).attr('y', rowH / 2).attr('dy', '.35em');
      if (r.total) { t.append('tspan').attr('class', 'val').text(opts.right(r)); if (opts.rightMuted) t.append('tspan').attr('class', 'muted').text(' ' + opts.rightMuted(r)); }
      else t.attr('class', 'muted').text(opts.zeroText || 'Nothing yet');
    });
    g.append('rect').attr('class', 'hit').attr('width', W).attr('height', rowH).attr('fill', 'transparent')
      .on('mousemove', (e, r) => tip.show(e, r.label, opts.tip(r))).on('mouseleave', tip.hide)
      .on('click', (e, r) => opts.click && opts.click(r));
  }
  function roundedBar(x, y, w, h, rl, rr) {
    rl = Math.min(rl, w / 2, h / 2); rr = Math.min(rr, w / 2, h / 2);
    return `M${x + rl},${y}h${w - rl - rr}${rr ? `a${rr},${rr} 0 0 1 ${rr},${rr}v${h - 2 * rr}a${rr},${rr} 0 0 1 -${rr},${rr}` : `v${h}`}h-${w - rl - rr}${rl ? `a${rl},${rl} 0 0 1 -${rl},-${rl}v-${h - 2 * rl}a${rl},${rl} 0 0 1 ${rl},-${rl}` : `v-${h}`}z`;
  }

  function drawDistricts() {
    $('#district-legend').replaceChildren(...formsShown().map((f) => { const s = el('span'); const k = el('i', 'dotk'); k.style.background = COLOR[f]; s.append(k, f); return s; }));
    const rows = [...BYD].sort((a, b) => b.total - a.total || a.district.localeCompare(b.district)).map((r) => ({ ...r, label: r.district }));
    stackedBars($('#district-chart'), rows, {
      aria: 'Submissions per district, stacked by form', rowH: 38, empty: 'No districts loaded.',
      right: (r) => fmt(r.total), rightMuted: (r) => `· ${ago(r.last)}`, zeroText: 'No submissions yet',
      selected: (r) => r.district === fD.value,
      tip: (r) => [r.total ? plural(r.total, 'submission') : 'No submissions yet', ...formsShown().filter((f) => r[f]).map((f) => `${SHORT[f]}: ${r[f]}`), r.collectors ? plural(r.collectors, 'supervisor') : null, r.last ? `Last: ${when(r.last)}` : null, 'Tap to focus on this district'],
      click: (r) => setDistrict(fD.value === r.district ? '' : r.district),
    });
  }

  const TOP_PEOPLE = 10;
  function drawPeople() {
    const q = ($('#people-search').value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const ranked = PEOPLE.map((p, i) => ({ ...p, rank: i + 1, label: `${i + 1}. ${p.name}`, total: p.n }));
    const rows = q ? ranked.filter((p) => p.name.toLowerCase().includes(q)) : ranked.slice(0, TOP_PEOPLE);
    const note = $('#people-note');
    if (q) note.textContent = rows.length ? `${plural(rows.length, 'supervisor')} matching “${$('#people-search').value.trim()}”` : '';
    else note.textContent = PEOPLE.length > TOP_PEOPLE ? `Showing the top ${TOP_PEOPLE} of ${fmt(PEOPLE.length)} supervisors · search to find anyone else` : PEOPLE.length ? `All ${plural(PEOPLE.length, 'supervisor')} shown` : '';
    stackedBars($('#people-chart'), rows, {
      aria: 'Forms sent per supervisor', rowH: 30,
      empty: q ? `No supervisor matching “${$('#people-search').value.trim()}” for this selection.` : 'No submissions for this selection yet.',
      max: d3.max(PEOPLE, (p) => p.n),
      right: (r) => fmt(r.n),
      rightMuted: (r) => `· ${ago(r.last)}`,
      tip: (r) => [`Rank ${r.rank} of ${PEOPLE.length}`, r.districts.join(', ') || 'No district', plural(r.n, 'form'), ...formsShown().filter((f) => r[f]).map((f) => `${SHORT[f]}: ${r[f]}`), `Last sent: ${when(r.last)}`],
    });
  }

  // ---------------- map ----------------
  let map, districtLayer, labelLayer, pointLayer;
  function initMap() {
    map = L.map('map', { scrollWheelZoom: false, zoomSnap: 0.25, zoomDelta: 0.5, attributionControl: true }).setView([5.5, -2.2], 8.5);
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
    const a = el('span'); const ka = el('i', 'sq'); ka.style.background = 'rgba(42,120,214,.25)'; a.append(ka, 'District has submitted');
    const b = el('span'); const kb = el('i', 'sq'); kb.style.background = 'rgba(160,158,150,.18)'; b.append(kb, 'Nothing yet');
    lg.append(a, b);
  }
  function addDistricts() {
    districtLayer = L.geoJSON(DISTRICTS, {
      style: districtStyle,
      onEachFeature: (f, l) => {
        const n = f.properties.district;
        l.on('mousemove', (e) => { const r = BYD.find((x) => x.district === n); tip.show(e.originalEvent, n, r ? [r.total ? plural(r.total, 'submission') : 'No submissions yet', r.last ? `Last: ${ago(r.last)}` : null, 'Tap to focus on this district'] : []); });
        l.on('mouseout', () => tip.hide());
        l.on('click', () => setDistrict(fD.value === n ? '' : n));
      },
    }).addTo(map);
    districtLayer.bringToBack();
    const labels = DISTRICTS.features.map((f) => {
      const s = el('span', null, f.properties.district);
      return { area: f.properties.area_sqkm || 1000, m: L.marker([f.properties.label_lat, f.properties.label_lon], { pane: 'dlabels', interactive: false, keyboard: false, icon: L.divIcon({ className: 'dlabel', html: s.outerHTML, iconSize: [0, 0] }) }) };
    });
    const sync = () => { const z = map.getZoom(), min = z >= 10.5 ? 0 : z >= 9.25 ? 150 : z >= 8 ? 400 : Infinity; labels.forEach(({ area, m }) => (area >= min ? labelLayer.addLayer(m) : labelLayer.removeLayer(m))); };
    map.on('zoomend', sync); sync();
  }
  function districtStyle(f) {
    const r = BYD.find((x) => x.district === f.properties.district);
    const has = r && r.total > 0, sel = fD.value === f.properties.district;
    return { color: '#0f2a44', weight: sel ? 3 : 1.3, opacity: 0.8, fillColor: has ? '#2a78d6' : '#a09e96', fillOpacity: fD.value && !sel ? 0.05 : has ? 0.22 : 0.14 };
  }
  function drawMap() {
    if (districtLayer) districtLayer.setStyle(districtStyle);
    pointLayer.clearLayers();
    for (const p of scoped()) {
      if (p.lat == null || p.lon == null) continue;
      const m = L.circleMarker([p.lat, p.lon], { pane: 'points', radius: 7, color: '#fff', weight: 2, fillColor: COLOR[p.form], fillOpacity: 0.95 });
      const box = el('div', 'pop'); box.appendChild(el('b', null, p.community || 'Unnamed community'));
      [['Form', p.form], ['Supervisor', p.interviewer], ['District', p.district], ['Sub-district', p.sub_district], ['Sent', `${when(p.submitted_at)} · ${ago(p.submitted_at)}`], ['GPS accuracy', p.gps_accuracy_m != null ? `±${Math.round(p.gps_accuracy_m)} m` : null]]
        .forEach(([k, v]) => { if (!v) return; const d = el('div'); d.append(el('span', 'k', k + ': '), v); box.appendChild(d); });
      m.bindPopup(box); m.bindTooltip(el('span', null, `${p.community || 'Unnamed community'} · ${SHORT[p.form]}`), { direction: 'top', offset: [0, -6] });
      m.addTo(pointLayer);
    }
    if (fitPending && districtLayer) {
      let b = null;
      districtLayer.eachLayer((l) => { if (!fD.value || l.feature.properties.district === fD.value) { const lb = l.getBounds(); b = b ? b.extend(lb) : L.latLngBounds(lb.getSouthWest(), lb.getNorthEast()); } });
      if (b) map.fitBounds(b, { padding: [10, 10], maxZoom: 11 });
      fitPending = false;
    }
  }

  // ---------------- days ----------------
  function dayRange(rows, minDays) {
    const first = rows.map(subDay).filter(Boolean).sort()[0];
    const end = parseDay(todayStr());
    let days = first ? d3.utcDay.range(parseDay(first), d3.utcDay.offset(end, 1)) : [];
    if (fP.value !== 'all') days = days.slice(-Number(fP.value));
    if (days.length < minDays) days = d3.utcDay.range(d3.utcDay.offset(end, -(minDays - 1)), d3.utcDay.offset(end, 1));
    return days;
  }

  function drawDaily() {
    const node = $('#daily-chart'); node.replaceChildren();
    const S = inDistrict(inForm(DATA));
    if (!S.length) { node.appendChild(el('p', 'empty', 'No submissions yet.')); return; }
    const forms = formsShown();
    const days = dayRange(S, 5);
    const data = days.map((d) => { const k = keyDay(d); const o = { d, k, total: 0 }; forms.forEach((f) => { o[f] = S.filter((r) => r.form === f && subDay(r) === k).length; o.total += o[f]; }); return o; });
    const W = Math.max(260, node.clientWidth), H = Math.max(220, Math.min(300, node.clientHeight || 260));
    const m = { t: 20, r: 6, b: 24, l: 28 };
    const x = d3.scaleBand().domain(data.map((d) => d.k)).range([m.l, W - m.r]).paddingInner(0.3).paddingOuter(0.15);
    const y = d3.scaleLinear().domain([0, Math.max(4, d3.max(data, (d) => d.total))]).nice().range([H - m.b, m.t]);
    const svg = d3.select(node).append('svg').attr('width', W).attr('height', H).attr('role', 'img').attr('aria-label', 'Submissions per day, stacked by form');
    const ticks = y.ticks(4).filter(Number.isInteger);
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).tickValues(ticks).tickSize(-(W - m.l - m.r)).tickFormat('')).call((g) => g.select('.domain').remove());
    svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).tickValues(ticks).tickFormat(d3.format('d')).tickSize(0).tickPadding(6)).call((g) => g.select('.domain').remove());
    const every = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor((W - m.l) / 52))));
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).tickValues(data.map((d) => d.k).filter((k, i) => (data.length - 1 - i) % every === 0)).tickFormat((k) => (k === todayStr() ? 'Today' : d3.utcFormat('%d %b')(parseDay(k)))).tickSizeOuter(0));
    const bw = x.bandwidth();
    for (const d of data) {
      let y0 = 0;
      const segs = forms.filter((f) => d[f]);
      segs.forEach((f, i) => {
        const top = i === segs.length - 1;
        const y1 = y(y0 + d[f]), yb = y(y0);
        svg.append('path').attr('fill', COLOR[f]).attr('d', top ? `M${x(d.k)},${yb}V${y1 + 4}a4,4 0 0 1 4,-4h${bw - 8}a4,4 0 0 1 4,4V${yb}z` : `M${x(d.k)},${yb}V${y1 + 1.5}h${bw}V${yb}z`);
        y0 += d[f];
      });
    }
    svg.append('g').selectAll('text').data(data.filter((d) => d.total)).join('text').attr('class', 'val').attr('text-anchor', 'middle').attr('x', (d) => x(d.k) + bw / 2).attr('y', (d) => y(d.total) - 6).text((d) => d.total);
    svg.append('g').selectAll('rect').data(data).join('rect').attr('x', (d) => x(d.k) - (x.step() - bw) / 2).attr('width', x.step()).attr('y', m.t).attr('height', H - m.t - m.b).attr('fill', 'transparent')
      .on('mousemove', (e, d) => tip.show(e, d3.utcFormat('%A %d %b')(d.d), [plural(d.total, 'submission'), ...forms.filter((f) => d[f]).map((f) => `${SHORT[f]}: ${d[f]}`)])).on('mouseleave', tip.hide);
  }

  // ---------------- heatmap district × day ----------------
  function drawHeat() {
    const node = $('#heat-chart'); node.replaceChildren();
    const S = inForm(DATA);
    const names = fD.value ? [fD.value] : NAMES;
    let days = dayRange(S, 7);
    const W = Math.max(280, node.clientWidth);
    const probe = d3.select(node).append('svg').attr('width', 10).attr('height', 10);
    const left = d3.max(names, (n) => probe.append('text').attr('class', 'dname').text(n).node().getComputedTextLength()) + 16;
    probe.remove();
    const maxCols = Math.max(5, Math.floor((W - left - 40) / 26));
    if (days.length > maxCols) days = days.slice(-maxCols);
    const cell = Math.min(110, (W - left - 44) / days.length), gap = 4, rowH = 30;
    const top = 22, H = top + names.length * rowH + 4;
    const counts = new Map(); let max = 1;
    for (const r of S) { if (!r.district) continue; const k = r.district + '|' + subDay(r); const v = (counts.get(k) || 0) + 1; counts.set(k, v); max = Math.max(max, v); }
    const color = d3.scaleSequential([0, Math.log1p(max)], d3.interpolateRgb('#d6e6fa', '#0f3f80'));
    const svg = d3.select(node).append('svg').attr('width', W).attr('height', H).attr('role', 'img').attr('aria-label', 'Submissions per district per day');
    const every = Math.max(1, Math.ceil(42 / cell));
    days.forEach((d, j) => { if ((days.length - 1 - j) % every) return; svg.append('text').attr('x', left + j * cell + (cell - gap) / 2).attr('y', 12).attr('text-anchor', 'middle').attr('class', keyDay(d) === todayStr() ? 'val' : '').text(keyDay(d) === todayStr() ? 'Today' : d3.utcFormat('%d %b')(d)); });
    names.forEach((n, i) => {
      const yy = top + i * rowH;
      const tot = days.reduce((a, d) => a + (counts.get(n + '|' + keyDay(d)) || 0), 0);
      svg.append('text').attr('class', 'dname').attr('x', left - 12).attr('y', yy + (rowH - gap) / 2).attr('dy', '.35em').attr('text-anchor', 'end').text(n).style('opacity', tot ? 1 : 0.55)
        .style('cursor', 'pointer').on('click', () => setDistrict(fD.value === n ? '' : n));
      days.forEach((d, j) => {
        const k = keyDay(d), v = counts.get(n + '|' + k) || 0;
        const g = svg.append('g');
        g.append('rect').attr('x', left + j * cell).attr('y', yy).attr('width', cell - gap).attr('height', rowH - gap).attr('rx', 4).attr('fill', v ? color(Math.log1p(v)) : '#f1f2f4');
        if (v && cell >= 18) g.append('text').attr('x', left + j * cell + (cell - gap) / 2).attr('y', yy + (rowH - gap) / 2).attr('dy', '.35em').attr('text-anchor', 'middle').style('fill', Math.log1p(v) > Math.log1p(max) * 0.55 ? '#fff' : '#0f2a44').style('font-weight', 600).text(v);
        g.append('rect').attr('x', left + j * cell).attr('y', yy).attr('width', cell).attr('height', rowH).attr('fill', 'transparent')
          .on('mousemove', (e) => tip.show(e, n, [d3.utcFormat('%A %d %b')(d), v ? plural(v, 'submission') : 'No submissions'])).on('mouseleave', tip.hide);
      });
      svg.append('text').attr('class', tot ? 'val' : 'muted').attr('x', left + days.length * cell + 6).attr('y', yy + (rowH - gap) / 2).attr('dy', '.35em').text(tot || '—');
    });
  }

  // ---------------- table ----------------
  function drawTable() {
    const tb = $('#matrix tbody'); tb.replaceChildren();
    for (const r of [...BYD].sort((a, b) => b.total - a.total || a.district.localeCompare(b.district))) {
      const tr = el('tr');
      tr.appendChild(el('td', 'b', r.district));
      FORMS.forEach((f) => tr.appendChild(el('td', 'r' + (r[f] ? ' b' : ' z'), r[f] ? fmt(r[f]) : '—')));
      tr.appendChild(el('td', 'r' + (r.total ? ' b' : ' z'), r.total ? fmt(r.total) : '—'));
      tr.appendChild(el('td', 'r' + (r.collectors ? '' : ' z'), r.collectors || '—'));
      tr.appendChild(el('td', r.last ? '' : 'z', r.last ? `${when(r.last)} · ${ago(r.last)}` : 'Nothing yet'));
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
    districts: () => csv(BYD, [['district', 'District'], ...FORMS.map((f) => [f, f]), ['total', 'Total'], ['collectors', 'Supervisors'], [(r) => r.last || '', 'Last submission (GMT)']]),
    collectors: () => csv(PEOPLE, [['name', 'Name'], [(p) => p.districts.join('; '), 'District'], ...FORMS.map((f) => [f, f]), ['n', 'Total sent'], ['last', 'Last sent (GMT)']]),
  };

  // ---------------- render ----------------
  function setDistrict(d) { fD.value = d; fitPending = true; render(); }
  function render() {
    if (!RAW || !NAMES.length) return;
    DATA = RAW.submissions.filter((r) => NAMES.includes(r.district));   // only the 10 districts in this activity
    $('#clear-filters').hidden = !(fD.value || fF.value || fP.value !== 'all');
    tip.hide();
    compute();
    drawKpis();
    drawMap();
    drawDistricts();
    drawDaily();
    drawPeople();
    drawHeat();
    drawTable();
    document.dispatchEvent(new CustomEvent('dash:render'));
  }

  async function load() {
    const live = $('#live-dot'), upd = $('#updated'), err = $('#error');
    try {
      const res = await fetch('/api/data', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not load data');
      RAW = body;
      err.hidden = true; live.className = 'dot live';
      upd.textContent = `Live · updated ${d3.timeFormat('%d %b %Y, %H:%M')(new Date(RAW.generated_at))}`;
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
  let st; $('#people-search').addEventListener('input', () => { clearTimeout(st); st = setTimeout(() => { if (RAW && NAMES.length) drawPeople(); }, 120); });
  $('#clear-filters').addEventListener('click', () => { fD.value = ''; fF.value = ''; fP.value = 'all'; fitPending = true; render(); });
  $$('[data-csv]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (RAW) download(`mda-${b.dataset.csv === 'collectors' ? 'supervisors' : b.dataset.csv}-${todayStr()}.csv`, CSVS[b.dataset.csv]()); }));
  let rt, lastW = innerWidth;
  addEventListener('resize', () => { if (innerWidth === lastW) return; lastW = innerWidth; clearTimeout(rt); rt = setTimeout(() => { render(); map.invalidateSize(); }, 200); });
  load();
  setInterval(load, REFRESH_MS);
})();
