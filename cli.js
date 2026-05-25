#!/usr/bin/env node
/**
 * Repo Pulse CLI — Scan a GitHub repo and print the report
 * 
 * Usage:
 *   node cli.js owner/repo
 * 
 * Example:
 *   node cli.js expressjs/express
 *   node cli.js vercel/next.js
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const repo = process.argv[2];
if (!repo || !repo.includes('/')) {
  console.error('Usage: node cli.js owner/repo');
  process.exit(1);
}

const tmpDir = join(homedir(), '.repo-pulse-tmp', repo.replace('/', '-') + '-' + Date.now());

try {
  mkdirSync(tmpDir, { recursive: true });
  
  console.log(`\n🔍 Scanning ${repo}...\n`);
  
  // Clone
  execSync(`git clone --depth=1 --single-branch https://github.com/${repo}.git "${tmpDir}/repo" 2>&1`, 
    { timeout: 60000, encoding: 'utf-8' });
  
  const repoPath = join(tmpDir, 'repo');
  
  // Stats
  const totalFiles = execSync(`find "${repoPath}" -type f | wc -l`, { encoding: 'utf-8' }).trim();
  const lines = execSync(`find "${repoPath}" -type f \\( -name "*.js" -o -name "*.ts" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java" -o -name "*.rb" -o -name "*.swift" -o -name "*.c" -o -name "*.cpp" \\) | xargs wc -l 2>/dev/null | tail -1`, { encoding: 'utf-8' }).trim();
  const totalLines = lines.split(/\s+/)[0] || '0';
  const commits = execSync(`git -C "${repoPath}" rev-list --count HEAD 2>/dev/null`, { encoding: 'utf-8' }).trim();
  const lastCommit = execSync(`git -C "${repoPath}" log -1 --format="%ar" 2>/dev/null`, { encoding: 'utf-8' }).trim();
  
  console.log(`📊 ${totalFiles} files | ${totalLines} code lines | ${commits} commits | Last: ${lastCommit}`);
  
  // Structure
  const hasTests = ['test', 'tests', '__tests__', 'spec'].some(d => existsSync(join(repoPath, d)));
  const hasCI = existsSync(join(repoPath, '.github', 'workflows'));
  const hasReadme = existsSync(join(repoPath, 'README.md'));
  const hasLicense = existsSync(join(repoPath, 'LICENSE'));
  const hasPrettier = existsSync(join(repoPath, '.prettierrc'));
  const hasEslint = existsSync(join(repoPath, '.eslintrc.json')) || existsSync(join(repoPath, '.eslintrc'));
  
  console.log(`\n📁 Structure:`);
  console.log(`  ${hasTests ? '✅' : '❌'} Tests ${hasCI ? '✅' : '❌'} CI/CD ${hasReadme ? '✅' : '❌'} README ${hasLicense ? '✅' : '❌'} LICENSE`);
  if (hasPrettier) console.log('  ✅ Prettier');
  if (hasEslint) console.log('  ✅ ESLint');
  
  // Security
  console.log(`\n🔒 Security:`);
  try {
    const evals = execSync(`grep -rl 'eval(' "${repoPath}" --include="*.js" --include="*.ts" 2>/dev/null | head -3`, { encoding: 'utf-8' }).trim();
    if (evals) console.log(`  ⚠️  eval() in: ${evals}`);
    else console.log('  ✅ No eval() usage');
  } catch { console.log('  ✅ No eval() usage'); }
  
  try {
    const secrets = execSync(`grep -rl -E 'sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|AIza[a-zA-Z0-9_-]{20,}' "${repoPath}" --include="*.js" --include="*.ts" --include="*.json" 2>/dev/null | head -3`, { encoding: 'utf-8' }).trim();
    if (secrets) console.log(`  ⚠️  Potential secrets: ${secrets}`);
    else console.log('  ✅ No obvious secrets exposed');
  } catch { console.log('  ✅ No obvious secrets exposed'); }
  
  // Large files
  console.log(`\n📏 Large files (>500 lines):`);
  try {
    const big = execSync(`find "${repoPath}" \\( -name "*.js" -o -name "*.ts" -o -name "*.py" -o -name "*.go" \\) -exec wc -l {} + 2>/dev/null | sort -rn | head -5`, { encoding: 'utf-8' }).trim();
    big.split('\n').forEach(l => { if (l.trim()) console.log(`  ${l.trim()}`); });
  } catch {}
  
  // Recommendations
  console.log(`\n🎯 Recommendations:`);
  if (!hasTests) console.log('  1. Add test infrastructure');
  if (!hasCI) console.log('  1. Set up CI/CD (GitHub Actions)');
  if (!hasLicense) console.log('  1. Add a license file');
  
  console.log(`\n✅ Scan complete.`);

} catch (e) {
  console.error(`Error: ${e.message}`);
} finally {
  try { rmSync(tmpDir, { recursive: true }); } catch {}
}
