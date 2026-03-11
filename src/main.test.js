import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import * as xml2js from 'xml2js';
import archiver from 'archiver';
import path from 'node:path';
import * as stream from 'node:stream';

// Mock the external modules before importing the script to be tested.
// Vitest hoists these mocks, so they apply before any imports run.
vi.mock('node:fs', () => ({
  promises: {
    readdir: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
    access: vi.fn(),
    cp: vi.fn(),
    readFile: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    rm: vi.fn(),
  },
  createWriteStream: vi.fn(), // Mock createWriteStream as it's used directly from 'node:fs'
}));
// [rest of file unchanged]
