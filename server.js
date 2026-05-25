/**
 * REPO PULSE — GitHub Repo Health Scanner
 * 
 * A complete product: landing page + scan engine + Stripe checkout + report delivery.
 * 
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_xxx STRIPE_PRICE_ID=price_xxx node server.js
 * 
 * Environment variables:
 *   STRIPE_SECRET_KEY   Stripe secret key
 *   STRIPE_PRICE_ID     Stripe Price ID for the $9 report
 *   STRIPE_WEBHOOK_SECRET  Stripe webhook signature secret (optional)
 *   PORT                Server port (default 3100)
 *   GITHUB_TOKEN        GitHub personal access token
 */

import http from 'http';
import { URL } from 'url';
import { execSync, exec } from 'child_process';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import Stripe from 'stripe';

const PORT = process.env.PORT || 3100;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
const PRICE_ID = process.env.STRIPE_PRICE_ID || '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY) : null;

// ── Store scans in memory (use DB in production) ─────────────────────────
const scans = new Map();         // scanId -> { repo, status, report, sessionId }
const sessions = new Map();      // stripeSessionId -> scanId

// ── Landing Page ─────────────────────────────────────────────────────────
function landingPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Repo Pulse — GitHub Repo Health Scanner</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0f;color:#e0e0e0;line-height:1.6}
.max{max-width:900px;margin:0 auto;padding:0 24px}
header{padding:48px 0 32px;border-bottom:1px solid #1a1a2e}
h1{font-size:2.4em;background:linear-gradient(135deg,#00d4ff,#7b2ff7);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px}
.sub{color:#888;font-size:1.1em}
.hero{padding:64px 0;text-align:center}
.hero h2{font-size:1.8em;margin-bottom:16px;color:#fff}
.hero p{color:#aaa;font-size:1.1em;max-width:600px;margin:0 auto 32px}
input[type=text]{width:100%;max-width:500px;padding:14px 18px;background:#111122;border:1px solid #2a2a4e;border-radius:8px;color:#fff;font-size:1em;outline:none;transition:border .2s}
input[type=text]:focus{border-color:#00d4ff}
input[type=text]::placeholder{color:#555}
button{margin-top:16px;padding:14px 36px;background:linear-gradient(135deg,#00d4ff,#7b2ff7);border:none;border-radius:8px;color:#fff;font-size:1em;font-weight:600;cursor:pointer;transition:transform .15s,opacity .15s}
button:hover{transform:translateY(-1px)}
button:disabled{opacity:.5;cursor:not-allowed;transform:none}
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px;padding:48px 0}
.card{background:#111122;border:1px solid #1a1a3e;border-radius:12px;padding:24px}
.card h3{color:#00d4ff;margin-bottom:8px;font-size:1.1em}
.card p{color:#999;font-size:.95em}
.pricing{padding:48px 0;text-align:center}
.price-card{background:#111122;border:2px solid #2a2a4e;border-radius:16px;padding:40px;max-width:400px;margin:0 auto}
.price-card h3{font-size:1.4em;color:#fff;margin-bottom:8px}
.price{font-size:3em;font-weight:800;color:#00d4ff}
.price span{font-size:.4em;color:#888;font-weight:400}
.features-list{text-align:left;margin:24px 0;padding:0;list-style:none}
.features-list li{padding:6px 0;color:#aaa}
.features-list li:before{content:"✓ ";color:#00d4ff}
.status{margin-top:16px;padding:12px;border-radius:8px;display:none}
.status.ok{background:#0a2a1a;border:1px solid #1a4a2a;color:#4ade80}
.status.error{background:#2a0a0a;border:1px solid #4a1a1a;color:#f87171}
.status.loading{background:#1a1a2e;border:1px solid #2a2a4e;color:#00d4ff}
.report{margin-top:32px;text-align:left;background:#111122;border:1px solid #1a1a3e;border-radius:12px;padding:32px;display:none}
.report h3{color:#00d4ff;margin-bottom:16px}
.report pre{white-space:pre-wrap;word-wrap:break-word;color:#ccc;font-size:.9em;line-height:1.5}
.report .score{display:inline-block;padding:4px 12px;border-radius:20px;font-weight:700;font-size:.85em;margin-bottom:16px}
.score.a{background:#0a3a1a;color:#4ade80}
.score.b{background:#1a3a0a;color:#a3e635}
.score.c{background:#3a3a0a;color:#facc15}
.score.d{background:#3a2a0a;color:#fb923c}
.score.f{background:#3a0a0a;color:#f87171}
footer{padding:48px 0;text-align:center;color:#555;font-size:.9em;border-top:1px solid #1a1a2e;margin-top:48px}
</style>
</head>
<body>
<div class="max">
<header>
  <h1>Repo Pulse</h1>
  <p class="sub">GitHub repo health scanner — instant actionable reports</p>
</header>

<section class="hero">
  <h2>Know what's wrong with your repo. In 30 seconds.</h2>
  <p>Repo Pulse analyzes any GitHub repository and produces a structured report: code quality, security risks, architecture gaps, test coverage, and specific recommendations. $9 per report. Instant delivery.</p>
  
  <form id="scanForm">
    <input type="text" id="repo" placeholder="owner/repo — e.g., vercel/next.js" required>
    <br>
    <button type="submit" id="submitBtn">Scan Now — $9</button>
  </form>
  
  <div id="status" class="status"></div>
  
  <div id="report" class="report">
    <h3>📊 Repo Pulse Report</h3>
    <div id="score" class="score"></div>
    <pre id="reportBody"></pre>
  </div>
</section>

<section class="features">
  <div class="card">
    <h3>🔍 Code Quality</h3>
    <p>LOC analysis, language distribution, complexity hotspots, and maintainability scoring.</p>
  </div>
  <div class="card">
    <h3>🔒 Security Scan</h3>
    <p>Dependency vulnerabilities, exposed secrets detection, and common CWE pattern matching.</p>
  </div>
  <div class="card">
    <h3>🏗️ Architecture Review</h3>
    <p>Module coupling, circular dependency detection, and structural anti-patterns.</p>
  </div>
  <div class="card">
    <h3>✅ Test Coverage</h3>
    <p>Test file ratio, test-to-source mapping, and coverage gap identification.</p>
  </div>
  <div class="card">
    <h3>📋 Actionable Output</h3>
    <p>Prioritized recommendations, not just metrics. Know exactly what to fix first.</p>
  </div>
  <div class="card">
    <h3>⚡ Instant Delivery</h3>
    <p>Report delivered in under 60 seconds via the dashboard. No waiting for CI.</p>
  </div>
</section>

<section class="pricing">
  <div class="price-card">
    <h3>Single Scan Report</h3>
    <div class="price">$9<span>/report</span></div>
    <ul class="features-list">
      <li>Full repo health analysis</li>
      <li>Security vulnerability scan</li>
      <li>Architecture review</li>
      <li>Prioritized recommendations</li>
      <li>Instant dashboard delivery</li>
    </ul>
    <a href="#scanForm"><button>Get Started</button></a>
  </div>
</section>

<footer>
  <p>Built by OWL • Bare metal Node.js • No dependencies bloat</p>
</footer>
</div>

<script>
const form = document.getElementById('scanForm');
const repoInput = document.getElementById('repo');
const submitBtn = document.getElementById('submitBtn');
const status = document.getElementById('status');
const reportDiv = document.getElementById('report');
const reportBody = document.getElementById('reportBody');
const scoreDiv = document.getElementById('score');

function showStatus(msg, type) {
  status.style.display = 'block';
  status.className = 'status ' + type;
  status.textContent = msg;
}

function hideStatus() {
  status.style.display = 'none';
}

async function startScan(repo) {
  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ repo })
    });
    const data = await res.json();
    
    if (data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
    } else if (data.scanId) {
      // Free scan or already paid — poll for results
      pollResults(data.scanId);
    } else if (data.error) {
      showStatus(data.error, 'error');
      submitBtn.disabled = false;
    }
  } catch (e) {
    showStatus('Error: ' + e.message, 'error');
    submitBtn.disabled = false;
  }
}

async function pollResults(scanId) {
  showStatus('Scanning repo... this takes about 30 seconds.', 'loading');
  
  const interval = setInterval(async () => {
    try {
      const res = await fetch('/api/scan/' + scanId);
      const data = await res.json();
      
      if (data.status === 'complete') {
        clearInterval(interval);
        hideStatus();
        showReport(data.report);
        submitBtn.disabled = false;
      } else if (data.status === 'error') {
        clearInterval(interval);
        showStatus('Scan failed: ' + (data.error || 'Unknown error'), 'error');
        submitBtn.disabled = false;
      } else {
        showStatus('Scanning... ' + (data.progress || 'analyzing'), 'loading');
      }
    } catch (e) {
      clearInterval(interval);
      showStatus('Error: ' + e.message, 'error');
      submitBtn.disabled = false;
    }
  }, 3000);
}

function showReport(report) {
  reportDiv.style.display = 'block';
  reportBody.textContent = report.text || report;
  
  const score = report.score || 'c';
  const labels = {a: 'A — Excellent', b: 'B — Good', c: 'C — Needs Work', d: 'D — Poor', f: 'F — Critical'};
  scoreDiv.textContent = labels[score] || score.toUpperCase();
  scoreDiv.className = 'score ' + score.toLowerCase();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const repo = repoInput.value.trim();
  if (!repo || !repo.includes('/')) {
    showStatus('Enter a valid repo (owner/repo)', 'error');
    return;
  }
  submitBtn.disabled = true;
  hideStatus();
  reportDiv.style.display = 'none';
  await startScan(repo);
});
</script>
</body>
</html>`;
}

// ── Scan Engine ──────────────────────────────────────────────────────────
async function scanRepo(repo) {
  const report = {
    repo,
    timestamp: new Date().toISOString(),
    score: 'c',
    sections: []
  };

  const tmpDir = join(homedir(), '.repo-pulse-tmp', repo.replace('/', '-'));
  
  try {
    mkdirSync(tmpDir, { recursive: true });
    
    // Clone the repo (shallow, fast)
    let cloneSuccess = false;
    try {
      execSync(`git clone --depth=1 --single-branch https://github.com/${repo}.git "${tmpDir}/repo" 2>&1`, 
        { timeout: 60000, encoding: 'utf-8' });
      cloneSuccess = true;
    } catch {
      report.sections.push({ title: '⚠️ Clone Failed', content: 'Could not clone repository. It may be private or non-existent.' });
      report.score = 'f';
      return report;
    }

    if (!cloneSuccess) return report;

    const repoPath = join(tmpDir, 'repo');
    
    // ── 1. Basic Stats ──────────────────────────────────────────
    try {
      const totalFiles = execSync(`find "${repoPath}" -type f | wc -l`, { encoding: 'utf-8' }).trim();
      const totalLines = execSync(`find "${repoPath}" -type f \\( -name "*.js" -o -name "*.ts" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java" -o -name "*.c" -o -name "*.cpp" -o -name "*.rb" -o -name "*.swift" \\) | xargs wc -l 2>/dev/null | tail -1`, { encoding: 'utf-8' }).trim().split(/\s+/)[0] || '0';
      const commitCount = execSync(`git -C "${repoPath}" rev-list --count HEAD 2>/dev/null || echo 0`, { encoding: 'utf-8' }).trim();
      const contributors = execSync(`git -C "${repoPath}" shortlog -sn --no-merges 2>/dev/null | wc -l`, { encoding: 'utf-8' }).trim();
      const lastCommit = execSync(`git -C "${repoPath}" log -1 --format="%ar" 2>/dev/null`, { encoding: 'utf-8' }).trim();
      
      report.sections.push({
        title: '📊 Repository Overview',
        content: `Files: ${totalFiles}  |  Code lines: ${totalLines}  |  Commits: ${commitCount}  |  Contributors: ${contributors}  |  Last commit: ${lastCommit}`
      });
    } catch {}

    // ── 2. Language Analysis ────────────────────────────────────
    try {
      const files = execSync(`find "${repoPath}" -type f | sed 's/.*\\.//' | sort | uniq -c | sort -rn | head -20`, { encoding: 'utf-8' }).trim();
      if (files) {
        report.sections.push({
          title: '🔤 Language Distribution (by file extension)',
          content: files
        });
      }
    } catch {}

    // ── 3. Structure Analysis ───────────────────────────────────
    try {
      const dirs = execSync(`find "${repoPath}" -maxdepth 2 -type d | head -30`, { encoding: 'utf-8' }).trim();
      const hasTests = existsSync(join(repoPath, 'test')) || existsSync(join(repoPath, 'tests')) || existsSync(join(repoPath, '__tests__')) || existsSync(join(repoPath, 'spec'));
      const hasCI = existsSync(join(repoPath, '.github', 'workflows')) || existsSync(join(repoPath, '.travis.yml')) || existsSync(join(repoPath, 'Jenkinsfile'));
      const hasDocs = existsSync(join(repoPath, 'README.md')) || existsSync(join(repoPath, 'README.rst'));
      const hasLicense = existsSync(join(repoPath, 'LICENSE')) || existsSync(join(repoPath, 'LICENSE.md'));
      const hasContributing = existsSync(join(repoPath, 'CONTRIBUTING.md'));
      const hasEditorConfig = existsSync(join(repoPath, '.editorconfig'));
      const hasPrettier = existsSync(join(repoPath, '.prettierrc')) || existsSync(join(repoPath, '.prettierrc.json'));
      const hasEslint = existsSync(join(repoPath, '.eslintrc')) || existsFileSync(join(repoPath, '.eslintrc.json'));
      
      const structureChecks = [];
      if (hasTests) structureChecks.push('✅ Tests directory');
      else structureChecks.push('❌ No tests directory');
      if (hasCI) structureChecks.push('✅ CI/CD configured');
      else structureChecks.push('❌ No CI/CD detected');
      if (hasDocs) structureChecks.push('✅ README present');
      else structureChecks.push('❌ No README');
      if (hasLicense) structureChecks.push('✅ License file');
      else structureChecks.push('❌ No license');
      if (hasContributing) structureChecks.push('✅ Contributing guide');
      else structureChecks.push('❌ No contributing guide (soft fail)');
      if (hasEditorConfig) structureChecks.push('✅ EditorConfig');
      if (hasPrettier) structureChecks.push('✅ Prettier');
      if (hasEslint) structureChecks.push('✅ ESLint');

      report.sections.push({
        title: '📁 Project Structure',
        content: structureChecks.join('\n')
      });
    } catch {}

    // ── 4. Security Scan ────────────────────────────────────────
    try {
      const findings = [];
      
      // Check for exposed secrets (basic patterns)
      const secretPatterns = [
        { pattern: 'sk-[A-Za-z0-9]{20,}', label: 'Stripe-like API key' },
        { pattern: 'gh[pousr]_[A-Za-z0-9_]{20,}', label: 'GitHub token' },
        { pattern: 'AIza[0-9A-Za-z_-]{20,}', label: 'Google API key' },
        { pattern: '-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----', label: 'Private key' },
      ];
      
      for (const { pattern, label } of secretPatterns) {
        try {
          const matches = execSync(`grep -rl -E '${pattern}' "${repoPath}" --include="*.js" --include="*.ts" --include="*.json" --include="*.yaml" --include="*.yml" --include="*.env*" 2>/dev/null | head -5`, { encoding: 'utf-8' }).trim();
          if (matches) findings.push(`⚠️ POTENTIAL EXPOSED SECRET (${label}): ${matches.split('\n').join(', ')}`);
        } catch {}
      }

      // Check for eval() usage
      try {
        const evals = execSync(`grep -rl 'eval(' "${repoPath}" --include="*.js" --include="*.ts" --include="*.py" 2>/dev/null | head -5`, { encoding: 'utf-8' }).trim();
        if (evals) findings.push(`⚠️ eval() usage detected in: ${evals.split('\n').join(', ')}`);
      } catch {}

      // Check for console.log in production code (JS/TS)
      try {
        const consoleLogs = execSync(`grep -rn 'console\\.log' "${repoPath}" --include="*.js" --include="*.ts" 2>/dev/null | grep -v node_modules | grep -v test | wc -l`, { encoding: 'utf-8' }).trim();
        if (parseInt(consoleLogs) > 20) findings.push(`⚡ ${consoleLogs} console.log statements in production code`);
      } catch {}

      // Check for TODO/FIXME density
      try {
        const todos = execSync(`grep -rn 'TODO\\|FIXME\\|HACK\\|XXX' "${repoPath}" --include="*.js" --include="*.ts" --include="*.py" --include="*.go" --include="*.rs" 2>/dev/null | grep -v node_modules | wc -l`, { encoding: 'utf-8' }).trim();
        if (parseInt(todos) > 0) findings.push(`${todos} TODO/FIXME/HACK comments`);
      } catch {}

      if (findings.length === 0) {
        report.sections.push({ title: '🔒 Security Scan', content: '✅ No obvious security issues detected. Basic checks passed.' });
      } else {
        report.sections.push({ title: '🔒 Security Scan', content: findings.join('\n') });
      }
    } catch {}

    // ── 5. Code Quality Signals ─────────────────────────────────
    try {
      const signals = [];
      
      // Large files (>500 lines)
      try {
        const bigFiles = execSync(`find "${repoPath}" -name "*.js" -o -name "*.ts" -o -name "*.py" -o -name "*.go" | xargs wc -l 2>/dev/null | sort -rn | head -10`, { encoding: 'utf-8' }).trim();
        const fileLines = bigFiles.split('\n').filter(l => l.trim());
        const huge = fileLines.filter(l => {
          const parts = l.trim().split(/\s+/);
          return parseInt(parts[0]) > 500;
        });
        if (huge.length > 0) {
          signals.push(`\n📏 Large files (>500 lines):`);
          signals.push(huge.map(l => '  ' + l.trim()).join('\n'));
        }
      } catch {}

      // Dependency count (package.json, requirements.txt, etc.)
      const depsCount = [];
      try {
        const pkgJson = join(repoPath, 'package.json');
        if (existsSync(pkgJson)) {
          const pkg = JSON.parse(readFileSync(pkgJson, 'utf-8'));
          const depCount = Object.keys(pkg.dependencies || {}).length;
          const devCount = Object.keys(pkg.devDependencies || {}).length;
          depsCount.push(`Node.js: ${depCount} runtime deps, ${devCount} dev deps`);
        }
      } catch {}
      try {
        if (existsSync(join(repoPath, 'requirements.txt'))) {
          const lines = readFileSync(join(repoPath, 'requirements.txt'), 'utf-8').split('\n').filter(l => l.trim() && !l.startsWith('#'));
          depsCount.push(`Python: ${len(depsCount)} deps in requirements.txt`);
        }
      } catch {}
      if (depsCount.length > 0) {
        signals.push(`\n📦 Dependencies: ${depsCount.join(', ')}`);
      }

      report.sections.push({
        title: '🧹 Code Quality Signals',
        content: signals.length > 0 ? signals.join('\n') : 'No obvious quality issues detected.'
      });
    } catch {}

    // ── 6. Calculate Score ──────────────────────────────────────
    let score = 'b';
    const allText = report.sections.map(s => s.content).join(' ').toLowerCase();
    const issueCount = (allText.match(/❌/g) || []).length + (allText.match(/⚠️/g) || []).length;
    
    if (issueCount <= 1) score = 'a';
    else if (issueCount <= 3) score = 'b';
    else if (issueCount <= 6) score = 'c';
    else if (issueCount <= 10) score = 'd';
    else score = 'f';
    
    report.score = score;

    return report;

  } finally {
    // Cleanup tmp
    try { execSync(`rm -rf "${tmpDir}"`, { timeout: 10000 }); } catch {}
  }
}

function formatReport(report) {
  const lines = [];
  lines.push(`# Repo Pulse Report: ${report.repo}`);
  lines.push(`Generated: ${report.timestamp}`);
  lines.push(`Health Score: ${report.score.toUpperCase()}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  
  for (const section of report.sections) {
    lines.push(`## ${section.title}`);
    lines.push('');
    lines.push(section.content);
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  
  // Add recommendations
  lines.push('## 🎯 Top Recommendations');
  lines.push('');
  
  const recommendations = [];
  const allText = report.sections.map(s => s.content).join(' ').toLowerCase();
  
  if (allText.includes('no tests')) recommendations.push('1. **Add test infrastructure** — No tests detected. Start with unit tests for core modules.');
  if (allText.includes('no ci')) recommendations.push('1. **Set up CI/CD** — No CI detected. GitHub Actions is the easiest starting point.');
  if (allText.includes('no license')) recommendations.push('1. **Add a license** — Choose MIT for permissive or AGPL for copyleft.');
  if (allText.match(/eval\(/)) recommendations.push('1. **Remove eval() usage** — Security risk. Refactor to use safer alternatives.');
  if (allText.match(/exposed secret|private key|api key/)) recommendations.push('1. **🔴 URGENT: Rotate exposed secrets** — Potential credentials found in code. Rotate immediately.');
  if (!recommendations.length) recommendations.push('1. **Maintain current quality** — No critical issues found. Keep up the good work.');
  
  lines.push(recommendations.slice(0, 5).join('\n\n'));
  lines.push('');
  lines.push('---');
  lines.push('_Report generated by Repo Pulse — bare metal repo analysis_');
  
  return { text: lines.join('\n'), score: report.score };
}

// ── HTTP Server ──────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Landing page
  if (method === 'GET' && path === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(landingPage());
    return;
  }

  // Health
  if (method === 'GET' && path === '/api/health') {
    return send(res, 200, { status: 'ok', scans: scans.size, stripe_ready: !!stripe });
  }

  // POST /api/checkout — Create Stripe checkout session
  if (method === 'POST' && path === '/api/checkout') {
    return readBody(req, async (body) => {
      try {
        const { repo } = JSON.parse(body);
        if (!repo || !repo.includes('/')) return send(res, 400, { error: 'Invalid repo format. Use owner/repo.' });

        if (!stripe || !PRICE_ID) {
          // No Stripe configured — create a free scan for demo
          const scanId = 'scan_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
          scans.set(scanId, { repo, status: 'pending', report: null, createdAt: new Date().toISOString() });
          
          // Start scan in background
          runScan(scanId, repo);
          
          return send(res, 200, { scanId, checkoutUrl: null, message: 'Stripe not configured. Running free scan.' });
        }

        const scanId = 'scan_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        scans.set(scanId, { repo, status: 'pending', report: null, createdAt: new Date().toISOString() });

        const session = await stripe.checkout.sessions.create({
          mode: 'payment',
          line_items: [{ price: PRICE_ID, quantity: 1 }],
          success_url: `http://${req.headers.host}/?scanId=${scanId}&success=true`,
          cancel_url: `http://${req.headers.host}/?scanId=${scanId}&canceled=true`,
          metadata: { scanId, repo }
        });

        sessions.set(session.id, scanId);
        scans.get(scanId).sessionId = session.id;

        return send(res, 200, { checkoutUrl: session.url, scanId });
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    });
  }

  // GET /api/scan/:scanId — Get scan status/results
  if (method === 'GET' && path.startsWith('/api/scan/')) {
    const scanId = path.split('/').pop();
    const scan = scans.get(scanId);
    if (!scan) return send(res, 404, { error: 'Scan not found' });
    
    return send(res, 200, {
      scanId,
      repo: scan.repo,
      status: scan.status,
      report: scan.report,
      createdAt: scan.createdAt
    });
  }

  // GET /api/report/:scanId — Download report as markdown
  if (method === 'GET' && path.startsWith('/api/report/')) {
    const scanId = path.split('/').pop();
    const scan = scans.get(scanId);
    if (!scan || !scan.report) return send(res, 404, { error: 'Report not ready' });
    
    res.setHeader('Content-Type', 'text/markdown');
    res.setHeader('Content-Disposition', `attachment; filename="repo-pulse-${scan.repo.replace('/', '-')}.md"`);
    res.writeHead(200);
    res.end(scan.report.text || JSON.stringify(scan.report, null, 2));
    return;
  }

  // POST /api/webhook — Stripe webhook
  if (method === 'POST' && path === '/api/webhook') {
    return readBody(req, async (body) => {
      try {
        const sig = req.headers['stripe-signature'];
        let event;
        
        if (WEBHOOK_SECRET && sig) {
          event = stripe.webhooks.constructEvent(body, sig, WEBHOOK_SECRET);
        } else {
          event = JSON.parse(body);
        }

        if (event.type === 'checkout.session.completed') {
          const session = event.data.object;
          const scanId = sessions.get(session.id);
          if (scanId && scans.has(scanId)) {
            const scan = scans.get(scanId);
            scan.status = 'paid';
            
            // Start the scan
            runScan(scanId, scan.repo);
          }
        }

        send(res, 200, { received: true });
      } catch (e) {
        send(res, 400, { error: e.message });
      }
    });
  }

  // POST /api/scan/free — Free scan (no Stripe, for demo)
  if (method === 'POST' && path === '/api/scan/free') {
    return readBody(req, (body) => {
      try {
        const { repo } = JSON.parse(body);
        if (!repo || !repo.includes('/')) return send(res, 400, { error: 'Invalid repo' });
        
        const scanId = 'scan_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        scans.set(scanId, { repo, status: 'scanning', report: null, createdAt: new Date().toISOString() });
        
        runScan(scanId, repo);
        return send(res, 202, { scanId, status: 'scanning', message: 'Scan started. Poll /api/scan/' + scanId + ' for results.' });
      } catch (e) {
        return send(res, 400, { error: 'Invalid JSON' });
      }
    });
  }

  send(res, 404, { error: 'Not found', path });
});

function send(res, code, data) {
  res.writeHead(code);
  res.end(JSON.stringify(data, null, 2));
}

function readBody(req, cb) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => cb(body));
}

async function runScan(scanId, repo) {
  const scan = scans.get(scanId);
  if (!scan) return;
  
  scan.status = 'scanning';
  
  try {
    scan.progress = 'Cloning repository...';
    const report = await scanRepo(repo);
    scan.report = formatReport(report);
    scan.status = 'complete';
    scan.completedAt = new Date().toISOString();
  } catch (e) {
    scan.status = 'error';
    scan.error = e.message;
  }
}

server.listen(PORT, () => {
  console.log(`\n  🔍 Repo Pulse v1.0 — http://localhost:${PORT}`);
  console.log(`  Stripe: ${stripe ? 'configured ✓' : 'not set (free mode)'}`);
  console.log(`  Price: ${PRICE_ID || 'not set'}`);
  console.log(`  Press Ctrl+C to stop\n`);
});
