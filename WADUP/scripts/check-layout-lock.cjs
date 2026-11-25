// Owner-approved Wadup opening layout. Changes require explicit owner approval.
// Do not update fingerprints merely to silence this check.
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'pages', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
const checks = [
  ['seven-day calendar', 'function buildDays()', '\n// ── "🔥 Trending Now"', '0bc41a5f'],
  ['desktop WADUP sidebar', '          <div className="sidebar-header">', '        </aside>', '21081b47']
];
function fingerprint(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); }
let failed = false;
for (const [name, start, end, approved] of checks) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  const actual = from < 0 || to < 0 ? 'missing' : fingerprint(source.slice(from, to));
  if (actual !== approved) { console.error(name + ': OWNER APPROVAL REQUIRED (expected ' + approved + ', found ' + actual + ')'); failed = true; }
  else console.log(name + ': unchanged');
}
if (failed) process.exit(1);
