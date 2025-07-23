import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('./utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the external modules before importing the script to be tested.
// Vitest hoists these mocks, so they apply before any imports run.
vi.mock('node:fs', async () => {
  const actualFs = await vi.importActual('node:fs');
  return {
    ...actualFs, // Import and retain default behavior
    promises: {
      ...actualFs.promises,
      readFile: vi.fn(),
      writeFile: vi.fn(),
      readdir: vi.fn().mockResolvedValue([]),
      stat: vi.fn(),
      unlink: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
      cp: vi.fn().mockResolvedValue(undefined),
      access: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    },
         createWriteStream: vi.fn(() => {
      const mockWritable = new stream.Writable({
        write(chunk, encoding, callback) {
          callback(); // Simulate successful write
        },
        final(callback) {
          mockWritable.emit('close');
          callback();
        }
      });
      // Mock 'on' and 'once' if they are explicitly called on the stream instance
      vi.spyOn(mockWritable, 'on');
      vi.spyOn(mockWritable, 'once');
      return mockWritable;
    }),
  };
});

vi.mock('xml2js', () => ({
  default: {
    parseStringPromise: vi.fn(),
    Builder: vi.fn(() => ({
      buildObject: vi.fn((obj) => JSON.stringify(obj)), // Return a simple string for testing
    })),
  }
}));

vi.mock('archiver', async () => {
  const { EventEmitter } = await vi.importActual('node:events');
  class MockArchiver extends EventEmitter {
    constructor() {
      super();
      this.on = vi.fn(this.on.bind(this));
      this.once = vi.fn(this.once.bind(this));
      this.pipe = vi.fn().mockReturnThis();
      this.directory = vi.fn().mockReturnThis();
      this.finalize = vi.fn(function() {
        this.emit('end');
        return Promise.resolve();
      }).bind(this);
      this.pointer = vi.fn().mockReturnValue(1234);
    }
  }
  return { default: vi.fn(() => new MockArchiver()) };
});

vi.mock('node:util', () => ({
  promisify: vi.fn(() => vi.fn(() => Promise.resolve())), // Mock promisify to return a function that returns a resolved Promise
}));

// Import the mocked modules to control their behavior in tests
import { promises as fsPromises } from 'node:fs';
import * as xml2js from 'xml2js';
import archiver from 'archiver';
import path from 'node:path';
import * as stream from 'node:stream';

// Now, import the functions from the script
import { getNewVersion, slugify, main } from './main.js';
import logger from './utils/logger.js';

describe('Build Script Logic (Vitest)', () => {

  // Reset mocks and spies before each test to ensure isolation
  beforeEach(() => {
    vi.restoreAllMocks();
    // Spy on console methods to prevent polluting test output
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('getNewVersion', () => {
    beforeEach(() => {
      // Use fake timers to control the current date in tests
      vi.useFakeTimers();
    });

    afterEach(() => {
      // Restore real timers after each test
      vi.useRealTimers();
    });

    it('should correctly increment the patch version', () => {
      vi.setSystemTime(new Date('2025-07-23T12:00:00Z'));
      const currentVersion = '25.07.01';
      const newVersion = getNewVersion(currentVersion);
      expect(newVersion).toBe('25.07.02');
    });

    it('should reset the patch and increment the month if the month has changed', () => {
      vi.setSystemTime(new Date('2025-08-01T12:00:00Z'));
      const currentVersion = '25.07.99'; // Last version from July
      const newVersion = getNewVersion(currentVersion);
      expect(newVersion).toBe('25.08.01');
    });

    it('should reset patch and month if the year has changed', () => {
      vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));
      const currentVersion = '25.12.30'; // Last version from 2025
      const newVersion = getNewVersion(currentVersion);
      expect(newVersion).toBe('26.01.01');
    });

    it('should fall back to a new version if the current version is invalid', () => {
      vi.setSystemTime(new Date('2025-07-23T12:00:00Z'));
      const newVersion = getNewVersion('invalid-version');
      expect(newVersion).toBe('25.07.01');
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not parse current version'));
    });
  });

  describe('slugify', () => {
    it('should replace spaces with underscores', () => {
      expect(slugify('My Plugin Name')).toBe('My_Plugin_Name');
    });

    it('should replace hyphens with underscores', () => {
      expect(slugify('My-Plugin-Name')).toBe('My_Plugin_Name');
    });

    it('should replace space-hyphen-space with a single underscore', () => {
      expect(slugify('My - Plugin - Name')).toBe('My_Plugin_Name');
    });
  });

  describe('main orchestrator', () => {
    it('should run the full build process in the correct order', async () => {
      // Mock the file reads to provide necessary data
      fsPromises.readFile
        .mockResolvedValueOnce(JSON.stringify({ name: 'Test Plugin', version: '25.07.01' })) // package.json (first read in main)
        .mockResolvedValueOnce(JSON.stringify({ name: 'Test Plugin', version: '25.07.01' })) // package.json (second read in updatePackageVersions)
        .mockResolvedValueOnce('<plugin><name>Test Plugin</name></plugin>'); // plugin.xml

      // Mock the XML parsing
      xml2js.default.parseStringPromise.mockResolvedValue({
        plugin: {
          $: { name: 'Test Plugin', version: '25.07.01' }
        }
      });

      // Mock readdir for pruneArchives to simulate some files
      fsPromises.readdir.mockResolvedValue(['old_archive.zip', 'older_archive.zip']);
      fsPromises.stat.mockResolvedValue({ mtimeMs: Date.now(), isDirectory: () => false });

      // Mock process.exit to prevent the test runner from exiting
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});

      await main();

      // Verify the flow
      expect(fsPromises.readFile).toHaveBeenCalledWith(path.join(process.cwd(), 'package.json'), 'utf8');
      expect(fsPromises.mkdir).toHaveBeenCalledWith(path.join(process.cwd(), 'dist'), { recursive: true });
      expect(fsPromises.writeFile).toHaveBeenCalledWith(path.join(process.cwd(), 'package.json'), expect.any(String));
      expect(fsPromises.cp).toHaveBeenCalled(); // mergePSfolders was called
      expect(archiver).toHaveBeenCalledTimes(2); // createPluginZip called twice
      expect(fsPromises.rm).toHaveBeenCalled(); // pruneArchives was called
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('should exit with an error code if reading package.json fails', async () => {
      // Force an error
      fsPromises.readFile.mockRejectedValue(new Error('File not found'));

      await expect(main()).rejects.toThrow('File not found');
      expect(logger.error).toHaveBeenCalledWith('\n--- BUILD FAILED ---');
      expect(logger.error).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});