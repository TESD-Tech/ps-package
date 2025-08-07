## Plan: Creating a Solid Test File for `src/main.js`

### I. Analyze `src/main.js` (Current State)

### Improvements for `src/main.js`

1.  **Enhance Error Handling and Logging:**
    *   **Current:** Errors are caught, logged to `console.error`, and then re-thrown.
    *   **Improvement:** Implement a more structured logging approach. Instead of just `console.error`, consider a simple logging utility that can categorize messages (e.g., `log.info`, `log.warn`, `log.error`) and potentially include more context (e.g., the function where the error occurred). This makes debugging easier and allows for different handling of critical vs. non-critical issues. For instance, some errors might warrant a detailed stack trace, while others just a warning.

2.  **Refine Path Management and Configuration:**
    *   **Current:** The `config` object centralizes some paths, but others are constructed dynamically within functions (e.g., `path.join(config.archiveDir, zipFileName)`).
    *   **Improvement:** Consolidate all path definitions and resolutions within the `config` object or a dedicated path utility. Ensure all paths are absolute from the project root as early as possible. This reduces potential issues with relative paths and makes the configuration clearer. Additionally, consider allowing the `config` to be loaded from an external file (e.g., `config.json`) to enable easier customization without modifying the source code directly.

3.  **Refactor `createPluginZip` for Cleaner Asynchronous Code:**
    *   **Current:** The `createPluginZip` function uses the `new Promise` constructor pattern.
    *   **Improvement:** This function can be refactored to leverage `async/await` directly, which often leads to more readable and maintainable asynchronous code by avoiding the explicit `Promise` constructor. The `output.on('close', ...)` and `archive.on('error', ...)` callbacks can be wrapped in a utility or handled with `async/await` friendly event listeners if available, or by converting the event into a promise.


*   **Functions:** `getNewVersion` (exported), `removeJunk`, `mergePSfolders`, `createPluginZip`, `updateJsonVersion`, `updateVersionInObject`, `updatePackageVersion`, `pruneArchive`, `parseXml`, `writeXml`, `prepareBuildDirectory`, `createZipFiles`, `copySvelteBuildContents`, `checkFolderStructure`, `main` (exported).
*   **Global Dependencies:** `argv`, `source`, `type`, `config` object (containing `archiveDirectory`, `buildDirectory`, `schemaDirectory`, `srcDirectory`, `psFolders`, `junkFiles`), `format`. Crucially, `psXML` is initialized via a top-level `await parseXml()`, making it a global variable with side effects on module import. `zipFileName` and `schemaZipFileName` are also global `let` variables.
*   **External Modules:** `node:path`, `node:fs`, `xml2js`, `archiver`, `minimist`.

### II. Refactoring `src/main.js` for Testability (Crucial Step)

