/* MDA Round Two dashboard — fetches /api/data and draws everything. */
(() => {
  const FORMS = ['CDD assessment', 'WHO SCT', 'Rapid assessment', 'District monitoring'];
  const COLORS = { 'CDD assessment': '#2a78d6', 'WHO SCT': '#eb6834', 'Rapid assessment': '#1baf7a', 'District monitoring': '#eda100' };
  const TARGET = 65; // % minimum effective coverage line
  const REFRESH_MS = 5 * 60 * 1000;
  const fmt = d3.format(',');
  const pctTxt = (v) => (v == null ? 'n/a' : v.toFixed(1) + '%');
  const pct = (a, b) => (b > 0 ? Math.round((1000 * a) / b) / 10 : null);

  let DATA = null;
  let topic = null;
  const $ = (s) => document.querySelector(s);
  const districtSel = $('#district');
  const topicSel = $('#topic');

  // ---------- tooltip ----------
  const tipEl = $('#tip');
  const tip = {
    show(e, lines) {
      tipEl.replaceChildren(...lines.map(([k, v], i) => {
        const p = document.createElement('div');
        if (i === 0) { const b = document.createElement('b'); b.textContent = k; p.appendChild(b); }
        else { const s = document.createElement('span'); s.textContent = k + ' '; p.append(s, v ?? ''); }
        return p;
      }));
      tipEl.hidden = false;
      const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      let x = e.clientX + 14, y = e.clientY + 14;
      if (x + w > innerWidth - 8) x = e.clientX - w - 14;
      if (y + h > innerHeight - 8) y = e.clientY - h - 14;
      tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
    },
    hide() { tipEl.hidden = true; },
  };

  // ---------- data shaping ----------
  const pick = (rows) => { const d = districtSel.value; return d ? rows.filter((r) => r.district === d) : rows; };

  function kpis() {
    const s = pick(DATA.submissions), h = pick(DATA.rapid_hh), t = pick(DATA.sct_sites), c = pick(DATA.cdd), m = pick(DATA.monitor);
    const sum = (rows, k) => d3.sum(rows, (r) => +r[k] || 0);
    return {
      submissions: s.length,
      communities: new Set(s.filter((r) => r.community).map((r) => (r.district + '|' + r.community).toLowerCase().trim())).size,
      districts: new Set(s.map((r) => r.district).filter(Boolean)).size,
      households: h.length,
      coverage_pct: pct(sum(h, 'treated'), sum(h, 'persons')),
      awareness_pct: pct(sum(h, 'adults_aware'), sum(h, 'adults_seen')),
      hh_visited_pct: pct(h.filter((r) => r.visited === 'Yes').length, h.length),
      sct_sites: t.length,
      sct_good: t.filter((r) => r.decision === 'Good').length,
      cdd_n: c.length,
      cdd_trained_pct: pct(c.filter((r) => r.trained === 'Yes').length, c.length),
      cdd_socmob_pct: pct(c.filter((r) => r.social_mobilization === 'Yes').length, c.length),
      monitor_districts: new Set(m.map((r) => r.district).filter(Boolean)).size,
    };
  }

  // ---------- drawing helpers ----------
  function empty(el, msg) { el.replaceChildren(); const p = document.createElement('p'); p.className = 'empty'; p.textContent = msg; el.appendChild(p); }

  function hbar(el, rows, opts) {
    el.replaceChildren();
    if (!rows.length) return empty(el, opts.empty || 'No data yet.');
    const W = Math.max(260, el.clientWidth);
    const barH = 22, gap = 9, top = opts.ref != null ? 20 : 2;
    const H = top + rows.length * (barH + gap);
    const svg = d3.select(el).append('svg').attr('width', W).attr('height', H).attr('role', 'img').attr('aria-label', opts.aria);
    const probe = svg.append('g');
    const tw = (s, cls) => { const t = probe.append('text').attr('class', cls || null).text(s); return t.node().getComputedTextLength(); };
    const left = Math.min((d3.max(rows, (r) => tw(r.label)) || 0) + 12, W * 0.45);
    const right = (d3.max(rows, (r) => tw(opts.fmt(r.value), 'val')) || 0) + 12;
    probe.remove();
    const x = d3.scaleLinear().domain([0, opts.max ?? (d3.max(rows, (r) => r.value) || 1)]).range([left, W - right]);
    const g = svg.selectAll('g.row').data(rows).join('g').attr('transform', (r, i) => `translate(0,${top + i * (barH + gap)})`);
    g.append('text').attr('x', left - 8).attr('y', barH / 2).attr('dy', '0.35em').attr('text-anchor', 'end').text((r) => r.label)
      .each(function () { const t = d3.select(this); let s = t.text(); while (this.getComputedTextLength() > left - 12 && s.length > 3) { s = s.slice(0, -2); t.text(s + '…'); } });
    g.append('path').attr('d', (r) => { const w = Math.max(0, x(r.value || 0) - left); const rr = Math.min(4, w); return `M${left},0h${w - rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${barH - 2 * rr}a${rr},${rr} 0 0 1 -${rr},${rr}h-${w - rr}z`; })
      .attr('fill', (r) => r.color);
    g.append('text').attr('class', 'val').attr('x', (r) => x(r.value || 0) + 6).attr('y', barH / 2).attr('dy', '0.35em').text((r) => opts.fmt(r.value));
    g.append('rect').attr('width', W).attr('height', barH + gap).attr('y', -gap / 2).attr('fill', 'transparent')
      .on('pointermove', (e, r) => tip.show(e, r.tip)).on('pointerleave', tip.hide);
    if (opts.ref != null) {
      const rx = x(opts.ref);
      svg.append('line').attr('x1', rx).attr('x2', rx).attr('y1', 14).attr('y2', H).attr('stroke', '#8a8984').attr('stroke-dasharray', '4 3');
      svg.append('text').attr('x', rx).attr('y', 10).attr('text-anchor', 'middle').text(opts.ref + '%');
    }
  }

  function drawDays() {
    const el = $('#chart-days');
    const s = pick(DATA.submissions).filter((r) => r.date);
    const legend = $('#legend-days');
    legend.replaceChildren(...FORMS.map((f) => { const sp = document.createElement('span'); const i = document.createElement('i'); i.style.background = COLORS[f]; sp.append(i, f); return sp; }));
    if (!s.length) return empty(el, 'No submissions yet.');
    el.replaceChildren();
    const parse = d3.utcParse('%Y-%m-%d');
    const days = [...new Set(s.map((r) => r.date))].sort();
    let ext = d3.extent(days, parse);
    if (+ext[0] === +ext[1]) ext = [d3.utcDay.offset(ext[0], -1), d3.utcDay.offset(ext[1], 1)];
    const allDays = d3.utcDay.range(ext[0], d3.utcDay.offset(ext[1], 1));
    const series = FORMS.map((f) => ({ form: f, pts: allDays.map((d) => ({ t: d, n: s.filter((r) => r.form === f && r.date === d3.utcFormat('%Y-%m-%d')(d)).length })) }))
      .filter((sr) => d3.sum(sr.pts, (p) => p.n) > 0);
    const W = Math.max(280, el.clientWidth), H = 220, m = { t: 10, r: 14, b: 26, l: 32 };
    const x = d3.scaleUtc().domain(ext).range([m.l, W - m.r]);
    const y = d3.scaleLinear().domain([0, d3.max(series, (sr) => d3.max(sr.pts, (p) => p.n)) || 1]).nice().range([H - m.b, m.t]);
    const svg = d3.select(el).append('svg').attr('width', W).attr('height', H).attr('role', 'img').attr('aria-label', 'Submissions per day by form');
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).tickValues(y.ticks(4).filter(Number.isInteger)).tickSize(-(W - m.l - m.r)).tickFormat('')).call((g) => g.select('.domain').remove());
    const every = Math.max(1, Math.ceil(allDays.length / Math.max(2, Math.floor(W / 80))));
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(d3.utcDay.every(every)).tickFormat(d3.utcFormat('%d %b')));
    svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).tickValues(y.ticks(4).filter(Number.isInteger)).tickFormat(d3.format('d'))).call((g) => g.select('.domain').remove());
    for (const sr of series) {
      svg.append('path').datum(sr.pts).attr('fill', 'none').attr('stroke', COLORS[sr.form]).attr('stroke-width', 2).attr('d', d3.line().x((p) => x(p.t)).y((p) => y(p.n)));
      svg.selectAll(null).data(sr.pts).join('circle').attr('cx', (p) => x(p.t)).attr('cy', (p) => y(p.n)).attr('r', 4).attr('fill', COLORS[sr.form]).attr('stroke', '#fff').attr('stroke-width', 2);
    }
    // crosshair hover
    const hover = svg.append('line').attr('y1', m.t).attr('y2', H - m.b).attr('stroke', '#bbb').attr('visibility', 'hidden');
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b).attr('fill', 'transparent')
      .on('pointermove', (e) => {
        const [px] = d3.pointer(e); const t = d3.utcDay.round(x.invert(px));
        const key = d3.utcFormat('%Y-%m-%d')(t);
        hover.attr('x1', x(t)).attr('x2', x(t)).attr('visibility', 'visible');
        tip.show(e, [[d3.utcFormat('%a %d %b %Y')(t)], ...FORMS.map((f) => [f + ':', String(s.filter((r) => r.form === f && r.date === key).length)])]);
      })
      .on('pointerleave', () => { hover.attr('visibility', 'hidden'); tip.hide(); });
  }

  // ---------- map ----------
  let map, layers = {}, boundaryLayer = null, labelLayer = null, DISTRICTS = null, fitted = false;
  function initMap() {
    map = L.map('map', { scrollWheelZoom: false, zoomSnap: 0.25, zoomDelta: 0.5 }).setView([5.55, -2.2], 8);
    map.on('click', () => map.scrollWheelZoom.enable());
    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri' });
    const satLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
    const satGroup = L.layerGroup([sat, satLabels]);
    map.createPane('dlabels').style.zIndex = 450; // district names above boundaries
    map.createPane('points').style.zIndex = 500;  // submission dots above names
    FORMS.slice(0, 3).forEach((f) => { layers[f] = L.layerGroup().addTo(map); });
    const overlays = Object.fromEntries(FORMS.slice(0, 3).map((f) => [`<span style="color:${COLORS[f]}">●</span> ${f}`, layers[f]]));
    const ctl = L.control.layers({ Streets: streets, Satellite: satGroup }, overlays, { collapsed: true }).addTo(map);
    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = () => { const d = L.DomUtil.create('div', 'map-legend'); d.innerHTML = FORMS.slice(0, 3).map((f) => `<div><i style="background:${COLORS[f]}"></i>${f}</div>`).join(''); return d; };
    legend.addTo(map);
    // District boundaries (districts.geojson next to index.html).
    fetch('districts.geojson').then((r) => (r.ok ? r.json() : null)).then((gj) => {
      if (!gj) return;
      DISTRICTS = gj;
      boundaryLayer = L.geoJSON(gj, {
        style: districtStyle,
        onEachFeature: (f, l) => {
          const n = f.properties.district;
          l.bindTooltip(() => districtTip(n), { sticky: true });
          l.on('click', () => { districtSel.value = districtSel.value === n ? '' : n; districtSel.dataset.changed = '1'; render(); });
          l.on('mouseover', () => l.setStyle({ weight: 3 }));
          l.on('mouseout', () => boundaryLayer.resetStyle(l));
        },
      }).addTo(map);
      labelLayer = L.layerGroup();
      const labels = gj.features.map((f) => {
        const span = document.createElement('span'); span.textContent = f.properties.district;
        const at = f.properties.label_lat != null ? L.latLng(f.properties.label_lat, f.properties.label_lon) : labelPoint(f);
        return { area: f.properties.area_sqkm || 1000, m: L.marker(at, { icon: L.divIcon({ className: 'dlabel', html: span.outerHTML, iconSize: [0, 0] }), pane: 'dlabels', interactive: false, keyboard: false }) };
      });
      ctl.addOverlay(boundaryLayer, 'District boundaries');
      ctl.addOverlay(labelLayer, 'District names');
      boundaryLayer.bringToBack();
      const syncLabels = () => {
        const z = map.getZoom();
        const minArea = z >= 10.5 ? 0 : z >= 9.5 ? 150 : z >= 8.5 ? 400 : Infinity; // small districts get names once zoomed in
        labels.forEach(({ area, m }) => { if (area >= minArea) labelLayer.addLayer(m); else labelLayer.removeLayer(m); });
        if (!map.hasLayer(labelLayer) && !labelLayer._userOff) labelLayer.addTo(map);
      };
      map.on('overlayremove', (e) => { if (e.layer === labelLayer) labelLayer._userOff = true; });
      map.on('overlayadd', (e) => { if (e.layer === labelLayer) labelLayer._userOff = false; });
      map.on('zoomend', syncLabels); syncLabels();
      const lg = document.querySelector('.map-legend');
      if (lg) lg.insertAdjacentHTML('beforeend', '<div><i class="sq" style="background:#c9dcf3;border-color:#12395f"></i>District with submissions</div><div><i class="sq" style="background:#dedcd6;border-color:#12395f"></i>No submissions yet</div><div class="hint">Click a district to filter</div>');
      fitted = false;
      fillDistricts();
      if (DATA) render();
    }).catch(() => {});
  }

  function fillDistricts() {
    const cur = districtSel.value;
    const ds = [...new Set([...(DATA ? DATA.submissions.map((r) => r.district) : []), ...(DISTRICTS ? DISTRICTS.features.map((f) => f.properties.district) : [])].filter(Boolean))].sort();
    districtSel.replaceChildren(new Option('All districts', ''), ...ds.map((d) => new Option(d, d)));
    districtSel.value = ds.includes(cur) ? cur : '';
  }

  // ---------- district helpers ----------
  function ringContains(ring, x, y) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[j];
      if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) c = !c;
    }
    return c;
  }
  function districtAt(lat, lon) {
    if (!DISTRICTS) return null;
    for (const f of DISTRICTS.features) {
      const g = f.geometry, polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
      for (const p of polys) if (ringContains(p[0], lon, lat) && !p.slice(1).some((h) => ringContains(h, lon, lat))) return f.properties.district;
    }
    return 'outside the Western Region';
  }
  function labelPoint(f) {
    // centre of the largest polygon's bounding box, nudged inside if needed
    const g = f.geometry, polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    const big = polys.reduce((a, p) => (p[0].length > a[0].length ? p : a));
    const b = L.latLngBounds(big[0].map(([x, y]) => [y, x]));
    const c = b.getCenter();
    if (ringContains(big[0], c.lng, c.lat)) return c;
    const pts = big[0]; let best = pts[0];
    let bx = 0, by = 0; pts.forEach(([x, y]) => { bx += x; by += y; }); best = [bx / pts.length, by / pts.length];
    return L.latLng(best[1], best[0]);
  }
  function districtStyle(f) {
    const n = f.properties.district;
    const sel = districtSel.value;
    const has = DATA && DATA.submissions.some((r) => r.district === n);
    if (sel === n) return { color: '#12395f', weight: 3, fillColor: '#2a78d6', fillOpacity: 0.22 };
    return { color: '#12395f', weight: 1.4, opacity: 0.8, fillColor: has ? '#2a78d6' : '#7a7974', fillOpacity: sel ? 0.05 : has ? 0.14 : 0.12 };
  }
  function districtTip(n) {
    const box = document.createElement('div');
    const b = document.createElement('b'); b.textContent = n; box.appendChild(b);
    if (DATA) {
      const s = DATA.submissions.filter((r) => r.district === n);
      const h = DATA.rapid_hh.filter((r) => r.district === n);
      const cov = pct(d3.sum(h, (r) => +r.treated || 0), d3.sum(h, (r) => +r.persons || 0));
      const lines = [`Submissions: ${s.length}`];
      FORMS.forEach((f) => { const k = s.filter((r) => r.form === f).length; if (k) lines.push(`· ${f}: ${k}`); });
      if (cov != null) lines.push(`Treatment coverage: ${pctTxt(cov)}`);
      lines.push(DATA.monitor.some((r) => r.district === n) ? 'District monitoring form: received' : 'District monitoring form: not yet');
      lines.forEach((t) => { const d = document.createElement('div'); d.textContent = t; box.appendChild(d); });
    }
    return box;
  }

  function drawMap() {
    const dec = new Map(DATA.sct_sites.map((r) => [String(r.id), r.decision]));
    const pts = pick(DATA.submissions).filter((r) => r.lat != null && r.lon != null);
    Object.values(layers).forEach((l) => l.clearLayers());
    for (const p of pts) {
      if (!layers[p.form]) continue;
      const m = L.circleMarker([p.lat, p.lon], { pane: 'points', radius: 8, color: '#fff', weight: 2, fillColor: COLORS[p.form], fillOpacity: 0.95 });
      const box = document.createElement('div');
      const b = document.createElement('b'); b.textContent = p.community || 'Unnamed community'; box.appendChild(b);
      const rows = [['District', p.district], ['Sub-district', p.sub_district], ['Form', p.form], ['Date', p.date], ['Collector', p.interviewer]];
      const d = dec.get(String(p.id)); if (d) rows.push(['SCT decision', d]);
      const inD = districtAt(p.lat, p.lon);
      if (inD && inD !== p.district) rows.push(['⚠ Check GPS', `point lies in ${inD}`]);
      rows.push(['GPS', p.lat.toFixed(5) + ', ' + p.lon.toFixed(5)]);
      for (const [k, v] of rows) { if (!v) continue; const r = document.createElement('div'); r.className = 'pop-row'; r.textContent = `${k}: ${v}`; box.appendChild(r); }
      m.bindPopup(box);
      m.bindTooltip(p.community || p.form, { direction: 'top', offset: [0, -6] });
      m.addTo(layers[p.form]);
    }
    if (boundaryLayer) boundaryLayer.setStyle(districtStyle);
    if (!fitted || districtSel.dataset.changed) {
      let bounds = null;
      const sel = districtSel.value;
      if (boundaryLayer) {
        boundaryLayer.eachLayer((l) => { if (!sel || l.feature.properties.district === sel) bounds = bounds ? bounds.extend(l.getBounds()) : L.latLngBounds(l.getBounds().getSouthWest(), l.getBounds().getNorthEast()); });
      }
      if (!bounds && pts.length) bounds = L.latLngBounds(pts.map((p) => [p.lat, p.lon])).pad(0.4);
      if (bounds) { map.fitBounds(bounds, { maxZoom: 12, padding: [6, 6] }); fitted = true; }
      delete districtSel.dataset.changed;
    }
  }

  // ---------- tables ----------
  function fillTable(sel, rows, cols) {
    const tb = document.querySelector(sel + ' tbody');
    tb.replaceChildren();
    if (!rows.length) { const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = cols.length; td.className = 'empty'; td.textContent = 'No submissions yet for this selection.'; tr.appendChild(td); tb.appendChild(tr); return; }
    for (const r of rows) {
      const tr = document.createElement('tr');
      for (const c of cols) {
        const td = document.createElement('td');
        if (c.num) td.className = 'num';
        const v = c.get ? c.get(r) : r[c.k];
        if (v instanceof Node) td.appendChild(v); else td.textContent = v == null || v === '' ? '—' : v;
        tr.appendChild(td);
      }
      tb.appendChild(tr);
    }
  }
  const pill = (dcs) => { const s = document.createElement('span'); s.className = 'pill ' + (dcs === 'Good' ? 'good' : dcs === 'Inadequate' ? 'bad' : 'mid'); s.textContent = (dcs === 'Good' ? '✓ ' : dcs === 'Inadequate' ? '✕ ' : '● ') + dcs; return s; };

  // ---------- render all ----------
  function render() {
    const k = kpis();
    document.querySelectorAll('[data-kpi]').forEach((el) => {
      const v = k[el.dataset.kpi];
      el.textContent = v == null ? 'n/a' : el.dataset.kpi.endsWith('_pct') ? pctTxt(v) : fmt(v);
    });
    const lede = $('#lede');
    lede.replaceChildren();
    const b = (t) => { const e = document.createElement('b'); e.textContent = t; return e; };
    lede.append(b(fmt(k.submissions)), ' submissions so far from ', b(fmt(k.communities)), ' communities in ', b(fmt(k.districts)), ' district' + (k.districts === 1 ? '' : 's') + '.');
    if (k.coverage_pct != null) lede.append(' Rapid assessments show ', b(pctTxt(k.coverage_pct)), ' of household members treated' + (k.coverage_pct >= TARGET ? ', above' : ', below') + ' the 65% threshold.');

    const s = pick(DATA.submissions);
    hbar($('#chart-forms'), FORMS.map((f) => { const n = s.filter((r) => r.form === f).length; return { label: f, value: n, color: COLORS[f], tip: [[f], ['Submissions:', fmt(n)], ['Share:', s.length ? d3.format('.0%')(n / s.length) : '—']] }; }),
      { fmt, aria: 'Submissions per form' });
    drawDays();

    const byD = d3.rollups(pick(DATA.rapid_hh), (v) => ({ persons: d3.sum(v, (r) => +r.persons || 0), treated: d3.sum(v, (r) => +r.treated || 0), hh: v.length }), (r) => r.district)
      .map(([district, v]) => ({ district, ...v, cov: pct(v.treated, v.persons) })).sort((a, b2) => (b2.cov ?? -1) - (a.cov ?? -1));
    hbar($('#chart-coverage'), byD.map((d) => ({ label: d.district || 'Unknown', value: d.cov, color: d.cov >= TARGET ? '#0ca30c' : '#d03b3b',
      tip: [[d.district], ['Coverage:', pctTxt(d.cov) + (d.cov >= TARGET ? ' ✓ above 65%' : ' ✕ below 65%')], ['Treated:', `${fmt(d.treated)} of ${fmt(d.persons)}`], ['Households:', fmt(d.hh)]] })),
      { fmt: pctTxt, max: 100, ref: TARGET, aria: 'Treatment coverage by district', empty: 'No rapid assessment households for this selection yet.' });

    const counts = d3.rollups(pick(DATA.multi), (v) => v.length, (r) => r.topic, (r) => r.option);
    const topics = counts.map(([t]) => t).sort();
    if (!topics.includes(topic)) topic = topics.includes('Reasons not treated') ? 'Reasons not treated' : topics[0] || null;
    topicSel.replaceChildren(...topics.map((t) => new Option(t, t)));
    if (topic) topicSel.value = topic;
    const opts = (counts.find(([t]) => t === topic) || [null, []])[1].sort((a, b2) => b2[1] - a[1]);
    hbar($('#chart-answers'), opts.map(([o, n]) => ({ label: o, value: n, color: '#2a78d6', tip: [[o], ['Times selected:', fmt(n)], ['Question:', topic]] })),
      { fmt, aria: 'Answer counts', empty: 'No answers yet for this selection.' });

    drawMap();

    fillTable('#table-sct', pick(DATA.sct_sites), [{ k: 'district' }, { k: 'sub_district' }, { k: 'community' }, { k: 'disease' }, { k: 'interviewed', num: 1 }, { k: 'swallowed', num: 1 }, { get: (r) => pill(r.decision) }]);
    const en = d3.rollups(s.filter((r) => r.interviewer), (v) => ({ n: v.length, forms: [...new Set(v.map((r) => r.form))].join(', '), last: d3.max(v, (r) => r.date) }), (r) => r.interviewer)
      .map(([name, v]) => ({ name, ...v })).sort((a, b2) => b2.n - a.n);
    fillTable('#table-enum', en, [{ k: 'name' }, { k: 'n', num: 1 }, { k: 'forms' }, { k: 'last' }]);
    fillTable('#table-monitor', pick(DATA.monitor), [{ k: 'district' }, { k: 'date' }, { k: 'logistics_adequate' }, { get: (r) => fmt(r.ivm_in_stock), num: 1 }, { get: (r) => fmt(r.health_workers_trained), num: 1 }, { get: (r) => fmt(r.cdds_trained), num: 1 }, { k: 'social_mobilization' }, { k: 'data_plan' }, { k: 'dhims_entry' }, { k: 'hard_to_reach' }]);
  }

  // ---------- load ----------
  async function load() {
    const dot = $('#live-dot'), upd = $('#updated'), err = $('#error');
    try {
      const res = await fetch('/api/data', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not load data');
      DATA = body;
      fillDistricts();
      err.hidden = true;
      dot.className = 'dot live';
      upd.textContent = 'Updated ' + d3.timeFormat('%d %b %Y, %H:%M')(new Date(DATA.generated_at));
      render();
    } catch (e) {
      dot.className = 'dot err';
      upd.textContent = 'Update failed';
      err.textContent = 'Could not load the latest data: ' + e.message;
      err.hidden = false;
    }
  }

  initMap();
  districtSel.addEventListener('change', () => { districtSel.dataset.changed = '1'; render(); });
  topicSel.addEventListener('change', () => { topic = topicSel.value; render(); });
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => DATA && render(), 200); });
  load();
  setInterval(load, REFRESH_MS);
})();
