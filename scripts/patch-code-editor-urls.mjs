import fs from 'fs';

const p = 'src/app/features/workspace/shared/code-editor/code-editor.component.ts';
let s = fs.readFileSync(p, 'utf8');
const re =
  /  template: `[\s\S]*?`,\r?\n  styles: \[\r?\n    `[\s\S]*?`,\r?\n  \],\r?\n/;
if (!re.test(s)) {
  console.error('no match');
  process.exit(1);
}
s = s.replace(
  re,
  "  templateUrl: './code-editor.component.html',\n  styleUrl: './code-editor.component.scss',\n",
);
fs.writeFileSync(p, s);
console.log('patched');
