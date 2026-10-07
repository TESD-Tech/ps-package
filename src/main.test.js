import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

vi.mock('./utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { main, config, getNewVersion } = await import('./main.js');

const PLUGIN_XML = name => `<?xml version="1.0" encoding="UTF-8"?>
<plugin version="26.09.99" name="${name}" description="d"><oauth accessLevelV1Api="FULL"/></plugin>`;

let root;
const original = { ...config };

function write(rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(root, rel));
const zipEntries = zip => execFileSync('unzip', ['-Z1', path.join(root, 'plugin_archive', zip)], { encoding: 'utf8' }).split('\n').filter(Boolean);

function scaffold({ name = 'Test Plugin', pkg = {} } = {}) {
  write('package.json', JSON.stringify({ name: 'tp', version: '26.09.99', ...pkg }, null, 2));
  write('plugin.xml', PLUGIN_XML(name));
  write('src/powerschool/WEB_ROOT/new.html', '<p>new</p>');
  write('src/powerschool/pagecataloging/a.json', JSON.stringify({ version: '26.09.99' }, null, 2));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-package-'));
  Object.assign(config, original, {
    projectRoot: root,
    sourceDir: path.join(root, 'src'),
    buildDir: path.join(root, 'dist'),
    archiveDir: path.join(root, 'plugin_archive'),
    schemaDir: path.join(root, 'schema'),
    powerSchoolSourceDir: path.join(root, 'src', 'powerschool'),
  });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('getNewVersion', () => {
  it('increments the patch within the same month and resets on a new month', () => {
    const now = new Date();
    const yy = String(now.getFullYear() % 100);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    expect(getNewVersion(`${yy}.${mm}.01`)).toBe(`${yy}.${mm}.02`);
    expect(getNewVersion('20.01.07')).toBe(`${yy}.${mm}.01`);
  });
});

describe('main: consecutive builds', () => {
  it('produces .01 then .02 without overwriting', async () => {
    scaffold();
    await main();
    await main();
    const zips = fs.readdirSync(config.archiveDir).filter(f => !f.startsWith('DATA-'));
    expect(zips).toHaveLength(2);
    expect(JSON.parse(read('package.json')).version).toMatch(/\.02$/);
  });
});

describe('main: stale build output', () => {
  it('does not ship files left over in dist/ or schema/', async () => {
    scaffold();
    write('dist/WEB_ROOT/old.html', 'stale');
    write('schema/user_schema_root/old.xml', 'stale');
    await main();
    expect(exists('dist/WEB_ROOT/old.html')).toBe(false);
    expect(exists('schema/user_schema_root/old.xml')).toBe(false);
    const zip = fs.readdirSync(config.archiveDir).find(f => !f.startsWith('DATA-'));
    expect(zipEntries(zip)).toContain('WEB_ROOT/new.html');
    expect(zipEntries(zip)).not.toContain('WEB_ROOT/old.html');
  });
});

describe('main: failed build', () => {
  it('leaves package.json, plugin.xml and pagecataloging untouched', async () => {
    scaffold({ name: 'Bad..Name' });
    const before = ['package.json', 'plugin.xml', 'src/powerschool/pagecataloging/a.json'].map(read);
    await expect(main()).rejects.toThrow();
    const after = ['package.json', 'plugin.xml', 'src/powerschool/pagecataloging/a.json'].map(read);
    expect(after).toEqual(before);
  });
});

describe('main: pagecataloging rewrites', () => {
  it('does not rewrite JSON files that have no version key', async () => {
    scaffold();
    const raw = '{\n    "no": "version"\n}';
    write('src/powerschool/pagecataloging/b.json', raw);
    await main();
    expect(read('src/powerschool/pagecataloging/b.json')).toBe(raw);
    expect(JSON.parse(read('src/powerschool/pagecataloging/a.json')).version).toMatch(/^\d\d\.\d\d\.01$/);
  });
});

describe('main: archive pruning', () => {
  it('keeps N previous builds (zip + DATA pair) plus the new one', async () => {
    scaffold();
    config.archivesToKeep = 2;
    write('plugin_archive/.keep', '');
    for (let i = 1; i <= 4; i++) {
      for (const prefix of ['', 'DATA-']) {
        const rel = `plugin_archive/${prefix}Test_Plugin-25.01.0${i}.zip`;
        write(rel, 'x');
        const t = new Date(2025, 0, i);
        fs.utimesSync(path.join(root, rel), t, t);
      }
    }
    await main();
    const files = fs.readdirSync(config.archiveDir).filter(f => f.endsWith('.zip')).sort();
    expect(files).toHaveLength(6);
    expect(files.some(f => f.includes('25.01.01'))).toBe(false);
    expect(files.some(f => f.includes('25.01.02'))).toBe(false);
    expect(exists('plugin_archive/.keep')).toBe(true);
  });
});

describe('main: projectType', () => {
  it('copies public/build into WEB_ROOT when package.json sets svelte', async () => {
    scaffold({ pkg: { 'ps-package': { projectType: 'svelte' } } });
    write('public/build/bundle.js', 'x');
    await main();
    expect(exists('dist/WEB_ROOT/Test_Plugin/bundle.js')).toBe(true);
  });
});
