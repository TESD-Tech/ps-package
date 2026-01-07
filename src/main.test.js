import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { EventEmitter } from 'node:events';
import path from 'node:path';

// Create mock implementations
const mockFs = {
  promises: {
    readdir: mock(),
    stat: mock(),
    unlink: mock(),
    access: mock(),
    cp: mock(),
    readFile: mock(),
    mkdir: mock(),
    writeFile: mock(),
    rm: mock(),
  },
  createWriteStream: mock(),
};

const mockLogger = {
  info: mock(),
  warn: mock(),
  error: mock(),
};

// Create a Builder class for xml2js mock
class MockBuilder {
  constructor() {
    this.buildObject = mock((obj) => JSON.stringify(obj));
  }
}

const mockXml2js = {
  default: {
    parseStringPromise: mock(),
    Builder: MockBuilder,
  }
};

class MockArchiver extends EventEmitter {
  constructor() {
    super();
    this.on = mock(this.on.bind(this));
    this.once = mock(this.once.bind(this));
    this.pipe = mock(() => this);
    this.directory = mock(() => this);
    this.finalize = mock(() => {
      this.emit('end');
      return Promise.resolve();
    });
    this.pointer = mock(() => 1234);
  }
}

const mockArchiver = mock(() => new MockArchiver());

const mockUtil = {
  promisify: mock(() => mock(() => Promise.resolve())),
};

// Mock modules
mock.module('node:fs', () => mockFs);
mock.module('./utils/logger.js', () => ({ default: mockLogger }));
mock.module('xml2js', () => mockXml2js);
mock.module('archiver', () => ({ default: mockArchiver }));
mock.module('node:util', () => mockUtil);

// Import after mocking
import { promises as fsPromises } from 'node:fs';
import logger from './utils/logger.js';
import { getNewVersion, slugify, main, removeJunk, copySvelteBuildContents, config } from './main.js';

let mutableConfig = config;

