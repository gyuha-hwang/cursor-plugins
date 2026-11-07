import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { json, sha256, sharedHash, skillNames, treeHash, walk } from '../lib/files.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export function inventory(repo) {
  const registry = json(join(repo, 'codex/pstack/compatibility.json'));
  const lock = json(join(repo, 'codex/pstack/upstream-lock.json'));
  const names = skillNames(repo);
  const problems = [];
  for (const name of new Set([...names, ...Object.keys(registry.skills)])) {
    const entry = registry.skills[name];
    if (!names.includes(name)) problems.push(`Removed upstream skill needs review: ${name}`);
    else if (!entry) problems.push(`Unclassified upstream skill: ${name}`);
    else {
      if (!['supported', 'conditional', 'unsupported'].includes(entry.status)) problems.push(`Invalid support status: ${name}`);
      if (entry.sourceHash !== treeHash(join(repo, 'pstack/skills', name))) problems.push(`Upstream skill changed; review required: ${name}`);
    }
  }
  if (registry.sharedHash !== sharedHash(repo)) problems.push('Upstream shared instructions/resources changed; review required');
  if (lock.treeHash !== treeHash(join(repo, 'pstack'))) problems.push('upstream-lock treeHash does not match pstack');
  if (problems.length) throw new Error(problems.join('\n'));
  return { registry, lock, names };
}

export function render(repo) {
  const { registry, lock, names } = inventory(repo);
  const files = new Map();
  files.set('adapter.md', readFileSync(join(repo, 'codex/pstack/adapter.md'), 'utf8'));
  const version = json(join(repo, 'codex/pstack/package.json')).version;
  const skills = [];
  for (const name of names) {
    const source = readFileSync(join(repo, 'pstack/skills', name, 'SKILL.md'), 'utf8');
    const fm = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) throw new Error(`Missing frontmatter: ${name}`);
    const meta = parse(fm[1]);
    if (meta.name !== name || typeof meta.description !== 'string') throw new Error(`Invalid skill metadata: ${name}`);
    const exposed = `pstack-${name}`;
    if (exposed.length > 64) throw new Error(`Namespaced skill exceeds 64 chars: ${name}`);
    const entry = registry.skills[name];
    let instructions = `# pstack: ${name}\n\n이 스킬은 사용자가 명시적으로 호출했을 때만 적용한다. 먼저 이 파일의 실제 경로를 확인하고 [Codex 어댑터](../../adapter.md)를 읽는다.\n\n`;
    instructions += `지원 상태: **${entry.status}**. ${entry.notes}\n\n`;
    if (entry.status === 'unsupported') instructions += '이 기능은 Cursor 전용이다. 어댑터의 제한을 설명하고 실행하지 않는다. 원본을 따라 자동화나 비밀 요청을 만들지 않는다.\n';
    else if (name === 'setup-pstack') instructions += '모델 설정 파일을 생성하지 않는다. 현재 설치본의 manifest.json과 관리 도구 status 결과를 바탕으로 버전, 명시 호출 방식, 모델 상속, 선택적 도구의 설치 여부를 안내한다.\n';
    else instructions += `[원본 작업 절차](../../../../../pstack/skills/${name}/SKILL.md)를 읽고 수행한다. 원본의 도구·모델·설정·자율권 지침에는 Codex 어댑터를 적용한다. 원본의 다른 스킬 호출은 이 묶음의 이름에 pstack-을 붙여 해석한다.\n`;
    files.set(`skills/${exposed}/SKILL.md`, `---\nname: ${exposed}\ndescription: ${JSON.stringify(`pstack ${name}: ${meta.description.replace(/\/pstack:/g, '$pstack-').replace(/\/([a-z][a-z0-9-]+)/g, '$pstack-$1')}`)}\n---\n\n${instructions}`);
    files.set(`skills/${exposed}/agents/openai.yaml`, 'policy:\n  allow_implicit_invocation: false\n');
    skills.push({ name: exposed, upstreamName: name, ...entry });
  }
  const manifest = {
    schemaVersion: 1, adapterVersion: version, source: lock, activation: 'explicit-only', model: 'inherit-parent',
    skills, files: Object.fromEntries([...files].map(([path, body]) => [path, sha256(body)])),
  };
  files.set('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  return files;
}

export function generate(repo, check = false) {
  const files = render(repo);
  const out = join(repo, 'codex/pstack/generated');
  const actual = existsSync(out) ? walk(out).map(path => relative(out, path)) : [];
  if (check) {
    const drift = [...new Set([...files.keys(), ...actual])].filter(path => !files.has(path) || !existsSync(join(out, path)) || readFileSync(join(out, path), 'utf8') !== files.get(path));
    if (drift.length) throw new Error(`Generated files drifted:\n${drift.join('\n')}`);
  } else {
    if (existsSync(out)) rmSync(out, { recursive: true });
    for (const [path, body] of files) { mkdirSync(dirname(join(out, path)), { recursive: true }); writeFileSync(join(out, path), body); }
  }
  return files;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const files = generate(root, process.argv.includes('--check')); console.log(`${(files.size - 2) / 2} Codex skill entrypoints: ${process.argv.includes('--check') ? 'verified' : 'generated'}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
