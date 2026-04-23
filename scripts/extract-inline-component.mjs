import fs from 'fs';

const [, , tsPath, outHtml, outScss] = process.argv;
if (!tsPath) {
  console.error('Usage: node extract-inline-component.mjs <component.ts> [out.html] [out.scss]');
  process.exit(1);
}

const s = fs.readFileSync(tsPath, 'utf8');
const tm = s.match(/  template: `([\s\S]*?)`,\r?\n  styles:/);
const sm = s.match(/  styles: \[\r?\n    `([\s\S]*?)`,\r?\n  \],\r?\n\}\)/);

if (!tm || !sm) {
  console.error('Match failed', { template: !!tm, styles: !!sm });
  process.exit(1);
}

const html = tm[1].replace(/^\r?\n/, '').replace(/\r?\n  $/, '');
const scss = sm[1].replace(/^\r?\n    /, '').replace(/\r?\n    $/, '');

const htmlPath =
  outHtml ||
  (tsPath.endsWith('.component.ts')
    ? tsPath.replace(/\.component\.ts$/, '.component.html')
    : tsPath.replace(/\.ts$/, '.component.html'));
const scssPath =
  outScss ||
  (tsPath.endsWith('.component.ts')
    ? tsPath.replace(/\.component\.ts$/, '.component.scss')
    : tsPath.replace(/\.ts$/, '.component.scss'));

fs.writeFileSync(htmlPath, html);
fs.writeFileSync(scssPath, scss);
console.log('Wrote', htmlPath, scssPath);