describe('Build Script Logic (Bun)', () => {

  // Spy on console methods to prevent polluting test output
  beforeEach(() => {
    spyOn(console, 'log').mockImplementation(() => {});
    spyOn(console, 'warn').mockImplementation(() => {});
    spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Clear all mock calls
    mockFs.promises.readdir.mockClear();
    mockFs.promises.stat.mockClear();
    mockFs.promises.unlink.mockClear();
    mockFs.promises.access.mockClear();
    mockFs.promises.cp.mockClear();
    mockFs.promises.readFile.mockClear();
    mockFs.promises.mkdir.mockClear();
    mockFs.promises.writeFile.mockClear();
    mockFs.promises.rm.mockClear();
    mockFs.createWriteStream.mockClear();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
  });

  describe('getNewVersion', () => {
    it('should correctly increment the patch version', () => {
      // Mock Date for this test
      const originalDate = global.Date;
      global.Date = class extends Date {
        constructor() {
          super('2025-07-23T12:00:00Z');
        }
      };

      const currentVersion = '25.07.01';
      const newVersion = getNewVersion(currentVersion);
      expect(newVersion).toBe('25.07.02');

      global.Date = originalDate;
    });

    it('should reset the patch and increment the month if the month has changed', () => {
      const originalDate = global.Date;
      global.Date = class extends Date {
        constructor() {
          super('2025-08-01T12:00:00Z');
        }
      };

      const currentVersion = '25.07.99'; // Last version from July
      const newVersion = getNewVersion(currentVersion);
      expect(newVersion).toBe('25.08.01');

      global.Date = originalDate;
    });

    it('should reset patch and month if the year has changed', () => {
      const originalDate = global.Date;
      global.Date = class extends Date {
        constructor() {
          super('2026-01-10T12:00:00Z');
        }
      };

      const currentVersion = '25.12.30'; // Last version from 2025
      const newVersion = getNewVersion(currentVersion);
      expect(newVersion).toBe('26.01.01');

      global.Date = originalDate;
    });

    it('should fall back to a new version if the current version is invalid', () => {
      const originalDate = global.Date;
      global.Date = class extends Date {
        constructor() {
          super('2025-07-23T12:00:00Z');
        }
      };

      const newVersion = getNewVersion('invalid-version');
      expect(newVersion).toBe('25.07.01');
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not parse current version'));

      global.Date = originalDate;
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

  describe('removeJunk', () => {
    const testDir = '/tmp/test_remove_junk';
    const junkFile1 = '.DS_Store';
    const junkFile2 = 'Thumbs.db';
    const keepFile = 'keep_me.txt';
    const nestedDir = 'nested';
    const nestedJunkFile = '.DS_Store';

    beforeEach(() => {
      // Reset mocks
      mockFs.promises.readdir.mockClear();
      mockFs.promises.stat.mockClear();
      mockFs.promises.unlink.mockClear();
      mockLogger.info.mockClear();
      mockLogger.warn.mockClear();
      // Mock config.junkFiles for this test suite
      config.junkFiles = ['.DS_Store', 'Thumbs.db'];
    });

    it('should remove specified junk files from a directory', async () => {
      fsPromises.readdir.mockResolvedValueOnce([junkFile1, keepFile]);
      fsPromises.stat.mockImplementation((p) => {
        const fileName = path.basename(p);
        if (config.junkFiles.includes(fileName) || fileName === keepFile) {
          return Promise.resolve({ isDirectory: () => false });
        }
        if (fileName === nestedDir) {
          return Promise.resolve({ isDirectory: () => true });
        }
        return Promise.resolve({ isDirectory: () => false }); // Default to file if not explicitly a directory
      });
      await removeJunk(testDir);
      expect(fsPromises.unlink).toHaveBeenCalledWith(path.join(testDir, junkFile1));
      expect(fsPromises.unlink).not.toHaveBeenCalledWith(path.join(testDir, keepFile));
      expect(logger.info).toHaveBeenCalledWith(`Deleted junk file: ${path.join(testDir, junkFile1)}`);
    });

    it('should recursively remove junk files from nested directories', async () => {
      fsPromises.readdir.mockImplementation((dir) => {
        if (dir === testDir) {
          return Promise.resolve([nestedDir]);
        } else if (dir === path.join(testDir, nestedDir)) {
          return Promise.resolve(['.DS_Store', keepFile]);
        }
        return Promise.resolve([]);
      });

      fsPromises.stat.mockImplementation((p) => {
        const fileName = path.basename(p);
        if (fileName === nestedDir) return Promise.resolve({ isDirectory: () => true });
        if (fileName === nestedJunkFile || fileName === keepFile) return Promise.resolve({ isDirectory: () => false });
        return Promise.resolve({ isDirectory: () => false });
      });

      await removeJunk(testDir);
      expect(fsPromises.unlink).toHaveBeenCalledWith(path.join(testDir, nestedDir, nestedJunkFile));
      expect(logger.info).toHaveBeenCalledWith(`Deleted junk file: ${path.join(testDir, nestedDir, nestedJunkFile)}`);
    });

    it('should not throw an error if the directory does not exist (ENOENT)', async () => {
      fsPromises.readdir.mockRejectedValueOnce(Object.assign(new Error('No such file or directory'), { code: 'ENOENT' }));
      await expect(removeJunk(testDir)).resolves.toBeUndefined();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should log an error if another error occurs during file system operations', async () => {
      const mockError = new Error('Permission denied');
      fsPromises.readdir.mockRejectedValueOnce(mockError);
      await expect(removeJunk(testDir)).resolves.toBeUndefined(); // removeJunk catches and logs, doesn't re-throw
      expect(logger.warn).toHaveBeenCalledWith(`Could not clean junk files from ${testDir}: ${mockError.message}`);
    });
  });

  describe('copySvelteBuildContents', () => {
    const svelteSourceDir = path.join(process.cwd(), 'public', 'build');
    const svelteTargetDir = path.join(process.cwd(), 'dist', 'WEB_ROOT', 'Test_Plugin'); // Assuming slugified name

    beforeEach(() => {
      // Reset mocks
      mockFs.promises.access.mockClear();
      mockFs.promises.cp.mockClear();
      mockLogger.info.mockClear();
      mockLogger.warn.mockClear();
      mockLogger.error.mockClear();
      // Set mock implementations for fsPromises
      fsPromises.access.mockResolvedValue(undefined);
      fsPromises.cp.mockResolvedValue(undefined);
      // Set config properties
      Object.assign(config, {
        projectType: 'svelte',
        projectRoot: process.cwd(),
        buildDir: path.join(process.cwd(), 'dist'),
      });
    });

    it.skip('should copy svelte build contents if projectType is svelte', async () => {
      fsPromises.access.mockResolvedValue(undefined); // Source directory exists
      fsPromises.cp.mockResolvedValue(undefined); // Copy succeeds

      const psXML = { plugin: { $: { name: 'Test Plugin' } } };
      await copySvelteBuildContents(psXML);

      expect(fsPromises.access).toHaveBeenCalledWith(svelteSourceDir);
      expect(fsPromises.cp).toHaveBeenCalledWith(svelteSourceDir, svelteTargetDir, { recursive: true });
      expect(logger.info).toHaveBeenCalledWith(`Copied Svelte build contents to ${svelteTargetDir}`);
    });

    it('should not copy svelte build contents if projectType is not svelte', async () => {
      config.projectType = 'vue'; // Set to a different type
      await copySvelteBuildContents({}); // Call with dummy psXML

      expect(fsPromises.access).not.toHaveBeenCalled();
      expect(fsPromises.cp).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it.skip('should log a warning if svelte build output is not found (ENOENT)', async () => {
      config.projectType = 'svelte'; // Ensure it's set to svelte for this test
      fsPromises.access.mockRejectedValue(Object.assign(new Error('No such file or directory'), { code: 'ENOENT' }));
      const psXML = { plugin: { $: { name: 'Test Plugin' } } };
      await copySvelteBuildContents(psXML);

      expect(logger.warn).toHaveBeenCalledWith('Svelte build output not found, skipping copy step.');
      expect(fsPromises.cp).not.toHaveBeenCalled();
    });

    it.skip('should log an error if copying fails for other reasons', async () => {
      config.projectType = 'svelte'; // Ensure it's set to svelte for this test
      const mockError = new Error('Permission denied');
      fsPromises.access.mockResolvedValue(undefined);
      fsPromises.cp.mockRejectedValue(mockError);
      const psXML = { plugin: { $: { name: 'Test Plugin' } } };
      await copySvelteBuildContents(psXML);

      expect(logger.error).toHaveBeenCalledWith('Error copying Svelte build contents:', mockError);
    });
  });

  describe('main orchestrator', () => {
    beforeEach(() => {
      // Set mock implementations for fsPromises
      fsPromises.readFile.mockResolvedValue(undefined);
      fsPromises.mkdir.mockResolvedValue(undefined);
      fsPromises.writeFile.mockResolvedValue(undefined);
      fsPromises.cp.mockResolvedValue(undefined);
      fsPromises.readdir.mockResolvedValue([]);
      fsPromises.stat.mockResolvedValue({ mtimeMs: Date.now(), isDirectory: () => false });
      fsPromises.rm.mockResolvedValue(undefined);
    });

    it('should run the full build process in the correct order', async () => {
      // Mock the file reads to provide necessary data
      fsPromises.readFile
        .mockResolvedValueOnce(JSON.stringify({ name: 'Test Plugin', version: '25.07.01' })) // package.json (first read in main)
        .mockResolvedValueOnce(JSON.stringify({ name: 'Test Plugin', version: '25.07.01' })) // package.json (second read in updatePackageVersions)
        .mockResolvedValueOnce('<plugin><name>Test Plugin</name></plugin>'); // plugin.xml

      // Mock the XML parsing
      mockXml2js.default.parseStringPromise.mockResolvedValue({
        plugin: {
          $: { name: 'Test Plugin', version: '25.07.01' }
        }
      });

      // Mock readdir for pruneArchives to simulate some files
      fsPromises.readdir.mockResolvedValue(['old_archive.zip', 'older_archive.zip']);
      fsPromises.stat.mockResolvedValue({ mtimeMs: Date.now(), isDirectory: () => false });

      // Mock process.exit to prevent the test runner from exiting
      const exitSpy = spyOn(process, 'exit').mockImplementation(() => {});

      await main();

      // Verify the flow
      expect(fsPromises.readFile).toHaveBeenCalledWith(path.join(process.cwd(), 'package.json'), 'utf8');
      expect(fsPromises.mkdir).toHaveBeenCalledWith(path.join(process.cwd(), 'dist'), { recursive: true });
      expect(fsPromises.writeFile).toHaveBeenCalledWith(path.join(process.cwd(), 'package.json'), expect.any(String));
      expect(fsPromises.cp).toHaveBeenCalled(); // mergePSfolders was called
      expect(mockArchiver).toHaveBeenCalledTimes(2); // createPluginZip called twice
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