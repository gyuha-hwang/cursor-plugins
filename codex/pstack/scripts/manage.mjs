import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, renameSync, rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { git, json, sha256, treeHash } from '../lib/files.mjs';
import { readFileSync } from 'node:fs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const bundle = 'codex/pstack/generated';
const stat = path => lstatSync(path, { throwIfNoEntry: false });
const isLinkTo = (path, target) => stat(path)?.isSymbolicLink() && readlinkSync(path) === target;
function canonical(path) {
  let parent = resolve(path); const tail = [];
  while (!stat(parent)) { tail.unshift(basename(parent)); parent = dirname(parent); }
  return join(realpathSync(parent), ...tail);
}

export function verifyRelease(release) {
  const manifest = json(join(release, bundle, 'manifest.json'));
  if (manifest.schemaVersion !== 1 || manifest.activation !== 'explicit-only' || manifest.model !== 'inherit-parent') throw new Error('Unsupported installation manifest');
  if (!manifest.skills.length || new Set(manifest.skills.map(s => s.name)).size !== manifest.skills.length) throw new Error('Invalid skill list');
  for (const { name } of manifest.skills) if (!/^pstack-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) throw new Error(`Unsafe skill name: ${name}`);
  if (manifest.source.treeHash !== treeHash(join(release, 'pstack'))) throw new Error('Upstream source integrity check failed');
  for (const [path, hash] of Object.entries(manifest.files)) {
    if (path.startsWith('/') || path.split('/').includes('..')) throw new Error('Unsafe manifest path');
    if (sha256(readFileSync(join(release, bundle, path))) !== hash) throw new Error(`Generated file integrity check failed: ${path}`);
  }
  for (const { name } of manifest.skills) {
    if (!manifest.files[`skills/${name}/SKILL.md`] || !manifest.files[`skills/${name}/agents/openai.yaml`]) throw new Error(`Missing entrypoint: ${name}`);
  }
  return manifest;
}

function pointer(home, name) {
  const path = join(home, name);
  if (!stat(path)) return undefined;
  if (!stat(path).isSymbolicLink()) throw new Error(`Unowned pointer, refusing to overwrite: ${path}`);
  const target = readlinkSync(path);
  if (dirname(target) !== join(home, 'releases')) throw new Error(`Pointer outside managed releases: ${path}`);
  verifyRelease(target);
  return target;
}
function swap(home, name, target) {
  const temporary = join(home, `.${name}-${process.pid}`);
  if (stat(temporary)) throw new Error(`Temporary pointer already exists: ${temporary}`);
  symlinkSync(target, temporary);
  try { renameSync(temporary, join(home, name)); } finally { if (stat(temporary)) unlinkSync(temporary); }
}
function ownedLinks(home, skillsDir) {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir).filter(name => /^pstack-[a-z0-9-]+$/.test(name) && isLinkTo(join(skillsDir, name), join(home, 'current', bundle, 'skills', name)));
}
function activate(home, skillsDir, target) {
  const next = verifyRelease(target);
  const current = pointer(home, 'current');
  const previous = pointer(home, 'previous');
  const names = next.skills.map(s => s.name);
  for (const name of names) {
    const path = join(skillsDir, name);
    const expected = join(home, 'current', bundle, 'skills', name);
    if (stat(path) && !isLinkTo(path, expected)) throw new Error(`Existing skill is not owned by this installer: ${path}`);
  }
  const oldNames = ownedLinks(home, skillsDir);
  const added = [];
  mkdirSync(skillsDir, { recursive: true });
  try {
    for (const name of names) {
      const path = join(skillsDir, name);
      if (!stat(path)) { symlinkSync(join(home, 'current', bundle, 'skills', name), path); added.push(path); }
    }
    if (current !== target) {
      if (current) swap(home, 'previous', current);
      swap(home, 'current', target);
    }
  } catch (error) {
    for (const path of added) unlinkSync(path);
    if (current && pointer(home, 'current') === current) {
      if (previous) swap(home, 'previous', previous);
      else if (stat(join(home, 'previous'))) unlinkSync(join(home, 'previous'));
    }
    throw error;
  }
  for (const name of oldNames.filter(n => !names.includes(n))) unlinkSync(join(skillsDir, name));
  return next;
}

