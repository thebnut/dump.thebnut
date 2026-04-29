#!/usr/bin/env node
// Fetches SonarQube data and bakes it into dumpthebnut-quality-dashboard.html.
// Requires SONAR_TOKEN env var (User Token, prefix squ_, with Browse permission on the project).

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SONAR_URL = process.env.SONAR_URL ?? 'http://localhost:9000';
const PROJECT_KEY = process.env.SONAR_PROJECT ?? 'DumpThebnut';
const PROJECT_NAME = 'dump.thebnut';
const TOKEN = process.env.SONAR_TOKEN;
const OUT_PATH = resolve(process.cwd(), 'dumpthebnut-quality-dashboard.html');

if (!TOKEN) {
  console.error('SONAR_TOKEN not set. Generate a User Token at ' + SONAR_URL + '/account/security and export it:');
  console.error('  export SONAR_TOKEN=squ_xxxxxxxx');
  process.exit(1);
}

const AUTH = 'Basic ' + Buffer.from(`${TOKEN}:`).toString('base64');

async function sonar(path) {
  const url = `${SONAR_URL}${path}`;
  const res = await fetch(url, { headers: { Authorization: AUTH, Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sonar ${res.status} on ${path}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchAllPages(buildPath, key, max = 5000) {
  const out = [];
  let page = 1;
  while (out.length < max) {
    const data = await sonar(buildPath(page));
    const items = data[key] ?? [];
    out.push(...items);
    const total = data.paging?.total ?? data.total ?? items.length;
    const ps = data.paging?.pageSize ?? data.ps ?? items.length;
    if (out.length >= total || items.length === 0) break;
    if (out.length >= ps * page) page += 1; else break;
  }
  return out;
}

const RATING_LETTER = { '1.0': 'A', '2.0': 'B', '3.0': 'C', '4.0': 'D', '5.0': 'E' };
const RATING_COLOUR = { A: '#16a34a', B: '#65a30d', C: '#ca8a04', D: '#ea580c', E: '#dc2626' };
const SEV_COLOUR = { BLOCKER: '#7f1d1d', CRITICAL: '#dc2626', MAJOR: '#ea580c', MINOR: '#ca8a04', INFO: '#6b7280' };
const PROB_COLOUR = { HIGH: '#dc2626', MEDIUM: '#ea580c', LOW: '#ca8a04' };

function fmtBigNum(n) {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (!Number.isFinite(v)) return '—';
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 10_000) return Math.round(v / 1000) + 'k';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
  return String(Math.round(v));
}

function effortToMin(e) {
  if (!e) return 0;
  let total = 0;
  const d = e.match(/(\d+)d/);
  const h = e.match(/(\d+)h/);
  const m = e.match(/(\d+)min/);
  if (d) total += parseInt(d[1], 10) * 8 * 60;
  if (h) total += parseInt(h[1], 10) * 60;
  if (m) total += parseInt(m[1], 10);
  return total;
}

function fmtEffort(min) {
  if (!min) return '—';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  if (h < 8) return rem ? `${h}h ${rem}m` : `${h}h`;
  const days = Math.floor(h / 8);
  const remH = h % 8;
  return remH ? `${days}d ${remH}h` : `${days}d`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function relPath(component) {
  return component.includes(':') ? component.split(':').slice(1).join(':') : component;
}

function moduleOf(path) {
  const seg = path.split('/')[0];
  return seg || '(root)';
}

function pickMeasure(measures, key) {
  const m = measures.find((x) => x.metric === key);
  return m?.value ?? m?.period?.value ?? null;
}

async function main() {
  console.log(`Fetching Sonar data from ${SONAR_URL} (project: ${PROJECT_KEY})...`);

  const [measuresRes, analysesRes, bugIssues, allIssuesFacets, hotspots] = await Promise.all([
    sonar(`/api/measures/component?component=${PROJECT_KEY}&metricKeys=bugs,vulnerabilities,security_hotspots,code_smells,coverage,duplicated_lines_density,ncloc,reliability_rating,security_rating,sqale_rating,security_review_rating`),
    sonar(`/api/project_analyses/search?project=${PROJECT_KEY}&ps=1`),
    fetchAllPages(
      (p) => `/api/issues/search?componentKeys=${PROJECT_KEY}&types=BUG&resolved=false&ps=500&p=${p}&facets=severities,rules,files`,
      'issues',
    ),
    sonar(`/api/issues/search?componentKeys=${PROJECT_KEY}&resolved=false&ps=1&facets=rules,severities,types`),
    fetchAllPages(
      (p) => `/api/hotspots/search?projectKey=${PROJECT_KEY}&status=TO_REVIEW&ps=500&p=${p}`,
      'hotspots',
    ),
  ]);

  const bugFacets = await sonar(
    `/api/issues/search?componentKeys=${PROJECT_KEY}&types=BUG&resolved=false&ps=1&facets=severities,rules`,
  );

  const measures = measuresRes.component.measures;
  const analysisDate = analysesRes.analyses?.[0]?.date ?? null;
  const qualityGate = analysesRes.analyses?.[0]?.events?.find((e) => e.category === 'QUALITY_GATE');

  const allRulesFacet = (allIssuesFacets.facets ?? []).find((f) => f.property === 'rules')?.values ?? [];
  const topRules = allRulesFacet.slice(0, 10);

  const ruleDetails = await Promise.all(
    topRules.map((r) => sonar(`/api/rules/show?key=${encodeURIComponent(r.val)}`).catch(() => null)),
  );

  const topRulesEnriched = topRules.map((r, i) => {
    const detail = ruleDetails[i]?.rule ?? {};
    const perIssueMin = effortToMin(detail.remFnBaseEffort ?? detail.defaultRemFnBaseEffort ?? '');
    const totalEffortMin = perIssueMin * r.count;
    return {
      key: r.val,
      count: r.count,
      name: detail.name ?? r.val,
      severity: detail.severity ?? '—',
      type: detail.type ?? '—',
      lang: detail.langName ?? detail.lang ?? '—',
      effortPerIssueMin: perIssueMin,
      totalEffortMin,
    };
  });

  const sevFacet = (bugFacets.facets ?? []).find((f) => f.property === 'severities')?.values ?? [];
  const SEV_ORDER = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'];
  const bugsBySeverity = SEV_ORDER.map((sev) => ({
    severity: sev,
    count: sevFacet.find((s) => s.val === sev)?.count ?? 0,
  }));

  const bugsByModule = {};
  const bugsByFile = {};
  for (const b of bugIssues) {
    const path = relPath(b.component);
    const mod = moduleOf(path);
    bugsByModule[mod] = (bugsByModule[mod] ?? 0) + 1;
    if (!bugsByFile[path]) bugsByFile[path] = { count: 0, rules: {} };
    bugsByFile[path].count += 1;
    bugsByFile[path].rules[b.rule] = (bugsByFile[path].rules[b.rule] ?? 0) + 1;
  }
  const bugModuleArr = Object.entries(bugsByModule)
    .map(([mod, count]) => ({ mod, count }))
    .sort((a, b) => b.count - a.count);
  const worstFiles = Object.entries(bugsByFile)
    .map(([path, { count, rules }]) => {
      const dom = Object.entries(rules).sort((a, b) => b[1] - a[1])[0];
      return { path, count, dominantRule: dom ? dom[0] : '—' };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const hotspotsByCat = {};
  for (const h of hotspots) {
    const k = `${h.securityCategory}|${h.vulnerabilityProbability}`;
    hotspotsByCat[k] = (hotspotsByCat[k] ?? 0) + 1;
  }
  const hotspotCatArr = Object.entries(hotspotsByCat)
    .map(([k, count]) => {
      const [category, probability] = k.split('|');
      return { category, probability, count };
    })
    .sort((a, b) => b.count - a.count);

  const hotspotRows = hotspots
    .slice()
    .sort((a, b) => {
      const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return (order[a.vulnerabilityProbability] ?? 9) - (order[b.vulnerabilityProbability] ?? 9);
    });

  const html = renderHtml({
    measures,
    analysisDate,
    qualityGate,
    bugsTotal: bugIssues.length,
    bugsBySeverity,
    bugModuleArr,
    worstFiles,
    topRulesEnriched,
    hotspotCatArr,
    hotspotRows,
  });

  writeFileSync(OUT_PATH, html, 'utf8');
  console.log(`Wrote ${OUT_PATH} (${(html.length / 1024).toFixed(1)} KB)`);
  console.log('\nSummary:');
  console.log(`  LOC: ${pickMeasure(measures, 'ncloc')}`);
  console.log(`  Bugs: ${pickMeasure(measures, 'bugs')}`);
  console.log(`  Code smells: ${pickMeasure(measures, 'code_smells')}`);
  console.log(`  Hotspots: ${pickMeasure(measures, 'security_hotspots')}`);
  console.log(`  Coverage: ${pickMeasure(measures, 'coverage')}%`);
  console.log(`  Last analysis: ${analysisDate}`);
  console.log(`  Quality gate: ${qualityGate?.name ?? 'unknown'}`);
}

function renderHtml(d) {
  const m = d.measures;
  const ratings = {
    Security: RATING_LETTER[pickMeasure(m, 'security_rating')] ?? '—',
    Reliability: RATING_LETTER[pickMeasure(m, 'reliability_rating')] ?? '—',
    Maintainability: RATING_LETTER[pickMeasure(m, 'sqale_rating')] ?? '—',
    Hotspots: RATING_LETTER[pickMeasure(m, 'security_review_rating')] ?? '—',
    Coverage: coverageBand(parseFloat(pickMeasure(m, 'coverage') ?? '0')),
  };

  const ncloc = pickMeasure(m, 'ncloc') ?? '0';
  const bugs = pickMeasure(m, 'bugs') ?? '0';
  const hotspots = pickMeasure(m, 'security_hotspots') ?? '0';
  const coverage = pickMeasure(m, 'coverage') ?? '0';
  const codeSmells = pickMeasure(m, 'code_smells') ?? '0';
  const dup = pickMeasure(m, 'duplicated_lines_density') ?? '0';
  const vulns = pickMeasure(m, 'vulnerabilities') ?? '0';

  const dateStr = d.analysisDate
    ? new Date(d.analysisDate).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : 'unknown';
  const generated = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  const maxBugSev = Math.max(1, ...d.bugsBySeverity.map((x) => x.count));
  const maxModule = Math.max(1, ...d.bugModuleArr.map((x) => x.count));

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(PROJECT_NAME)} Code Quality Baseline</title>
<style>
  :root {
    --bg: #ffffff;
    --fg: #0a0a0a;
    --muted: #6b7280;
    --border: #e5e7eb;
    --subtle: #f9fafb;
    --accent: #0a0a0a;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
    color: var(--fg);
    background: var(--bg);
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .wrap {
    max-width: 1200px;
    margin: 0 auto;
    padding: 48px 32px 64px;
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 24px;
  }
  .col-12 { grid-column: span 12; }
  .col-6  { grid-column: span 6; }
  .col-4  { grid-column: span 4; }
  .col-3  { grid-column: span 3; }
  @media (max-width: 800px) {
    .col-6, .col-4, .col-3 { grid-column: span 12; }
  }

  h1 { font-size: 28px; font-weight: 600; margin: 0 0 4px; letter-spacing: -0.02em; }
  h2 { font-size: 18px; font-weight: 600; margin: 0 0 16px; letter-spacing: -0.01em; }
  .lede { color: var(--muted); margin: 0; font-size: 14px; }

  .badges { display: flex; gap: 12px; flex-wrap: wrap; }
  .badge {
    display: flex; align-items: center; gap: 8px;
    padding: 12px 16px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #fff;
    flex: 1 1 180px;
    min-width: 0;
  }
  .badge-letter {
    width: 36px; height: 36px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 6px;
    color: #fff; font-weight: 700; font-size: 18px;
    flex-shrink: 0;
  }
  .badge-meta { min-width: 0; }
  .badge-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .badge-name  { font-size: 14px; font-weight: 500; }

  .tile {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 24px;
    background: #fff;
  }
  .tile-num { font-size: 40px; font-weight: 600; letter-spacing: -0.02em; line-height: 1; }
  .tile-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 12px; }
  .tile-cap { font-size: 13px; color: var(--muted); margin-top: 12px; }

  .panel {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 24px;
    background: #fff;
  }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { font-weight: 600; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  tr:last-child td { border-bottom: none; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.mono, .mono { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12px; }

  .pill {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    color: #fff;
  }

  .bar-row { display: grid; grid-template-columns: 110px 1fr 60px; gap: 12px; align-items: center; padding: 6px 0; }
  .bar-label { font-size: 13px; }
  .bar-track { height: 16px; background: var(--subtle); border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; }
  .bar-count { text-align: right; font-variant-numeric: tabular-nums; font-size: 13px; color: var(--muted); }

  .footer {
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 12px;
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
  }

  .next-steps {
    background: var(--subtle);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px 24px;
  }
  .next-steps h3 { font-size: 14px; font-weight: 600; margin: 0 0 8px; }
  .next-steps ol { margin: 0; padding-left: 20px; color: var(--fg); }
  .next-steps li { margin: 4px 0; font-size: 13px; }

  .qg-pass { color: #16a34a; }
  .qg-fail { color: #dc2626; }

  .note {
    background: #fef3c7;
    border: 1px solid #fde68a;
    border-radius: 6px;
    padding: 10px 14px;
    font-size: 13px;
    color: #78350f;
    margin-bottom: 16px;
  }

  .empty { color: var(--muted); font-style: italic; padding: 16px 0; }
</style>
</head>
<body>
<div class="wrap">

  <header class="col-12">
    <h1>${escapeHtml(PROJECT_NAME)} Code Quality Baseline</h1>
    <p class="lede">
      Last analysed ${escapeHtml(dateStr)} &middot; ${fmtBigNum(ncloc)} lines of code &middot;
      Quality gate: <span class="${d.qualityGate?.name === 'Passed' ? 'qg-pass' : 'qg-fail'}">${escapeHtml(d.qualityGate?.name ?? 'unknown')}</span>
      ${d.qualityGate?.description ? '&middot; ' + escapeHtml(d.qualityGate.description) : ''}
    </p>
  </header>

  <div class="col-12 badges">
    ${Object.entries(ratings).map(([name, letter]) => `
      <div class="badge">
        <div class="badge-letter" style="background:${RATING_COLOUR[letter] ?? '#6b7280'}">${letter}</div>
        <div class="badge-meta">
          <div class="badge-label">${escapeHtml(name)}</div>
          <div class="badge-name">${ratingDescription(name, letter)}</div>
        </div>
      </div>
    `).join('')}
  </div>

  <div class="col-3 tile">
    <div class="tile-label">Reliability bugs</div>
    <div class="tile-num">${fmtBigNum(bugs)}</div>
    <div class="tile-cap">Open issues that may cause incorrect behaviour at runtime.</div>
  </div>
  <div class="col-3 tile">
    <div class="tile-label">Hotspots to review</div>
    <div class="tile-num">${fmtBigNum(hotspots)}</div>
    <div class="tile-cap">Need human review — not all are real vulnerabilities.</div>
  </div>
  <div class="col-3 tile">
    <div class="tile-label">Test coverage</div>
    <div class="tile-num">${parseFloat(coverage).toFixed(1)}%</div>
    <div class="tile-cap">Run tests with --coverage and rescan to populate.</div>
  </div>
  <div class="col-3 tile">
    <div class="tile-label">Lines of code</div>
    <div class="tile-num">${fmtBigNum(ncloc)}</div>
    <div class="tile-cap">${parseFloat(dup).toFixed(1)}% duplicated &middot; ${fmtBigNum(codeSmells)} code smells &middot; ${vulns} vulnerabilities.</div>
  </div>

  <div class="col-12 panel">
    <h2>Top 10 rules by frequency</h2>
    <p class="lede" style="margin: -8px 0 16px; font-size: 13px;">Across all issue types — this is the most actionable view.</p>
    ${d.topRulesEnriched.length === 0 ? '<div class="empty">No issues found.</div>' : `
    <table>
      <thead>
        <tr>
          <th>Rule</th>
          <th>Severity</th>
          <th class="num">Count</th>
          <th>Description</th>
          <th class="num">Effort</th>
        </tr>
      </thead>
      <tbody>
        ${d.topRulesEnriched.map((r) => `
          <tr>
            <td class="mono">${escapeHtml(r.key)}</td>
            <td><span class="pill" style="background:${SEV_COLOUR[r.severity] ?? '#6b7280'}">${escapeHtml(r.severity)}</span></td>
            <td class="num">${r.count}</td>
            <td>${escapeHtml(r.name)}</td>
            <td class="num">${fmtEffort(r.totalEffortMin)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    `}
  </div>

  <div class="col-6 panel">
    <h2>Bugs by severity</h2>
    ${d.bugsTotal === 0 ? '<div class="empty">No open bugs — well done.</div>' :
      d.bugsBySeverity.map((x) => `
        <div class="bar-row">
          <div class="bar-label">${escapeHtml(x.severity)}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${(x.count / maxBugSev) * 100}%; background:${SEV_COLOUR[x.severity]}"></div>
          </div>
          <div class="bar-count">${x.count}</div>
        </div>
      `).join('')
    }
  </div>

  <div class="col-6 panel">
    <h2>Bugs by module</h2>
    ${d.bugModuleArr.length === 0 ? '<div class="empty">No open bugs.</div>' :
      d.bugModuleArr.map((x) => `
        <div class="bar-row">
          <div class="bar-label mono">${escapeHtml(x.mod)}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${(x.count / maxModule) * 100}%; background:#0a0a0a"></div>
          </div>
          <div class="bar-count">${x.count}</div>
        </div>
      `).join('')
    }
  </div>

  <div class="col-12 panel">
    <h2>Top ${d.worstFiles.length === 10 ? '10 ' : ''}files by bug count</h2>
    ${d.worstFiles.length === 0 ? '<div class="empty">No files with open bugs.</div>' : `
    <table>
      <thead>
        <tr>
          <th>File</th>
          <th class="num">Bugs</th>
          <th>Dominant rule</th>
        </tr>
      </thead>
      <tbody>
        ${d.worstFiles.map((f) => `
          <tr>
            <td class="mono">${escapeHtml(f.path)}</td>
            <td class="num">${f.count}</td>
            <td class="mono">${escapeHtml(f.dominantRule)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    `}
  </div>

  <div class="col-12 panel">
    <h2>Security hotspots breakdown</h2>
    <div class="note">These need manual triage — confirm or mark as safe before dismissing.</div>

    ${d.hotspotCatArr.length === 0 ? '' : `
    <h3 style="font-size:13px; font-weight:600; margin: 0 0 8px; color: var(--muted); text-transform: uppercase; letter-spacing:0.04em;">By category &amp; probability</h3>
    <table style="margin-bottom: 24px;">
      <thead>
        <tr>
          <th>Category</th>
          <th>Probability</th>
          <th class="num">Count</th>
        </tr>
      </thead>
      <tbody>
        ${d.hotspotCatArr.map((c) => `
          <tr>
            <td>${escapeHtml(c.category)}</td>
            <td><span class="pill" style="background:${PROB_COLOUR[c.probability] ?? '#6b7280'}">${escapeHtml(c.probability)}</span></td>
            <td class="num">${c.count}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    `}

    ${d.hotspotRows.length === 0 ? '<div class="empty">No hotspots to review.</div>' : `
    <h3 style="font-size:13px; font-weight:600; margin: 0 0 8px; color: var(--muted); text-transform: uppercase; letter-spacing:0.04em;">Each hotspot</h3>
    <table>
      <thead>
        <tr>
          <th>File</th>
          <th>Category</th>
          <th>Probability</th>
          <th>Message</th>
        </tr>
      </thead>
      <tbody>
        ${d.hotspotRows.map((h) => `
          <tr>
            <td class="mono">${escapeHtml(relPath(h.component))}:${h.line ?? '?'}</td>
            <td>${escapeHtml(h.securityCategory)}</td>
            <td><span class="pill" style="background:${PROB_COLOUR[h.vulnerabilityProbability] ?? '#6b7280'}">${escapeHtml(h.vulnerabilityProbability)}</span></td>
            <td>${escapeHtml(h.message)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    `}
  </div>

  <div class="col-12 next-steps">
    <h3>Next steps</h3>
    <ol>
      <li>Triage the ${hotspots} security hotspot${hotspots === '1' ? '' : 's'} — confirm or mark as safe.</li>
      <li>Wire up test coverage reporting (vitest/jest --coverage) so the baseline starts moving.</li>
      <li>Tackle the top 3 rules with Claude Code, batched — they account for the bulk of remediation effort.</li>
    </ol>
  </div>

  <footer class="col-12 footer">
    <div>Generated ${escapeHtml(generated)}</div>
    <div>Data source: SonarQube at <span class="mono">${escapeHtml(SONAR_URL)}</span></div>
  </footer>

</div>
</body>
</html>`;
}

function coverageBand(pct) {
  if (!Number.isFinite(pct)) return '—';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B';
  if (pct >= 50) return 'C';
  if (pct >= 30) return 'D';
  return 'E';
}

function ratingDescription(name, letter) {
  if (letter === '—') return 'No data';
  const labels = {
    Security: { A: 'No vulnerabilities', B: 'Minor risk', C: 'Major risk', D: 'Critical risk', E: 'Blocker risk' },
    Reliability: { A: 'No bugs', B: 'Minor bugs', C: 'Major bugs', D: 'Critical bugs', E: 'Blocker bugs' },
    Maintainability: { A: 'Healthy', B: 'Mild debt', C: 'Moderate debt', D: 'Heavy debt', E: 'Severe debt' },
    Hotspots: { A: 'All reviewed', B: '≥80% reviewed', C: '≥70% reviewed', D: '≥50% reviewed', E: '<50% reviewed' },
    Coverage: { A: '≥80% covered', B: '≥70% covered', C: '≥50% covered', D: '≥30% covered', E: '<30% covered' },
  };
  return labels[name]?.[letter] ?? letter;
}

main().catch((err) => {
  console.error('Build failed:', err.message);
  process.exit(1);
});
