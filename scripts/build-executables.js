#!/usr/bin/env node
// Script to build executables for all platforms
// This script is for LOCAL testing only
// Production builds happen in GitHub Actions

import { spawn } from 'node:child_process';
import { platform, arch } from 'node:os';

const targets = [
  { os: 'darwin', arch: 'x64', output: 'ps-package-darwin-x64' },
  { os: 'darwin', arch: 'arm64', output: 'ps-package-darwin-arm64' },
  { os: 'linux', arch: 'x64', output: 'ps-package-linux-x64' },
  { os: 'windows', arch: 'x64', output: 'ps-package-windows-x64.exe' },
];

const currentPlatform = platform();
const currentArch = arch();

console.log(`Building executable for ${currentPlatform}-${currentArch}...`);

// Only build for current platform during local development
const target = targets.find(t =>
  t.os === currentPlatform && t.arch === currentArch
);

if (!target) {
  console.error(`No target configuration for ${currentPlatform}-${currentArch}`);
  process.exit(1);
}

const args = [
  'build',
  '--compile',
  '--minify',
  '--sourcemap',
  '--target', 'bun',
  '--outfile', `./bin/${target.output}`,
  './index.js'
];

const proc = spawn('bun', args, { stdio: 'inherit' });

proc.on('exit', (code) => {
  if (code === 0) {
    console.log(`✓ Built: bin/${target.output}`);
  } else {
    console.error(`✗ Build failed with code ${code}`);
    process.exit(code);
  }
});