export function manage(command, { ref, source = repo, home = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'pstack'), skillsDir = join(homedir(), '.agents/skills') } = {}) {
  home = canonical(home); skillsDir = canonical(skillsDir); source = resolve(source);
  if (command === 'status') {
    const current = pointer(home, 'current');
    if (!current) return { installed: false };
    const manifest = verifyRelease(current);
    const brokenLinks = manifest.skills.filter(({ name }) => !isLinkTo(join(skillsDir, name), join(home, 'current', bundle, 'skills', name))).map(s => s.name);
    return { installed: true, release: current, ...json(join(current, 'install.json')), adapterVersion: manifest.adapterVersion, upstream: manifest.source, activation: manifest.activation, model: manifest.model, counts: Object.fromEntries(['supported', 'conditional', 'unsupported'].map(status => [status, manifest.skills.filter(s => s.status === status).length])), brokenLinks };
  }
  if (!['install', 'update', 'rollback', 'uninstall'].includes(command)) throw new Error('Use install|update --ref <tag-or-commit>, status, rollback, or uninstall');
  mkdirSync(home, { recursive: true });
  const lock = join(home, '.install-lock');
  try { mkdirSync(lock); } catch { throw new Error(`Another installation may be running: ${lock}`); }
  try {
    const current = pointer(home, 'current');
    const previous = pointer(home, 'previous');
    if (command === 'uninstall') {
      for (const name of ownedLinks(home, skillsDir)) unlinkSync(join(skillsDir, name));
      for (const name of ['current', 'previous']) if (stat(join(home, name))) unlinkSync(join(home, name));
      return { installed: false, preserved: join(home, 'releases') };
    }
    if (command === 'rollback') {
      if (!previous) throw new Error('No previous release');
      activate(home, skillsDir, previous);
      return manage('status', { home, skillsDir });
    }
    if (command === 'update' && !current) throw new Error('Install before updating');
    if (!ref || ref.startsWith('-') || !/^[a-zA-Z0-9._/-]+$/.test(ref)) throw new Error('--ref <tag-or-commit> is required');
    const commit = git(source, 'rev-parse', '--verify', `${ref}^{commit}`);
    if (!/^[0-9a-f]{40,64}$/.test(commit)) throw new Error('Invalid commit');
    if (!/^[0-9a-f]{40,64}$/.test(ref) && !git(source, 'tag', '--points-at', commit).split('\n').includes(ref)) throw new Error('--ref must be a full commit SHA or a tag, not a moving branch');
    const releases = join(home, 'releases'); mkdirSync(releases, { recursive: true });
    const target = join(releases, commit);
    if (!existsSync(target)) {
      const staging = mkdtempSync(join(releases, '.stage-'));
      try {
        const archive = execFileSync('git', ['archive', commit, 'pstack', 'codex/pstack/generated'], { cwd: source, maxBuffer: 64 * 1024 * 1024 });
        execFileSync('tar', ['-xf', '-', '-C', staging], { input: archive });
        verifyRelease(staging);
        writeFileSync(join(staging, 'install.json'), JSON.stringify({ commit }, null, 2) + '\n');
        renameSync(staging, target);
      } finally { if (existsSync(staging)) rmSync(staging, { recursive: true }); }
    }
    if (realpathSync(target) !== target) throw new Error('Release path must not redirect outside managed storage');
    activate(home, skillsDir, target);
    return manage('status', { home, skillsDir });
  } finally { rmdirSync(lock); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: { ref: { type: 'string' }, home: { type: 'string' }, 'skills-dir': { type: 'string' } } });
    console.log(JSON.stringify(manage(positionals[0], { ref: values.ref, home: values.home, skillsDir: values['skills-dir'] }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