The current structure with global variables and top-level `await` makes isolated unit testing difficult and prone to errors (as we've seen). The goal is to eliminate global state and side effects on module import.

1.  **Encapsulate Configuration and State:**
    *   Create a `Context` object or class that encapsulates all configuration variables (`source`, `type`, `archiveDirectory`, `buildDirectory`, `schemaDirectory`, `psFolders`, `junkFiles`, `format`).
    *   This `Context` object will also hold the `psXML` object once parsed.
    *   All functions that currently access these global variables will receive the `Context` object as an argument.
2.  **Isolate `parseXml` and `psXML` Initialization:**
    *   The `parseXml` function should be a pure function that takes the `plugin.xml` path as an argument.
    *   The `psXML` object will be initialized *within* the `main` function (or a setup function called by `main`) and then passed to other functions via the `Context`.
3.  **Explicit Dependency Injection:**
    *   Modify all functions to explicitly accept their dependencies (e.g., `fs`, `path`, `xml2js`, `archiver`, `minimist`, and the `Context` object) as arguments, rather than relying on module-level imports or global variables. This makes them pure and easily testable.
4.  **Export All Testable Units:**
    *   Ensure all functions that perform a distinct, testable operation are exported from `src/main.js`. This includes `removeJunk`, `mergePSfolders`, `createPluginZip`, etc.
5.  **Refine `main` Function:**
    *   The `main` function will become the primary orchestrator. It will:
        *   Parse command-line arguments (`minimist`).
        *   Initialize the `Context` object.
        *   Call `parseXml` (passing the `plugin.xml` path).
        *   Call all other core functions, passing the `Context` and `psXML` as needed.

### III. Testing Strategy for `src/main.test.js`

1.  **Unit Tests for Each Function:**
    *   Each exported function from `src/main.js` will have its own `describe` block.
    *   Tests will focus on the function's specific logic, mocking all its direct dependencies (file system operations, XML parsing, archiver, etc.).
    *   For functions that now accept a `Context` object, mock the relevant properties of that object.
2.  **Integration Test for `main` Function:**
    *   A dedicated `describe` block for the `main` function.
    *   This test will verify the overall orchestration:
        *   Ensure `main` calls its sub-functions in the correct order.
        *   Verify that `main` passes the correct arguments to its sub-functions.
        *   Mock the sub-functions to control their behavior and assert their calls.
        *   Test error handling within the `main` function.

### IV. Mocking Strategy

1.  **External Modules (`node:fs`, `xml2js`, `archiver`, `minimist`):**
    *   Use `vi.mock` at the top level of `src/main.test.js` to mock these modules globally.
    *   For `fs`, mock `fs.promises` methods (`readFile`, `writeFile`, `readdir`, `stat`, `unlink`, `rm`, `cp`, `mkdir`) and synchronous methods (`existsSync`, `statSync`, `writeFileSync`, `mkdirSync`).
    *   For `xml2js`, mock `parseStringPromise` and `Builder`.
    *   For `archiver`, mock the default export and its methods (`pipe`, `directory`, `finalize`, `pointer`).
    *   For `minimist`, mock the default export.
2.  **Internal Dependencies (after refactoring):**
    *   Since `Context` and `psXML` will be passed as arguments, they will be easily controllable within each test.
    *   For functions that call other exported functions (e.g., `main` calling `updatePackageVersion`), use `vi.mocked(functionName).mockImplementation(...)` to control their behavior and assert their calls.
3.  **Test Isolation:**
    *   Use `beforeEach` to clear mocks (`mockClear()`) for each test or suite to ensure no test affects another.
    *   `vi.resetModules()` can be used in `beforeEach` if `vi.doMock` is used for specific test cases that need to override module-level variables (though the refactoring aims to minimize this need).

### V. Test File Structure (`src/main.test.js`)

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import xml2js from 'xml2js';
import archiver from 'archiver';
import minimist from 'minimist';

// --- Global Mocks for External Modules (must be at top level) ---
vi.mock('node:fs', () => ({
  // ... detailed fs mocks ...
}));
vi.mock('xml2js', () => ({
  // ... detailed xml2js mocks ...
}));
vi.mock('archiver', () => ({
  // ... detailed archiver mocks ...
}));
vi.mock('minimist', () => ({
  // ... detailed minimist mocks ...
}));

// --- Import Refactored Functions from main.js ---
// (All testable functions will be exported after refactoring)
import {
  getNewVersion,
  removeJunk,
  updateVersionInObject,
  checkFolderStructure,
  mergePSfolders,
  createPluginZip,
  updateJsonVersion,
  updatePackageVersion,
  pruneArchive,
  parseXml,
  writeXml,
  prepareBuildDirectory,
  createZipFiles,
  copySvelteBuildContents,
  main,
  // Potentially import the Context class/factory if needed for direct testing
} from './main.js';

// --- Test Suites for Each Exported Function ---

describe('getNewVersion', () => {
  // ... tests for getNewVersion ...
});

describe('removeJunk', () => {
  beforeEach(() => {
    // Clear mocks specific to this suite
  });
  // ... tests for removeJunk ...
});

// ... other describe blocks for each exported function ...

describe('main (Integration Test)', () => {
  beforeEach(() => {
    // Clear mocks for functions called by main
    // Mock external dependencies like fs.promises.readFile for package.json
  });
  // ... tests for main's orchestration logic ...
});
```

### VI. Execution and Verification

*   Run tests using `pnpm test`.
*   Monitor console output for errors.
*   Use Vitest's watch mode (`pnpm test --watch`) for Test-Driven Development (TDD).
*   Consider adding coverage reporting (`pnpm test --coverage`) once a good suite of tests is in place to identify untested areas.
