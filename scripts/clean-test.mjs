import { rmSync } from 'node:fs';

rmSync(new URL('../dist-test/', import.meta.url), { recursive: true, force: true });
