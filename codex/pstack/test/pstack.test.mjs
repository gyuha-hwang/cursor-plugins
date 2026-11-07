import { test } from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { generate, render } from '../scripts/generate.mjs';
import { manage } from '../scripts/manage.mjs';
import { sync, updateDecision } from '../scripts/sync-upstream.mjs';
import { recordReview } from '../scripts/review.mjs';
import { git, json, sha256, sharedHash, treeHash, walk } from '../lib/files.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function fixture(t) {
  const temp = mkdtempSync(join(tmpdir(), 'pstack-codex-test-'));
  t.after(() => rmSync(temp, { recursive: true }));
  const repo = join(temp, 'source');
  const write = (path, body) => { mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), body); };
  write('pstack/plugin.json', JSON.stringify({ version: '0.1.0' }));
  write('pstack/LICENSE', 'MIT fixture');
  write('pstack/README.md', '# Fixture\n');
  for (const name of ['alpha', 'beta']) write(`pstack/skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: "Inspect an observable ${name} behavior."\n---\n\n# ${name}\n\nInspect the code and report evidence.\n`);
  write('pstack/skills/alpha/scripts/run', '#!/bin/sh\nexit 0\n');
  chmodSync(join(repo, 'pstack/skills/alpha/scripts/run'), 0o755);
  git(repo, 'init', '-q'); git(repo, 'config', 'user.name', 'Fixture'); git(repo, 'config', 'user.email', 'fixture@example.invalid');
  const commit = () => { git(repo, 'add', '.'); git(repo, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture'); return git(repo, 'rev-parse', 'HEAD'); };
  const upstream = commit();
  write('codex/pstack/package.json', JSON.stringify({ version: '1.0.0' }));
  cpSync(join(packageRoot, 'adapter.md'), join(repo, 'codex/pstack/adapter.md'));
  const skills = Object.fromEntries(['alpha', 'beta'].map(name => [name, { status: 'supported', requirements: [], notes: 'Fixture', sourceHash: treeHash(join(repo, 'pstack/skills', name)) }]));
  write('codex/pstack/compatibility.json', JSON.stringify({ schemaVersion: 1, sharedHash: sharedHash(repo), skills }));
  write('codex/pstack/upstream-lock.json', JSON.stringify({ version: '0.1.0', commit: upstream, treeHash: treeHash(join(repo, 'pstack')) }));
  generate(repo);
  const first = commit();
  const home = join(temp, 'pstack'); const skillsDir = join(temp, 'user-skills');
  const options = { source: repo, home, skillsDir, ref: first };
  const advance = (version = '1.0.1') => { write('codex/pstack/package.json', JSON.stringify({ version })); generate(repo); return commit(); };
  return { temp, repo, home, skillsDir, write, commit, upstream, first, options, advance };
}

function releaseWithSkills(f, names) {
  const original = json(join(f.repo, 'codex/pstack/compatibility.json'));
  for (const name of Object.keys(original.skills)) if (!names.includes(name)) rmSync(join(f.repo, 'pstack/skills', name), { recursive: true });
  for (const name of names) if (!original.skills[name]) f.write(`pstack/skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: Fixture\n---\n# Fixture\n`);
  original.skills = Object.fromEntries(names.map(name => [name, { status: 'supported', requirements: [], notes: 'Fixture', sourceHash: treeHash(join(f.repo, 'pstack/skills', name)) }]));
  f.write('codex/pstack/compatibility.json', JSON.stringify(original));
  const lock = json(join(f.repo, 'codex/pstack/upstream-lock.json'));
  f.write('codex/pstack/upstream-lock.json', JSON.stringify({ ...lock, treeHash: treeHash(join(f.repo, 'pstack')) }));
  return f.advance();
}

function withUnlinkFailure(path, operation) {
  path = join(realpathSync(dirname(path)), basename(path));
  const original = fs.unlinkSync;
  fs.unlinkSync = candidate => {
    if (candidate === path) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    return original(candidate);
  };
  syncBuiltinESMExports();
  try { operation(); } finally { fs.unlinkSync = original; syncBuiltinESMExports(); }
}

test('generated entrypoints expose namespaced skills with explicit-only YAML and working original links', t => {
  const f = fixture(t);
  const files = render(f.repo);
  const manifest = JSON.parse(files.get('manifest.json'));
  assert.equal(manifest.skills.length, 2);
  for (const { name, upstreamName } of manifest.skills) {
    assert.equal(parse(files.get(`skills/${name}/agents/openai.yaml`)).policy.allow_implicit_invocation, false);
    const body = files.get(`skills/${name}/SKILL.md`);
    assert.equal(parse(body.match(/^---\n([\s\S]*?)\n---/)[1]).name, name);
    const original = resolve(f.repo, 'codex/pstack/generated/skills', name, '../../../../../pstack/skills', upstreamName, 'SKILL.md');
    assert.ok(existsSync(original));
  }
  generate(f.repo, true);
});
test('generation is deterministic and does not modify upstream', t => {
  const f = fixture(t); const before = treeHash(join(f.repo, 'pstack'));
  const first = render(f.repo); generate(f.repo); assert.deepEqual(render(f.repo), first);
  assert.equal(treeHash(join(f.repo, 'pstack')), before);
});
test('changed instructions require an explicit compatibility review', t => {
  const f = fixture(t); f.write('pstack/skills/alpha/SKILL.md', readFileSync(join(f.repo, 'pstack/skills/alpha/SKILL.md'), 'utf8') + '\nUse a new UnavailableTool.\n');
  assert.throws(() => generate(f.repo), /review required: alpha/);
  const source = f.commit();
  recordReview(f.repo, { source, skills: ['alpha'] }); generate(f.repo, true);
});
test('new and removed skills cannot silently enter or leave the bundle', t => {
  const f = fixture(t); f.write('pstack/skills/gamma/SKILL.md', '---\nname: gamma\ndescription: New\n---\n');
  assert.throws(() => render(f.repo), /Unclassified upstream skill: gamma/);
  rmSync(join(f.repo, 'pstack/skills/beta'), { recursive: true });
  assert.throws(() => render(f.repo), /Removed upstream skill needs review: beta/);
});
test('shared resource drift and generated drift fail checks', t => {
  const f = fixture(t); f.write('codex/pstack/generated/adapter.md', 'changed');
  assert.throws(() => generate(f.repo, true), /Generated files drifted/);
  f.write('pstack/README.md', 'Changed shared instructions');
  assert.throws(() => render(f.repo), /shared instructions\/resources changed/);
});
test('review refuses a source commit that does not match upstream files', t => {
  const f = fixture(t); f.write('pstack/README.md', 'uncommitted');
  assert.throws(() => recordReview(f.repo, { source: f.upstream, shared: true }), /must match/);
});
test('installation survives source checkout removal and retains executable resources', t => {
  const f = fixture(t); const status = manage('install', f.options);
  assert.equal(status.counts.supported, 2); assert.deepEqual(status.brokenLinks, []);
  rmSync(f.repo, { recursive: true });
  assert.ok(readFileSync(join(f.skillsDir, 'pstack-alpha/SKILL.md'), 'utf8').includes('pstack-alpha'));
  assert.ok(lstatSync(join(status.release, 'pstack/skills/alpha/scripts/run')).mode & 0o111);
  assert.equal(manage('status', f.options).installed, true);
});
test('reinstall is idempotent and does not overwrite rollback history', t => {
  const f = fixture(t); manage('install', f.options);
  assert.equal(manage('install', f.options).commit, f.first);
  assert.equal(existsSync(join(f.home, 'previous')), false);
});
test('update and rollback switch all links to the selected version', t => {
  const f = fixture(t); manage('install', f.options); const next = f.advance();
  assert.equal(manage('update', { ...f.options, ref: next }).adapterVersion, '1.0.1');
  const firstPointer = readlinkSync(join(f.home, 'previous'));
  assert.equal(manage('rollback', f.options).commit, f.first);
  assert.equal(readlinkSync(join(f.home, 'current')), firstPointer);
  assert.equal(manage('rollback', f.options).commit, next);
});
test('rollback restores a healthy previous release even when current bytes are corrupt', t => {
  const f = fixture(t); manage('install', f.options); const next = f.advance();
  const current = manage('update', { ...f.options, ref: next });
  writeFileSync(join(current.release, 'pstack/skills/alpha/SKILL.md'), 'corrupt');
  const restored = manage('rollback', f.options);
  assert.equal(restored.commit, f.first); assert.deepEqual(restored.brokenLinks, []);
  assert.equal(readFileSync(join(current.release, 'pstack/skills/alpha/SKILL.md'), 'utf8'), 'corrupt');
});
test('a healthy update preserves the last good rollback release when current is corrupt', t => {
  const f = fixture(t); manage('install', f.options); const second = f.advance();
  const current = manage('update', { ...f.options, ref: second });
  writeFileSync(join(current.release, 'pstack/skills/alpha/SKILL.md'), 'corrupt');
  assert.equal(manage('status', f.options).healthy, false);
  const third = f.advance('1.0.2');
  assert.equal(manage('update', { ...f.options, ref: third }).commit, third);
  assert.equal(manage('rollback', f.options).commit, f.first);
});
test('corrupt previous content does not block update or uninstall', t => {
  const f = fixture(t); const first = manage('install', f.options); const second = f.advance();
  manage('update', { ...f.options, ref: second });
  writeFileSync(join(first.release, 'pstack/skills/alpha/SKILL.md'), 'corrupt');
  assert.throws(() => manage('rollback', f.options), /integrity check failed/);
  assert.equal(manage('status', f.options).commit, second);
  const third = f.advance('1.0.2');
  assert.equal(manage('update', { ...f.options, ref: third }).commit, third);
  assert.equal(manage('uninstall', f.options).installed, false);
});
test('uninstall can detach a corrupt current release without deleting preserved data', t => {
  const f = fixture(t); const current = manage('install', f.options);
  writeFileSync(join(current.release, 'pstack/skills/alpha/SKILL.md'), 'corrupt');
  assert.equal(manage('uninstall', f.options).installed, false);
  assert.equal(existsSync(join(f.skillsDir, 'pstack-alpha')), false);
  assert.equal(readFileSync(join(current.release, 'pstack/skills/alpha/SKILL.md'), 'utf8'), 'corrupt');
});
test('uninstall refuses pointers outside the owned release directory', t => {
  const f = fixture(t); manage('install', f.options);
  rmSync(join(f.home, 'current')); symlinkSync(f.repo, join(f.home, 'current'));
  assert.throws(() => manage('uninstall', f.options), /outside managed releases/);
  assert.equal(readlinkSync(join(f.home, 'current')), f.repo);
});
test('failure removing a retired skill keeps the old release and all links', t => {
  const f = fixture(t); manage('install', f.options);
  const next = releaseWithSkills(f, ['alpha']);
  const before = readlinkSync(join(f.home, 'current'));
  const retired = join(f.skillsDir, 'pstack-beta');
  withUnlinkFailure(retired, () => assert.throws(() => manage('update', { ...f.options, ref: next }), { code: 'EACCES' }));
  assert.equal(readlinkSync(join(f.home, 'current')), before);
  assert.equal(existsSync(join(f.home, 'previous')), false);
  assert.ok(existsSync(retired)); assert.deepEqual(manage('status', f.options).brokenLinks, []);
});
test('a partial retired-link failure restores earlier removals and removes new links', t => {
  const f = fixture(t); manage('install', f.options);
  const next = releaseWithSkills(f, ['gamma']);
  withUnlinkFailure(join(f.skillsDir, 'pstack-beta'), () => assert.throws(() => manage('update', { ...f.options, ref: next }), { code: 'EACCES' }));
  assert.equal(manage('status', f.options).commit, f.first);
  assert.deepEqual(manage('status', f.options).brokenLinks, []);
  assert.equal(existsSync(join(f.skillsDir, 'pstack-gamma')), false);
});
test('failure switching current restores previous and the complete skill link set', t => {
  const f = fixture(t); manage('install', f.options); const second = f.advance();
  manage('update', { ...f.options, ref: second });
  const beforeCurrent = readlinkSync(join(f.home, 'current'));
  const beforePrevious = readlinkSync(join(f.home, 'previous'));
  const next = releaseWithSkills(f, ['gamma']);
  const original = fs.renameSync; const current = join(realpathSync(f.home), 'current');
  fs.renameSync = (from, to) => {
    if (to === current) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    return original(from, to);
  };
  syncBuiltinESMExports();
  try { assert.throws(() => manage('update', { ...f.options, ref: next }), { code: 'EACCES' }); }
  finally { fs.renameSync = original; syncBuiltinESMExports(); }
  assert.equal(readlinkSync(join(f.home, 'current')), beforeCurrent);
  assert.equal(readlinkSync(join(f.home, 'previous')), beforePrevious);
  assert.deepEqual(manage('status', f.options).brokenLinks, []);
  assert.equal(existsSync(join(f.skillsDir, 'pstack-gamma')), false);
});
test('same-name files are preserved on initial install and update', t => {
  const f = fixture(t); mkdirSync(f.skillsDir); writeFileSync(join(f.skillsDir, 'pstack-alpha'), 'user work');
  assert.throws(() => manage('install', f.options), /not owned/);
  assert.equal(readFileSync(join(f.skillsDir, 'pstack-alpha'), 'utf8'), 'user work');
  assert.equal(existsSync(join(f.home, 'current')), false);
});
test('a user replacement of an installed link blocks updates and is preserved', t => {
  const f = fixture(t); manage('install', f.options); const next = f.advance();
  rmSync(join(f.skillsDir, 'pstack-alpha')); writeFileSync(join(f.skillsDir, 'pstack-alpha'), 'user replacement');
  assert.throws(() => manage('update', { ...f.options, ref: next }), /not owned/);
  assert.equal(manage('status', f.options).commit, f.first);
  assert.equal(readFileSync(join(f.skillsDir, 'pstack-alpha'), 'utf8'), 'user replacement');
});
test('failed update leaves the current installation usable', t => {
  const f = fixture(t); manage('install', f.options); const before = readlinkSync(join(f.home, 'current'));
  assert.throws(() => manage('update', { ...f.options, ref: 'missing-tag' }));
  assert.equal(readlinkSync(join(f.home, 'current')), before);
  assert.equal(manage('status', f.options).commit, f.first);
});
test('moving branch refs cannot be installed as a tested release', t => {
  const f = fixture(t); assert.throws(() => manage('install', { ...f.options, ref: git(f.repo, 'branch', '--show-current') }), /not a moving branch/);
});
test('corrupt generated files or upstream sources cannot be installed', t => {
  const f = fixture(t); f.write('codex/pstack/generated/adapter.md', 'corrupt'); const bad = f.commit();
  assert.throws(() => manage('install', { ...f.options, ref: bad }), /integrity check failed/);
  assert.equal(existsSync(join(f.home, 'current')), false);
});
test('installation lock prevents concurrent mutation', t => {
  const f = fixture(t); mkdirSync(join(f.home, '.install-lock'), { recursive: true });
  assert.throws(() => manage('install', f.options), /Another installation/);
});
test('uninstall preserves source, releases and unowned skills', t => {
  const f = fixture(t); const installed = manage('install', f.options);
  writeFileSync(join(f.skillsDir, 'pstack-user'), 'preserve');
  symlinkSync(f.repo, join(f.skillsDir, 'pstack-unowned-link'));
  manage('uninstall', f.options);
  assert.ok(existsSync(installed.release)); assert.ok(existsSync(f.repo));
  assert.equal(readFileSync(join(f.skillsDir, 'pstack-user'), 'utf8'), 'preserve');
  assert.ok(lstatSync(join(f.skillsDir, 'pstack-unowned-link')).isSymbolicLink());
  assert.equal(existsSync(join(f.skillsDir, 'pstack-alpha')), false);
});
test('status identifies broken links without changing them', t => {
  const f = fixture(t); manage('install', f.options); rmSync(join(f.skillsDir, 'pstack-alpha'));
  assert.deepEqual(manage('status', f.options).brokenLinks, ['pstack-alpha']);
});
test('updater ignores unchanged source and avoids duplicate pending PRs', () => {
  assert.equal(updateDecision({ current: 'a', candidate: 'a' }), 'unchanged');
  assert.equal(updateDecision({ current: 'a', candidate: 'b', pending: {} }), 'pending');
  assert.equal(updateDecision({ current: 'a', candidate: 'b' }), 'propose');
});
test('updater detects disabled Issues before attempting Git changes or conflict reporting', t => {
  const f = fixture(t); const calls = [];
  const github = (...args) => {
    calls.push(args);
    if (args[0] === 'api' && args[1] === 'repos/gyuha-hwang/cursor-plugins') return '{"has_issues":false}';
    throw new Error(`Unexpected GitHub call: ${args}`);
  };
  assert.throws(() => sync(f.repo, { apply: true, github }), /Issues.*enabled/);
  assert.equal(calls.length, 1);
  assert.equal(git(f.repo, 'status', '--porcelain'), '');
  assert.equal(git(f.repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm).length, 1);
});
test('updater creates a Draft for an actual changed upstream in isolated Git remotes', t => {
  const f = fixture(t);
  f.write('.gitignore', 'node_modules/\n');
  for (const name of ['package.json', 'package-lock.json', 'scripts', 'lib']) cpSync(join(packageRoot, name), join(f.repo, 'codex/pstack', name), { recursive: true });
  git(f.repo, 'branch', '-M', 'main'); f.commit();
  const remote = join(f.temp, 'origin.git'); git(f.temp, 'clone', '--bare', f.repo, remote);
  git(f.repo, 'remote', 'add', 'origin', 'https://github.com/gyuha-hwang/cursor-plugins.git');
  git(f.repo, 'config', `url.${remote}.insteadOf`, 'https://github.com/gyuha-hwang/cursor-plugins.git');
  const upstream = join(f.temp, 'upstream'); git(f.temp, 'clone', f.repo, upstream);
  git(upstream, 'config', 'user.name', 'Upstream fixture'); git(upstream, 'config', 'user.email', 'upstream@example.invalid');
  writeFileSync(join(upstream, 'pstack/skills/alpha/SKILL.md'), readFileSync(join(upstream, 'pstack/skills/alpha/SKILL.md'), 'utf8') + '\nNew behavior requiring review.\n');
  git(upstream, 'add', '.'); git(upstream, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'upstream change');
  const candidate = git(upstream, 'rev-parse', 'HEAD'); const main = git(f.repo, 'rev-parse', 'HEAD');
  const bin = join(f.temp, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'npm'), `#!/bin/sh\nln -s '${join(packageRoot, 'node_modules')}' node_modules\n`, { mode: 0o755 });
  const before = process.env.PATH; process.env.PATH = `${bin}:${before}`;
  t.after(() => { process.env.PATH = before; });
  const calls = [];
  const github = (...args) => {
    calls.push(args);
    if (args[0] === 'api' && args[1] === 'repos/gyuha-hwang/cursor-plugins') return '{"has_issues":true}';
    if (args[0] === 'api') return candidate;
    if (args[0] === 'pr' && args[1] === 'list') return '[]';
    if (args[0] === 'pr' && args[1] === 'create') {
      const body = readFileSync(args[args.indexOf('--body-file') + 1], 'utf8');
      assert.ok(body.includes('review required: alpha')); assert.ok(args.includes('--draft'));
      return 'https://example.invalid/fixture/pr/1';
    }
    throw new Error(`Unexpected GitHub call: ${args}`);
  };
  const result = sync(f.repo, { apply: true, github, upstream });
  assert.equal(result.decision, 'draft');
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), main);
  assert.equal(git(f.repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm).length, 1);
  assert.ok(calls.some(args => args[0] === 'pr' && args[1] === 'create'));
});
test('an actual upstream merge conflict is reported without modifying main or creating a PR', t => {
  const f = fixture(t); git(f.repo, 'branch', '-M', 'main');
  const upstream = join(f.temp, 'upstream'); git(f.temp, 'clone', f.repo, upstream);
  git(upstream, 'config', 'user.name', 'Fixture'); git(upstream, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(upstream, 'pstack/README.md'), 'upstream content\n');
  git(upstream, 'add', '.'); git(upstream, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'upstream conflict');
  f.write('pstack/README.md', 'local content\n'); const main = f.commit();
  const candidate = git(upstream, 'rev-parse', 'HEAD');
  const remote = join(f.temp, 'origin.git'); git(f.temp, 'clone', '--bare', f.repo, remote);
  git(f.repo, 'remote', 'add', 'origin', 'https://github.com/gyuha-hwang/cursor-plugins.git');
  git(f.repo, 'config', `url.${remote}.insteadOf`, 'https://github.com/gyuha-hwang/cursor-plugins.git');
  let reported = false;
  const github = (...args) => {
    if (args[0] === 'api' && args[1] === 'repos/gyuha-hwang/cursor-plugins') return '{"has_issues":true}';
    if (args[0] === 'api') return candidate;
    if ((args[0] === 'pr' || args[0] === 'issue') && args[1] === 'list') return '[]';
    if (args[0] === 'issue' && args[1] === 'create') {
      assert.ok(readFileSync(args[args.indexOf('--body-file') + 1], 'utf8').includes('pstack/README.md'));
      reported = true; return 'https://example.invalid/issue/1';
    }
    throw new Error(`Unexpected GitHub call: ${args}`);
  };
  const result = sync(f.repo, { apply: true, github, upstream });
  assert.equal(result.decision, 'conflict'); assert.ok(reported);
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), main);
  assert.equal(git(f.repo, 'status', '--porcelain'), '');
  assert.equal(git(f.repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm).length, 1);
});
test('all real entrypoints and their local links resolve', () => {
  const repo = resolve(packageRoot, '../..'); const files = render(repo);
  const out = join(repo, 'codex/pstack/generated');
  for (const [path, body] of files) {
    if (!path.endsWith('.md')) continue;
    for (const [, href] of body.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/i.test(href)) continue;
      const target = resolve(out, dirname(path), href.split('#')[0]);
      assert.ok(existsSync(target), `${path}: ${href}`);
    }
  }
  assert.equal(JSON.parse(files.get('manifest.json')).skills.length, Object.keys(json(join(repo, 'codex/pstack/compatibility.json')).skills).length);
});
