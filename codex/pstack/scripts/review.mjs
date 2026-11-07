import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { root, generate } from './generate.mjs';
import { git, json, sharedHash, skillNames, treeHash } from '../lib/files.mjs';

export function recordReview(repo, { source, skills = [], shared = false }) {
  if (!source || source.startsWith('-')) throw new Error('--source <upstream commit> is required');
  const commit = git(repo, 'rev-parse', '--verify', `${source}^{commit}`);
  git(repo, 'merge-base', '--is-ancestor', commit, 'HEAD');
  if (git(repo, 'diff', commit, '--', 'pstack')) throw new Error('pstack must match the selected upstream commit');
  if (git(repo, 'ls-files', '--others', '--exclude-standard', '--', 'pstack')) throw new Error('Untracked pstack files must be reviewed separately');
  const registry = json(join(repo, 'codex/pstack/compatibility.json'));
  const names = skillNames(repo);
  for (const name of skills) {
    if (!registry.skills[name]) throw new Error(`Classify the skill in compatibility.json first: ${name}`);
    if (!names.includes(name)) delete registry.skills[name];
    else registry.skills[name].sourceHash = treeHash(join(repo, 'pstack/skills', name));
  }
  if (shared) registry.sharedHash = sharedHash(repo);
  const lock = { repository: 'https://github.com/cursor/plugins', commit, version: json(join(repo, 'pstack/plugin.json')).version, treeHash: treeHash(join(repo, 'pstack')) };
  writeFileSync(join(repo, 'codex/pstack/compatibility.json'), JSON.stringify(registry, null, 2) + '\n');
  writeFileSync(join(repo, 'codex/pstack/upstream-lock.json'), JSON.stringify(lock, null, 2) + '\n');
  generate(repo);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { source: { type: 'string' }, skill: { type: 'string', multiple: true }, shared: { type: 'boolean' } } });
    if (!values.skill?.length && !values.shared) throw new Error('Select --skill <name> and/or --shared after reviewing the upstream diff');
    recordReview(root, { source: values.source, skills: values.skill, shared: values.shared });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
