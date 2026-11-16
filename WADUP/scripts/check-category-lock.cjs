// Category taxonomy is OWNER-APPROVED. Do not edit these pinned fingerprints
// unless the Wadup owner explicitly approves the exact category/subcategory change.
// Updating these fingerprints to silence a failed check is NOT authorization.
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'data.js'), 'utf8');
const ranges = [
  ['CATEGORY_CHIPS', 'export const CATEGORY_CHIPS = [', '\n// Legacy values', 'd6ae0619'],
  ['SUBCATEGORY_ALIASES', 'const SUBCATEGORY_ALIASES = {', '\nfunction normalizeSubcategory', 'e962078f'],
];
function fingerprint(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
let failed = false;
for (const [name, start, end, approved] of ranges) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  if (from < 0 || to < 0) {
    console.error(name + ': taxonomy definition missing or relocated');
    failed = true;
    continue;
  }
  const actual = fingerprint(source.slice(from, to));
  if (actual !== approved) {
    console.error(name + ': OWNER APPROVAL REQUIRED. Approved ' + approved + ', found ' + actual);
    failed = true;
  } else {
    console.log(name + ': approved taxonomy unchanged');
  }
}
if (failed) process.exit(1);
