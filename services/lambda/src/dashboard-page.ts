// PLACEHOLDER: the real dashboard design is coming from the team. This page only proves the
// data path end to end; replace DASHBOARD_PAGE with the designed page, which should fetch
// `data${location.search}` relative to this URL and render the DashboardData shape.
export const DASHBOARD_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tari dashboard</title>
<style>
  :root { color-scheme: light dark; --bg:#fcfcfb; --ink:#0b0b0b; --muted:#52514e; --rule:#e1e0d9; }
  @media (prefers-color-scheme: dark) { :root { --bg:#1a1a19; --ink:#f0efec; --muted:#c3c2b7; --rule:#2c2c2a; } }
  body { margin:0; padding:16px; background:var(--bg); color:var(--ink); font:15px/1.45 -apple-system, system-ui, sans-serif; }
  h1 { font-size:20px; margin:0 0 4px; } p { color:var(--muted); margin:0 0 16px; }
  dl { display:grid; grid-template-columns:auto auto; gap:6px 16px; max-width:420px; }
  dt { color:var(--muted); } dd { margin:0; font-weight:600; text-align:right; }
  pre { white-space:pre-wrap; border-top:1px solid var(--rule); padding-top:12px; color:var(--muted); font-size:12px; }
</style></head>
<body><h1 id="org">Loading…</h1><p>Design in progress. Live data below.</p><dl id="kpis"></dl><pre id="raw"></pre>
<script>
fetch('dashboard/data' + location.search).then(r => r.json()).then(d => {
  document.getElementById('org').textContent = d.org.name;
  const k = d.kpis, rows = [['Hours this month', k.hoursThisMonth], ['Hours last month', k.hoursLastMonth],
    ['Value this month', '$' + k.valueThisMonthUsd.toLocaleString()], ['Active volunteers (30d)', k.activeVolunteers30d],
    ['Open spots next 7 days', k.openSpotsNext7d], ['Onboarding', k.onboarding]];
  document.getElementById('kpis').innerHTML = rows.map(([a, b]) => '<dt>' + a + '</dt><dd>' + b + '</dd>').join('');
  document.getElementById('raw').textContent = JSON.stringify(d, null, 2);
}).catch(() => { document.getElementById('org').textContent = 'Could not load data'; });
</script></body></html>`;
