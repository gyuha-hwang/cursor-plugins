import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, json, treeHash } from '../lib/files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export function updateDecision({ current, candidate, pending }) {
  if (current === candidate) return 'unchanged';
  if (pending) return 'pending';
  return 'propose';
}
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !/TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)));
export function sync(repo = root, { apply = false, repository = process.env.GITHUB_REPOSITORY || 'gyuha-hwang/cursor-plugins', github, upstream = 'https://github.com/cursor/plugins.git' } = {}) {
  if (repository !== 'gyuha-hwang/cursor-plugins') throw new Error('Updater only writes to gyuha-hwang/cursor-plugins');
  const gh = github || ((...args) => execFileSync('gh', args, { cwd: repo, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim());
  const lock = json(join(repo, 'codex/pstack/upstream-lock.json'));
  const candidate = gh('api', 'repos/cursor/plugins/commits/main', '--jq', '.sha');
  const pending = JSON.parse(gh('pr', 'list', '--repo', repository, '--state', 'open', '--label', 'pstack-upstream', '--json', 'number,url,headRefName'))[0];
  const decision = updateDecision({ current: lock.commit, candidate, pending });
  const summary = { decision, current: lock.commit, candidate, pending: pending?.url };
  if (!apply || decision === 'unchanged' || decision === 'pending') return summary;
  if (git(repo, 'status', '--porcelain')) throw new Error('Updater needs a clean checkout');
  const remote = git(repo, 'config', '--get', 'remote.origin.url');
  if (!/(?:github\.com[:/])gyuha-hwang\/cursor-plugins(?:\.git)?$/.test(remote)) throw new Error('Unexpected origin repository');
  git(repo, 'fetch', 'origin', 'main');
  git(repo, 'fetch', upstream, candidate);
  const relevant = git(repo, 'diff', '--name-only', lock.commit, candidate, '--', 'pstack', 'scripts', 'schemas', '.github/workflows/validate-plugins.yml', '.claude-plugin/marketplace.json');
  if (!relevant) return { ...summary, decision: 'irrelevant' };
  const scratch = mkdtempSync(join(tmpdir(), 'pstack-upstream-'));
  const worktree = join(scratch, 'worktree');
  const branch = `sync/pstack-${candidate.slice(0, 12)}`;
  let added = false;
  try {
    git(repo, 'worktree', 'add', '-b', branch, worktree, 'origin/main'); added = true;
    const identity = ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com'];
    try { git(worktree, ...identity, 'merge', '--no-edit', candidate); }
    catch {
      const conflicts = git(worktree, 'diff', '--name-only', '--diff-filter=U');
      git(worktree, 'merge', '--abort');
      const body = `원본 커밋: ${candidate}\n기준: ${lock.commit}\n\n충돌 파일:\n\n${conflicts.split('\n').map(path => '- ' + path).join('\n')}\n\n자동 병합과 로컬 설치는 수행하지 않았습니다.`;
      const bodyFile = join(scratch, 'conflict.md'); writeFileSync(bodyFile, body);
      const issues = JSON.parse(gh('issue', 'list', '--repo', repository, '--state', 'open', '--label', 'pstack-upstream-blocked', '--json', 'number'));
      if (issues.length) gh('issue', 'edit', String(issues[0].number), '--repo', repository, '--body-file', bodyFile);
      else gh('issue', 'create', '--repo', repository, '--title', 'pstack upstream 동기화 충돌', '--label', 'pstack-upstream-blocked', '--body-file', bodyFile);
      return { ...summary, decision: 'conflict', conflicts };
    }
    const nextLock = { repository: lock.repository, commit: candidate, version: json(join(worktree, 'pstack/plugin.json')).version, treeHash: treeHash(join(worktree, 'pstack')) };
    writeFileSync(join(worktree, 'codex/pstack/upstream-lock.json'), JSON.stringify(nextLock, null, 2) + '\n');
    let error;
    const logFile = join(scratch, 'validation.log');
    const run = (command, args, cwd = worktree) => {
      try { return execFileSync(command, args, { cwd, env: cleanEnv(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); }
      catch (failure) { throw new Error(`${command} ${args.join(' ')}\n${failure.stdout || ''}\n${failure.stderr || ''}`); }
    };
    try {
      let output = run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], join(worktree, 'codex/pstack'));
      output += run('node', ['codex/pstack/scripts/generate.mjs']);
      output += run('npm', ['install', '--no-save', '--no-package-lock', '--ignore-scripts', '--no-audit', '--no-fund', 'ajv@8.17.1', 'ajv-formats@3.0.1', 'fast-check@4.5.3']);
      output += run('node', ['codex/pstack/scripts/check.mjs']);
      writeFileSync(logFile, output);
    } catch (failure) { error = failure.message; writeFileSync(logFile, error); }
    git(worktree, 'add', 'codex/pstack/upstream-lock.json', 'codex/pstack/generated');
    git(worktree, ...identity, 'commit', '-m', `chore(codex): sync pstack ${nextLock.version} (${candidate.slice(0, 12)})`);
    git(worktree, 'push', 'origin', `HEAD:refs/heads/${branch}`);
    const body = `## 변경\n\n- pstack ${lock.version} → ${nextLock.version}\n- upstream ${lock.commit} → ${candidate}\n- 전체 upstream 이력을 병합하므로 다른 플러그인 변경도 포함될 수 있습니다.\n\n## 검증\n\n${error ? '호환성 검토 또는 검사 실패로 Draft입니다. compatibility.json의 지원 상태와 변경된 원본을 검토한 뒤 review.mjs로 지문을 갱신하고 다시 검사하세요.' : '원본 검사, Codex 생성 검사, 설치·업데이트 테스트를 통과했습니다. 실제 Codex 모델 실행 및 UI·외부 서비스 검증은 이 워크플로에서 실행하지 않았습니다.'}\n\n실행: ${process.env.GITHUB_RUN_ID ? `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}` : '수동 실행'}\n\n<details><summary>검사 결과</summary>\n\n\`\`\`text\n${readFileSync(logFile, 'utf8').slice(-20000).replaceAll('```', "'''")}\n\`\`\`\n</details>\n\n자동 병합 및 로컬 설치본 갱신은 하지 않습니다.`;
    const bodyFile = join(scratch, 'pr.md'); writeFileSync(bodyFile, body);
    const args = ['pr', 'create', '--repo', repository, '--base', 'main', '--head', branch, '--title', `chore(codex): pstack ${nextLock.version} upstream 갱신`, '--label', 'pstack-upstream', '--body-file', bodyFile];
    if (error) args.push('--draft');
    const url = gh(...args);
    return { ...summary, decision: error ? 'draft' : 'ready', url };
  } finally {
    if (added) {
      for (const relative of ['node_modules', 'codex/pstack/node_modules']) {
        const path = join(worktree, relative);
        if (existsSync(path)) rmSync(path, { recursive: true });
      }
      git(repo, 'worktree', 'remove', worktree);
    }
    if (existsSync(scratch)) rmSync(scratch, { recursive: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--apply') && process.argv.includes('--dry-run')) throw new Error('Choose either --apply or --dry-run');
    console.log(JSON.stringify(sync(root, { apply: process.argv.includes('--apply') }), null, 2));
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
