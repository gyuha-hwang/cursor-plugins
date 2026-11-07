import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { root, generate } from './generate.mjs';
import { walk } from '../lib/files.mjs';

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)));
env.TMPDIR = realpathSync(tmpdir());
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, env, stdio: 'inherit' });
generate(root, true);
run('node', ['scripts/validate-plugins.mjs']);
run('node', ['scripts/generate-pstack-harness-trees.mjs', '--check']);
run('node', ['scripts/check-pstack-docs.mjs']);
const upstreamTests = walk(join(root, 'pstack/skills')).filter(path => /\/scripts\/test\/[^/]+\.test\.ts$/.test(path));
run('node', ['--disable-warning=ExperimentalWarning', '--test', ...upstreamTests]);
run('npm', ['test', '--prefix', 'codex/pstack']);
