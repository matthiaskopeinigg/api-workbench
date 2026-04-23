/**
 * Split inline template + styles from an Angular @Component into .html / .scss
 * and replace with templateUrl + styleUrl.
 */
import fs from 'fs';
import path from 'path';

const [, , tsPath] = process.argv;
if (!tsPath) {
  console.error('Usage: node split-inline-component.mjs <file.component.ts>');
  process.exit(1);
}

const s = fs.readFileSync(tsPath, 'utf8');
// styles: `[` may be same line as opening backtick (button). After inner `, optional comma then newline (json).
// Do not consume the newline before `})` or it merges with styleUrl in the replacement.
const re =
  /(\s*)template: `([\s\S]*?)`,\s*\r?\n\s*styles: \[\s*\r?\n?\s*`([\s\S]*?)`\s*\]\s*,?/;

const m = s.match(re);
if (!m) {
  console.error('No inline template+styles match:', tsPath);
  process.exit(1);
}

const indent = m[1];
let html = m[2];
let scss = m[3];

// Strip one outer indentation level common to extracted template (first line often empty)
html = html.replace(/^\r?\n/, '');
scss = scss.replace(/^\r?\n/, '');

const dir = path.dirname(tsPath);
const stem = path.basename(tsPath, '.component.ts');
const outHtml = path.join(dir, `${stem}.component.html`);
const outScss = path.join(dir, `${stem}.component.scss`);

fs.writeFileSync(outHtml, html);
fs.writeFileSync(outScss, scss);

const relHtml = `./${path.basename(outHtml)}`;
const relScss = `./${path.basename(outScss)}`;

const patched = s.replace(
  re,
  `${indent}templateUrl: '${relHtml}',\n${indent}styleUrl: '${relScss}',`,
);

fs.writeFileSync(tsPath, patched);
console.log('Wrote', outHtml, outScss);
