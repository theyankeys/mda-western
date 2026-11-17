// Fetch the 4 MDA Round Two KoboToolbox forms and reshape them for the dashboard.
// Phone numbers are never copied out of Kobo.

const BASE = process.env.KOBO_SERVER || 'https://kf.kobotoolbox.org';

const FORMS = {
  cdd: { uid: 'aw37HbTg8AAMtGyRLeQYBF', name: 'CDD assessment' },
  sct: { uid: 'af7gLktN9JwFUC5rTqPUvH', name: 'WHO SCT' },
  rapid: { uid: 'ahNTXAGnvTEFyHpjjqLw4R', name: 'Rapid assessment' },
  monitor: { uid: 'aZUazJon86R6H4JLLrXVqk', name: 'District monitoring' },
};

async function get(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Token ${token}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Kobo answered ${res.status} for ${url.replace(/\?.*/, '')}`);
  return res.json();
}

async function fetchForm(uid, token) {
  const asset = await get(`${BASE}/api/v2/assets/${uid}/?format=json`, token);
  const rows = [];
  let url = `${BASE}/api/v2/assets/${uid}/data/?format=json&limit=1000`;
  while (url) {
    const page = await get(url, token);
    rows.push(...page.results);
    url = page.next;
  }
  return { asset, rows };
}

function labeller(asset) {
  const lists = {};
  for (const c of asset.content.choices || []) {
    (lists[c.list_name] ||= {})[c.name] = (c.label && c.label[0]) || c.name;
  }
  const byQ = {};
  for (const q of asset.content.survey || []) {
    if (q.select_from_list_name) byQ[q.name] = lists[q.select_from_list_name] || {};
  }
  const lab = (q, code) => (code == null || code === '' ? null : (byQ[q] && byQ[q][code]) || code);
  const labs = (q, codes) => String(codes || '').split(/\s+/).filter(Boolean).map((c) => lab(q, c));
  return { lab, labs };
}

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const gps = (v) => {
  const p = String(v || '').trim().split(/\s+/).map(Number);
  return p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [p[0], p[1]] : [null, null];
};
const day = (r) => (r._submission_time || '').slice(0, 10) || null;

async function buildData(token) {
  const out = { submissions: [], multi: [], cdd: [], rapid_hh: [], sct_sites: [], monitor: [] };
  const addMulti = (form, topic, district, options) => {
    for (const o of options) out.multi.push({ form, topic, district, option: o });
  };

  const fetched = await Promise.all(Object.entries(FORMS).map(async ([key, f]) => [key, f, await fetchForm(f.uid, token)]));

  for (const [key, f, { asset, rows }] of fetched) {
    const { lab, labs } = labeller(asset);
    for (const r of rows) {
      const district = lab('Select_Name_of_District', r.Select_Name_of_District);
      const g = { cdd: r._7_Get_GPS_Location, sct: r.GPS_Location, rapid: r.GPS, monitor: null }[key];
      const [lat, lon] = gps(g);
      const sub = r._5_Name_of_Sub_District || r.Name_of_Sub_district || r.Name_of_Sub_District || null;
      const com = r._6_Name_of_Community || r.Name_of_Community || null;
      const who = (r._1_Name_of_Interviewer || r.Name_of_interviewer || r.Name_of_Interviewer || r.Name_of_supervisor || '').trim() || null;
      out.submissions.push({ id: r._id, form: f.name, district, sub_district: sub, community: com, interviewer: who, date: day(r), lat, lon });

      if (key === 'cdd') {
        out.cdd.push({
          id: r._id, district, community: com,
          trained: lab('Was_Training_done_before_distr', r.Was_Training_done_before_distr),
          social_mobilization: lab('_11_Was_social_mobi_ine_was_distributed', r._11_Was_social_mobi_ine_was_distributed),
          expected_pay: r._10_How_much_will_yo_n_after_distribution || null,
        });
        addMulti(f.name, 'Who trained the CDDs', district, labs('_9_If_Yes_who_did_the_training', r._9_If_Yes_who_did_the_training));
        addMulti(f.name, 'Social mobilization channels (community)', district, labs('hat_social_mobilization_activi', r.hat_social_mobilization_activi));
      } else if (key === 'rapid') {
        const p = 'group_oy3xc50/';
        (r.group_oy3xc50 || []).forEach((h, i) => {
          out.rapid_hh.push({
            id: `${r._id}-${i + 1}`, district, community: com,
            visited: lab('House_visited_by_volunteer', h[p + 'House_visited_by_volunteer']),
            persons: num(h[p + 'Number_of_Persons_living_the_household']),
            treated: num(h[p + 'Number_of_persons_who_were_treated']),
            adults_seen: num(h[p + 'Number_of_adults_seen']),
            adults_aware: num(h[p + 'Number_of_adults_awa_l_of_monitoring_team']),
          });
          addMulti(f.name, 'Reasons not treated', district, labs('Reasons_given_for_persons_who_', h[p + 'Reasons_given_for_persons_who_']).filter((x) => !x.startsWith('N/A')));
          addMulti(f.name, 'Reasons for refusal', district, labs('Reasons_for_Refusal', h[p + 'Reasons_for_Refusal']).filter((x) => x !== 'N/A'));
          addMulti(f.name, 'Sources of information', district, labs('Sources_of_Information', h[p + 'Sources_of_Information']));
        });
      } else if (key === 'sct') {
        const p = 'Interviewing_of_individuals/';
        const people = r.Interviewing_of_individuals || [];
        const offered = people.filter((x) => String(x[p + 'q1'] || '').toLowerCase() === 'yes').length;
        let swallowed = people.filter((x) => String(x[p + 'Q1_001'] || '').toLowerCase() === 'yes').length;
        if (!people.length) swallowed = Math.round(num(r.swallow) || 0);
        const decision = swallowed <= 10 ? 'Inadequate' : swallowed <= 15 ? 'Cannot conclude' : 'Good';
        out.sct_sites.push({
          id: r._id, district, sub_district: sub, community: com,
          disease: lab('Disease_being_assessed', r.Disease_being_assessed),
          interviewed: people.length, offered, swallowed, decision, lat, lon,
        });
        for (const x of people) {
          addMulti(f.name, 'Why not offered', district, labs('If_not_why', x[p + 'If_not_why']));
          addMulti(f.name, 'Why not swallowed', district, labs('If_not_why_001', x[p + 'If_not_why_001']));
        }
      } else if (key === 'monitor') {
        const subs = r.Sub_district_1 || [];
        const cm = subs.reduce((a, s) => a + (num(s['Sub_district_1/Mal']) || 0), 0);
        const cf = subs.reduce((a, s) => a + (num(s['Sub_district_1/Fe']) || 0), 0);
        out.monitor.push({
          id: r._id, district, date: r.Date || day(r),
          logistics_adequate: lab('Have_adequate_logist_tities_from_BIN_Card', r.Have_adequate_logist_tities_from_BIN_Card),
          ivm_in_stock: (num(r.old) || 0) + (num(r.Received) || 0),
          moxidectin_in_stock: (num(r._11_Old_Stock_of_Moxidectin_Tablets) || 0) + (num(r._12_Q_ty_of_Moxidectin_Received) || 0),
          health_workers_trained: num(r.Total_Number_of_health_workers_) || (num(r.Male) || 0) + (num(r.Female) || 0),
          cdds_trained_male: cm, cdds_trained_female: cf, cdds_trained: cm + cf,
          communities: subs.reduce((a, s) => a + (num(s['Sub_district_1/No_of_Communities']) || 0), 0),
          social_mobilization: lab('Have_social_mobilization_been_', r.Have_social_mobilization_been_),
          data_plan: lab('Is_there_a_plan_for_data_management_', r.Is_there_a_plan_for_data_management_),
          dhims_entry: lab('Does_plan_include_en_DA_data_into_DHIMS_2', r.Does_plan_include_en_DA_data_into_DHIMS_2),
          hard_to_reach: lab('Do_you_have_any_diff_within_this_district', r.Do_you_have_any_diff_within_this_district),
        });
        addMulti(f.name, 'District challenges', district, labs('What_challenge_s_do_ope_to_overcome_them', r.What_challenge_s_do_ope_to_overcome_them));
        addMulti(f.name, 'Recommendations for NTDP', district, labs('Do_you_have_Recommendation_for_the_NTDP', r.Do_you_have_Recommendation_for_the_NTDP));
        addMulti(f.name, 'Social mobilization channels (district)', district, labs('What_social_mobilization_activ', r.What_social_mobilization_activ));
      }
    }
  }
  out.generated_at = new Date().toISOString();
  return out;
}


// GET /api/data — live submissions from KoboToolbox.
// The Kobo token stays on the server (Vercel environment variable KOBO_TOKEN);
// the browser only ever sees the reshaped data below.
// Vercel's edge cache keeps a copy for 5 minutes so Kobo isn't hit on every visit.
export default async function handler(req, res) {
  const token = process.env.KOBO_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'KOBO_TOKEN is not set on the server.' });
    return;
  }
  try {
    const data = await buildData(token);
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.status(200).json(data);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String(e.message || e) });
  }
}
