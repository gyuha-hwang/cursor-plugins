import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function walk(root) {
  return readdirSync(root).sort().flatMap(name => {
    if (['node_modules', '.git', '.DS_Store', '.in_use'].includes(name)) return [];
    const path = join(root, name);
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat) throw new Error(`Missing file: ${path}`);
    return stat.isDirectory() ? walk(path) : [path];
  });
}
export function treeHash(root) {
  return sha256(walk(root).map(path => `${relative(root, path)}\0${statSync(path).mode & 0o111 ? 'x' : '-'}\0${sha256(readFileSync(path))}\n`).join(''));
}
export const json = path => JSON.parse(readFileSync(path, 'utf8'));
export const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
export const skillNames = root => readdirSync(join(root, 'pstack/skills')).filter(name => {
  try { return statSync(join(root, 'pstack/skills', name, 'SKILL.md')).isFile(); } catch { return false; }
}).sort();
export function sharedHash(root) {
  const source = join(root, 'pstack');
  return sha256(walk(source).filter(path => !relative(source, path).startsWith('skills/')).map(path => `${relative(source, path)}\0${sha256(readFileSync(path))}\n`).join(''));
}
