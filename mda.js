/* Drug administration section — figures from the NTDP Oncho/LF MDA app via /api/mda.
   Redraws whenever the main dashboard redraws (district filter), and reloads every 5 minutes. */
(() => {
  const REFRESH_MS = 5 * 60 * 1000;
  const TREATED = '#14857a', REGISTERED = '#e3e6ea', NOT_TREATED = '#d97750';
  const fmt = d3.format(',');
  const pct = (a, b) => (b > 0 ? (100 * a) / b : null);
  const pctTxt = (v) => (v == null ? '—' : `${v.toFixed(1)}%`);
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fD = $('#f-district');
  let MDA = null, NAMES = [];

  // shared tooltip element from the main dashboard
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

  const fS = $('#mda-district');
  // Districts that use the MDA app = districts with people registered in it
  const participating = () => (MDA ? MDA.districts.filter((d) => d.registered > 0).sort((a, b) => a.district.localeCompare(b.district)) : []);
  const listNames = (arr) => (arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`);
  // The top filter wins; the section's own filter applies only when the top filter is "All districts".
  function scope() {
    const P = participating();
    if (fD.value) {
      const d = P.find((x) => x.district === fD.value);
      return d ? { kind: 'district', d, locked: true } : { kind: 'outside', name: fD.value, locked: true };
    }
    if (fS.value) { const d = P.find((x) => x.district === fS.value); if (d) return { kind: 'district', d, locked: false }; }
    return { kind: 'all', locked: false };
  }
  const selected = () => {
    const sc = scope();
    if (sc.kind === 'outside') return null;
    if (sc.kind === 'district') return { label: sc.d.district, ...sc.d };
    return { label: 'All MDA app districts', ...MDA.totals };
  };
  function syncSectionFilter() {
    const P = participating(), cur = fS.value;
    fS.replaceChildren(new Option(`All ${P.length} MDA app districts`, ''), ...P.map((d) => new Option(d.district, d.district)));
    const sc = scope();
    if (sc.locked) { fS.value = sc.kind === 'district' ? sc.d.district : ''; fS.disabled = true; fS.title = 'Set by the district filter at the top of the page'; }
    else { fS.disabled = false; fS.title = ''; fS.value = P.some((d) => d.district === cur) ? cur : ''; }
  }

  // ---------------- KPIs ----------------
  function drawKpis(s) {
    const set = (k, v) => $$(`[data-m="${k}"]`).forEach((e) => { e.textContent = v; });
    if (!s) { ['treated', 'registered', 'not_treated', 'ivermectin'].forEach((k) => set(k, '—')); ['treated_ctx', 'registered_ctx', 'not_treated_ctx', 'ivermectin_ctx'].forEach((k) => set(k, '')); $$('[data-m-bar]').forEach((b) => { b.style.width = '0'; }); return; }
    const cov = pct(s.treated, s.registered);
    set('treated', fmt(s.treated));
    set('treated_ctx', cov == null ? 'No one registered yet' : `${pctTxt(cov)} of people registered`);
    $$('[data-m-bar="treated"]').forEach((b) => { b.style.width = (cov || 0) + '%'; });
    set('registered', fmt(s.registered));
    set('registered_ctx', `in ${fmt(s.households)} households`);
    set('not_treated', fmt(s.not_treated));
    set('not_treated_ctx', s.registered ? `${pctTxt(pct(s.not_treated, s.registered))} · ${fmt(s.not_treated_male)} male, ${fmt(s.not_treated_female)} female` : '—');
    set('ivermectin', fmt(s.ivermectin_used));
    set('ivermectin_ctx', `${fmt(s.ivermectin_wasted)} wasted${s.moxidectin_used ? ` · Moxidectin: ${fmt(s.moxidectin_used)} used` : ''}`);
  }

  // ---------------- treated vs registered by district ----------------
  function drawDistricts() {
    const node = $('#mda-districts'); node.replaceChildren();
    const sc = scope(), active = sc.kind === 'district' ? sc.d.district : '';
    const rows = participating().map((d) => ({ district: d.district, d })).sort((a, b) => b.d.registered - a.d.registered);
    if (!rows.length) { node.appendChild(el('p', 'empty', 'No district has synced data to the MDA app yet.')); return; }
    const W = Math.max(280, node.clientWidth), rowH = 46, barH = 18, H = rows.length * rowH;
    const svg = d3.select(node).append('svg').attr('width', W).attr('height', H).attr('role', 'img').attr('aria-label', 'People treated and registered per district');
    const probe = svg.append('g');
    const left = Math.min(d3.max(rows, (r) => probe.append('text').attr('class', 'dname').text(r.district).node().getComputedTextLength()) + 14, W * 0.38);
    const right = Math.min(probe.append('text').attr('class', 'val').text('88,888 of 88,888 · 100.0%').node().getComputedTextLength() + 12, W * 0.42);
    probe.remove();
    const max = d3.max(rows, (r) => (r.d ? r.d.registered : 0)) || 1;
    const x = d3.scaleLinear().domain([0, max]).range([0, W - left - right]);
    const g = svg.selectAll('g').data(rows).join('g').attr('class', (r) => 'row' + (r.district === active ? ' sel' : '')).attr('transform', (r, i) => `translate(0,${i * rowH})`);
    g.append('rect').attr('class', 'bg').attr('width', W).attr('height', rowH).attr('rx', 6).attr('fill', 'transparent');
    g.append('text').attr('class', 'dname').attr('x', left - 10).attr('y', rowH / 2).attr('dy', '.35em').attr('text-anchor', 'end').text((r) => r.district)
      .each(function () { const t = d3.select(this); let s = t.text(); while (this.getComputedTextLength() > left - 14 && s.length > 3) { s = s.slice(0, -2); t.text(s + '…'); } });
    g.each(function (r) {
      const gg = d3.select(this), y = (rowH - barH) / 2;
      if (!r.d || !r.d.registered) {
        gg.append('rect').attr('x', left).attr('y', y).attr('width', W - left - right).attr('height', barH).attr('rx', 4).attr('fill', '#f4f5f7');
        gg.append('text').attr('class', 'muted').attr('x', left + 8).attr('y', rowH / 2).attr('dy', '.35em').text(r.d ? 'No data synced yet' : 'Not in the MDA app');
        return;
      }
      const reg = x(r.d.registered), tr = x(r.d.treated), cov = pct(r.d.treated, r.d.registered);
      gg.append('rect').attr('x', left).attr('y', y).attr('width', Math.max(2, reg)).attr('height', barH).attr('rx', 4).attr('fill', REGISTERED);
      gg.append('rect').attr('x', left).attr('y', y).attr('width', Math.max(2, tr)).attr('height', barH).attr('rx', 4).attr('fill', TREATED);
      const t = gg.append('text').attr('x', left + reg + 8).attr('y', rowH / 2).attr('dy', '.35em');
      t.append('tspan').attr('class', 'val').text(fmt(r.d.treated));
      t.append('tspan').attr('class', 'muted').text(` of ${fmt(r.d.registered)} · ${pctTxt(cov)}`);
    });
    g.append('rect').attr('width', W).attr('height', rowH).attr('fill', 'transparent').style('cursor', 'pointer')
      .on('mousemove', (e, r) => tip.show(e, r.district, r.d && r.d.registered ? [`Treated: ${fmt(r.d.treated)} (${pctTxt(pct(r.d.treated, r.d.registered))})`, `Registered: ${fmt(r.d.registered)}`, `Not treated: ${fmt(r.d.not_treated)}`, `Households: ${fmt(r.d.households)}`, fD.value ? null : 'Tap to focus this section on it'] : []))
      .on('mouseleave', tip.hide)
      .on('click', (e, r) => { if (fD.value) return; fS.value = fS.value === r.district ? '' : r.district; render(); });
  }

  // ---------------- by sex ----------------
  function drawSex(s) {
    const node = $('#mda-sex'); node.replaceChildren();
    if (!s || !s.registered) { node.appendChild(el('p', 'empty', 'No MDA app figures for this selection yet.')); return; }
    const rows = [
      { label: 'Female', treated: s.treated_female, registered: s.registered_female, not: s.not_treated_female },
      { label: 'Male', treated: s.treated_male, registered: s.registered_male, not: s.not_treated_male },
    ];
    const W = Math.max(240, node.clientWidth), rowH = 64, barH = 18, H = rows.length * rowH + 30;
    const svg = d3.select(node).append('svg').attr('width', W).attr('height', H).attr('role', 'img').attr('aria-label', 'Treated and registered by sex');
    const max = d3.max(rows, (r) => r.registered) || 1;
    const x = d3.scaleLinear().domain([0, max]).range([0, W - 4]);
    rows.forEach((r, i) => {
      const y0 = i * rowH;
      const head = svg.append('text').attr('x', 0).attr('y', y0 + 14);
      head.append('tspan').attr('class', 'dname').text(r.label + '  ');
      head.append('tspan').attr('class', 'val').text(fmt(r.treated));
      head.append('tspan').attr('class', 'muted').text(` of ${fmt(r.registered)} treated · ${pctTxt(pct(r.treated, r.registered))}`);
      svg.append('rect').attr('x', 0).attr('y', y0 + 24).attr('width', Math.max(2, x(r.registered))).attr('height', barH).attr('rx', 4).attr('fill', REGISTERED);
      svg.append('rect').attr('x', 0).attr('y', y0 + 24).attr('width', Math.max(2, x(r.treated))).attr('height', barH).attr('rx', 4).attr('fill', TREATED);
      svg.append('rect').attr('x', 0).attr('y', y0).attr('width', W).attr('height', rowH).attr('fill', 'transparent')
        .on('mousemove', (e) => tip.show(e, r.label, [`Treated: ${fmt(r.treated)}`, `Registered: ${fmt(r.registered)}`, `Not treated: ${fmt(r.not)}`])).on('mouseleave', tip.hide);
    });
    const share = pct(s.registered_female, s.registered);
    svg.append('text').attr('class', 'muted').attr('x', 0).attr('y', rows.length * rowH + 14).text(`Women and girls are ${pctTxt(share)} of people registered.`);
  }

  // ---------------- simple bars (height, clinical) ----------------
  function bars(node, rows, color, aria, empty) {
    node.replaceChildren();
    if (!rows.length || !d3.sum(rows, (r) => r.value)) { node.appendChild(el('p', 'empty', empty)); return; }
    const total = d3.sum(rows, (r) => r.value);
    const W = Math.max(240, node.clientWidth), rowH = 32, barH = 16, H = rows.length * rowH;
    const svg = d3.select(node).append('svg').attr('width', W).attr('height', H).attr('role', 'img').attr('aria-label', aria);
    const probe = svg.append('g');
    const left = d3.max(rows, (r) => probe.append('text').attr('class', 'dname').text(r.label).node().getComputedTextLength()) + 14;
    const right = d3.max(rows, (r) => probe.append('text').attr('class', 'val').text(`${fmt(r.value)} · ${pctTxt(pct(r.value, r.base || total))}`).node().getComputedTextLength()) + 12;
    probe.remove();
    const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.value) || 1]).range([0, W - left - right]);
    const g = svg.selectAll('g').data(rows).join('g').attr('transform', (r, i) => `translate(0,${i * rowH})`);
    g.append('text').attr('class', 'dname').attr('x', left - 10).attr('y', rowH / 2).attr('dy', '.35em').attr('text-anchor', 'end').text((r) => r.label);
    g.append('rect').attr('x', left).attr('y', (rowH - barH) / 2).attr('width', (r) => Math.max(2, x(r.value))).attr('height', barH).attr('rx', 4).attr('fill', color);
    const t = g.append('text').attr('x', (r) => left + x(r.value) + 8).attr('y', rowH / 2).attr('dy', '.35em');
    t.append('tspan').attr('class', 'val').text((r) => fmt(r.value));
    t.append('tspan').attr('class', 'muted').text((r) => ` · ${pctTxt(pct(r.value, r.base || total))}`);
    g.append('rect').attr('width', W).attr('height', rowH).attr('fill', 'transparent')
      .on('mousemove', (e, r) => tip.show(e, r.label, [`${fmt(r.value)} people`, `${pctTxt(pct(r.value, r.base || total))} of ${r.base ? 'people registered' : 'all in this chart'}`])).on('mouseleave', tip.hide);
  }
  function drawHeight(s) {
    const order = ['<90', '90-119', '120-140', '141-158', 'above 158'];
    const label = { '<90': 'Under 90', '90-119': '90–119', '120-140': '120–140', '141-158': '141–158', 'above 158': 'Above 158' };
    const rows = s ? order.map((k) => ({ label: label[k], value: (s.height.find((h) => h.group === k) || {}).people || 0 })) : [];
    s && s.height.filter((h) => !order.includes(h.group)).forEach((h) => rows.push({ label: h.group, value: h.people }));
    bars($('#mda-height'), rows, '#4a78b5', 'People registered by height group', 'No MDA app figures for this selection yet.');
  }
  function drawClinical(s) {
    const none = s ? (s.clinical.find((c) => c.condition === 'NONE') || {}).people || 0 : 0;
    const nice = (c) => c.charAt(0) + c.slice(1).toLowerCase().replace('elephnatiasis', 'elephantiasis').replace('hydrocelle', 'hydrocele');
    const rows = s ? s.clinical.filter((c) => c.condition !== 'NONE').map((c) => ({ label: nice(c.condition), value: c.people, base: s.registered })).sort((a, b) => b.value - a.value) : [];
    $('#mda-clinical-sub').textContent = s && s.registered ? `People registered with a recorded condition · ${fmt(none)} had none` : 'People registered with a recorded condition';
    bars($('#mda-clinical'), rows, '#b5647a', 'Clinical conditions recorded', 'No conditions recorded for this selection.');
  }

  // ---------------- drugs table ----------------
  function drawDrugs() {
    const tb = $('#mda-drugs tbody'); tb.replaceChildren();
    const sc = scope();
    const rows = sc.kind === 'district' ? [sc.d] : sc.kind === 'all' ? participating().sort((a, b) => b.registered - a.registered) : [];
    const cell = (v, cls = 'r') => el('td', cls + (v ? '' : ' z'), v ? fmt(v) : '—');
    if (!rows.length) { const tr = el('tr'); const td = el('td', 'empty', 'No MDA app figures for this selection.'); td.colSpan = 8; tr.appendChild(td); tb.appendChild(tr); return; }
    for (const d of rows) {
      const tr = el('tr');
      tr.append(el('td', 'b', d.district), cell(d.households), cell(d.ivermectin_used), cell(d.ivermectin_wasted), cell(d.moxidectin_used), cell(d.moxidectin_wasted), cell(d.albendazole_used), cell(d.albendazole_wasted));
      tb.appendChild(tr);
    }
    if (sc.kind === 'all') {
      const t = MDA.totals, tr = el('tr', 'total');
      tr.append(el('td', 'b', 'All districts'), cell(t.households, 'r b'), cell(t.ivermectin_used, 'r b'), cell(t.ivermectin_wasted, 'r b'), cell(t.moxidectin_used, 'r b'), cell(t.moxidectin_wasted, 'r b'), cell(t.albendazole_used, 'r b'), cell(t.albendazole_wasted, 'r b'));
      tb.appendChild(tr);
    }
  }

  function csv() {
    const cols = ['district', 'households', 'registered', 'treated', 'not_treated', 'registered_male', 'registered_female', 'treated_male', 'treated_female', 'ivermectin_used', 'ivermectin_wasted', 'moxidectin_used', 'moxidectin_wasted', 'albendazole_used', 'albendazole_wasted'];
    const lines = [cols.join(','), ...participating().map((d) => cols.map((c) => (c === 'district' ? `"${d[c]}"` : d[c])).join(',')), ['"All districts"', ...cols.slice(1).map((c) => MDA.totals[c])].join(',')];
    const a = el('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = `mda-app-round${MDA.round}-${MDA.year}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------------- render / load ----------------
  function render() {
    if (!MDA || !NAMES.length) return;
    syncSectionFilter();
    const P = participating(), sc = scope(), s = selected();
    const where = sc.kind === 'district' ? sc.d.district : sc.kind === 'outside' ? sc.name : `${P.length} MDA app districts`;
    $('#mda-sub').textContent = `Oncho/LF MDA Round ${MDA.round}, ${MDA.year} · ${where} · updated ${d3.timeFormat('%d %b %Y, %H:%M')(new Date(MDA.generated_at))}`;
    $('#mda-note').textContent = `These figures cover the ${P.length} district${P.length === 1 ? '' : 's'} using the NTDP MDA app: ${listNames(P.map((d) => d.district))}. Cumulative to date.`
      + (sc.locked ? ' Set to the district chosen at the top of the page.' : ' Use this section’s own district box to look at one of them; it changes this section only.');
    const out = sc.kind === 'outside';
    $('#mda-error').hidden = !out;
    if (out) $('#mda-error').textContent = `${sc.name} does not use the NTDP MDA app, so there are no drug administration figures for it. Choose one of ${listNames(P.map((d) => d.district))} at the top, or clear the top filter to see all ${P.length}.`;
    $('#mda-kpis').hidden = out;
    $('#mda-grid').hidden = out;
    if (out) return;
    drawKpis(s && s.registered ? s : null);
    drawDistricts();
    drawSex(s);
    drawHeight(s && s.registered ? s : null);
    drawClinical(s && s.registered ? s : null);
    drawDrugs();
  }
  async function load() {
    try {
      const res = await fetch('/api/mda', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not load the MDA app figures');
      MDA = body;
      render();
    } catch (e) {
      if (!MDA) { $('#mda-sub').textContent = 'Could not load figures from the MDA app.'; $('#mda-error').hidden = false; $('#mda-error').textContent = e.message; }
    }
  }

  fetch('districts.geojson').then((r) => r.json()).then((gj) => { NAMES = gj.features.map((f) => f.properties.district).sort(); render(); }).catch(() => {});
  document.addEventListener('dash:render', render);
  fD.addEventListener('change', render);
  fS.addEventListener('change', render);
  $('#mda-csv').addEventListener('click', () => MDA && csv());
  let rt, lastW = innerWidth;
  addEventListener('resize', () => { if (innerWidth === lastW) return; lastW = innerWidth; clearTimeout(rt); rt = setTimeout(render, 220); });
  load();
  setInterval(load, REFRESH_MS);
})();
