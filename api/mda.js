// GET /api/mda — drug administration figures from the NTDP Oncho/LF MDA app (ntdpgh.org).
// Signs in on the server with NTDP_USERNAME / NTDP_PASSWORD (Vercel environment variables),
// reads the Western Region dashboard and each district's dashboard for the configured year and round,
// and returns only aggregate counts. The login never reaches the browser.
// Vercel's edge cache keeps a copy for 5 minutes, like /api/data.

const API = 'https://ntd.nmepgh.org/api';
const REGION_ID = Number(process.env.NTDP_REGION_ID || 10); // 10 = WESTERN in the MDA app
const ROUND = Number(process.env.NTDP_ROUND || 2);

// MDA app district names -> the names used on this dashboard
const NAME_MAP = {
  'AHANTA WEST': 'Ahanta West', 'ELLEMBELE': 'Ellembelle', 'ELLEMBELLE': 'Ellembelle', 'JOMORO': 'Jomoro',
  'NZEMA EAST': 'Nzema East', 'PRESTEA HUNI VALLEY': 'Prestea-Huni Valley', 'PRESTEA-HUNI VALLEY': 'Prestea-Huni Valley',
  'PRESTEA/HUNI VALLEY': 'Prestea-Huni Valley', 'TARKWA NSUAEM': 'Tarkwa Nsuaem', 'WASSA AMENFI CENTRAL': 'Wassa Amenfi Central',
  'WASSA AMENFI EAST': 'Wassa Amenfi East', 'WASSA AMENFI WEST': 'Wassa Amenfi West', 'WASSA EAST': 'Wassa East',
};
const tidy = (s) => NAME_MAP[String(s || '').toUpperCase().replace(/\s+/g, ' ').trim()] || String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

async function call(path, { token, params, body } = {}) {
  const url = `${API}/${path}${params ? '?' + new URLSearchParams(params) : ''}`;
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`MDA app answered ${res.status} for ${path}`);
  return res.json();
}

function summary(d) {
  const sum = (arr, k) => (Array.isArray(arr) ? arr.reduce((a, r) => a + n(r[k]), 0) : 0);
  return {
    households: n(d.households), registered: n(d.beneficiaries), treated: n(d.total_dosed), not_treated: n(d.total_undosed),
    treated_male: n(d.males_treated), treated_female: n(d.females_treated),
    registered_male: sum(d.registered_gender, 'male'), registered_female: sum(d.registered_gender, 'female'),
    not_treated_male: sum(d.undosed_gender, 'male'), not_treated_female: sum(d.undosed_gender, 'female'),
    ivermectin_used: n(d.ivermectin_used), ivermectin_wasted: n(d.ivermectin_wasted),
    albendazole_used: n(d.albendazole_used), albendazole_wasted: n(d.albendazole_wasted),
    moxidectin_used: n(d.moxydectin_used), moxidectin_wasted: n(d.moxydectin_wasted),
    height: (d.height || []).map((h) => ({ group: h.height, people: n(h.y) })),
    clinical: (d.clinical || []).map((c) => ({ condition: c.state, people: n(c.y) })),
  };
}
function add(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b)) if (typeof b[k] === 'number') out[k] = (a[k] || 0) + b[k];
  const merge = (x, y, key) => { const m = new Map(); [...(x || []), ...(y || [])].forEach((r) => m.set(r[key], (m.get(r[key]) || 0) + r.people)); return [...m].map(([k, v]) => ({ [key]: k, people: v })); };
  out.height = merge(a.height, b.height, 'group');
  out.clinical = merge(a.clinical, b.clinical, 'condition');
  return out;
}

export default async function handler(req, res) {
  const user = process.env.NTDP_USERNAME, pass = process.env.NTDP_PASSWORD;
  if (!user || !pass) { res.setHeader('Cache-Control', 'no-store'); res.status(503).json({ error: 'The MDA app login (NTDP_USERNAME / NTDP_PASSWORD) is not set on the server yet.' }); return; }
  try {
    const login = await call('login', { body: { username: user, password: pass } });
    if (!login.access_token) throw new Error(login.error || 'MDA app sign-in failed');
    const token = login.access_token;
    const years = await call('web/get-years', { token });
    const year = Number(process.env.NTDP_YEAR || Math.max(...years.map(Number)));
    const [region, districts] = await Promise.all([
      call('web/national-dashboard', { token, params: { region_ids: REGION_ID, year, round: ROUND } }),
      call('mobile/get-districts', { token, params: { region_id: REGION_ID } }),
    ]);
    const per = await Promise.all(districts.map(async (d) => ({ name: tidy(d.district), s: summary(await call('web/national-dashboard', { token, params: { district_ids: d.id, year, round: ROUND } })) })));
    const byName = new Map();
    for (const { name, s } of per) byName.set(name, byName.has(name) ? add(byName.get(name), s) : s); // the app lists some districts twice
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.status(200).json({
      source: 'NTDP Oncho/LF MDA app (ntdpgh.org)', region: 'Western', year, round: ROUND,
      generated_at: new Date().toISOString(),
      totals: summary(region),
      districts: [...byName].map(([district, s]) => ({ district, ...s })).sort((a, b) => b.registered - a.registered),
    });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String(e.message || e) });
  }
}
