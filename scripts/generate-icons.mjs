import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import png2icons from 'png2icons';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '..', 'public');
const source = join(publicDir, 'logo.png');
const input = await readFile(source);

const ico = png2icons.createICO(input, png2icons.BICUBIC, 0, false, true);
if (!ico) {
  console.error('Failed to generate ICO buffer');
  process.exit(1);
}
for (const target of ['icon.ico', 'favicon.ico']) {
  const out = join(publicDir, target);
  await writeFile(out, ico);
  console.log(`wrote ${out} (${(ico.length / 1024).toFixed(1)} KB)`);
}

const icns = png2icons.createICNS(input, png2icons.BICUBIC, 0);
if (!icns) {
  console.error('Failed to generate icon.icns');
  process.exit(1);
}
const icnsOut = join(publicDir, 'icon.icns');
await writeFile(icnsOut, icns);
console.log(`wrote ${icnsOut} (${(icns.length / 1024).toFixed(1)} KB)`);
