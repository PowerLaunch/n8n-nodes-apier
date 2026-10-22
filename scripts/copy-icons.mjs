// tsc does not copy the icon or the codex files; n8n loads them from next to the compiled node file.
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist/nodes/Apier', { recursive: true });
for (const file of ['apier.svg', 'Apier.node.json', 'ApierTrigger.node.json']) {
	copyFileSync(`nodes/Apier/${file}`, `dist/nodes/Apier/${file}`);
}
