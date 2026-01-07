# ps-package

This package automates the process of building and packaging a PowerSchool plugin. It handles tasks such as:

* **Updating the plugin version number in plugin.xml, all pagecataloging JSON files, and package.json**
* **Merging PowerSchool-specific folders into the build directory**
* **Removing junk files from the build directory**
* **Creating ZIP files for the plugin and its schema**
* **Pruning the archive directory to keep only the most recent ZIP files**

## Installation

### Option 1: Using npm/pnpm/yarn/bun (Requires Node.js or Bun)

Install globally or as a dev dependency in your project:

```bash
# Global installation
npm install -g @tesd-tech/ps-package
# or
bun install -g @tesd-tech/ps-package

# Or as dev dependency in your project
npm install -D @tesd-tech/ps-package
# or with pnpm
pnpm i -D @tesd-tech/ps-package
# or with bun
bun add -d @tesd-tech/ps-package
```

### Option 2: Standalone Executable (No runtime required)

Download the appropriate executable for your platform from [GitHub Releases](https://github.com/TESD-Tech/ps-package/releases):

**macOS:**
```bash
# Intel Mac
curl -L -o ps-package https://github.com/TESD-Tech/ps-package/releases/latest/download/ps-package-darwin-x64
chmod +x ps-package

# Apple Silicon Mac
curl -L -o ps-package https://github.com/TESD-Tech/ps-package/releases/latest/download/ps-package-darwin-arm64
chmod +x ps-package

# Move to PATH (optional)
sudo mv ps-package /usr/local/bin/
```

**Linux:**
```bash
curl -L -o ps-package https://github.com/TESD-Tech/ps-package/releases/latest/download/ps-package-linux-x64
chmod +x ps-package
sudo mv ps-package /usr/local/bin/  # Optional
```

**Windows:**
Download `ps-package-windows-x64.exe` from the releases page, rename to `ps-package.exe`, and add to your PATH.

## Usage

```bash
# If installed globally or executable in PATH
ps-package

# If installed as project dependency
npx ps-package
# or
bunx ps-package
```

## Options

The package accepts two optional command-line arguments:

* **`source`:** The source directory for the plugin files. This defaults to `src`.
* **`type`:** The plugin type. This can be `vue` or `svelte`. This defaults to `vue`.

## Additional Notes

* The package expects the plugin's source files to be located in a directory named `src` in the project's root directory.
* Additionally, PowerSchool-specific files and directories should be located in a subdirectory named "powerschool" within the `src` directory.
  * See the src directory within this project for an example of this structure.
* The package expects the plugin's XML manifest file to be named `plugin.xml` and located in the project's root directory.
* The package creates the following directories:
  * `dist`: The directory where the plugin's built files are placed.
  * `plugin_archive`: The directory where ZIP files of the plugin and its schema are created.
* The package will overwrite any existing files in the `dist` and `plugin_archive` directories.

## Development

This project uses Bun for development:

```bash
# Install dependencies
bun install

# Run tests
bun test

# Build plugin (tests the CLI)
bun run build

# Run tests with coverage
bun test --coverage

# Build executables locally (for current platform only)
bun run build:executables
```

## Credits

This package was developed by Benjamin Kemp and is based on the work of others who have contributed to the open-source community.

## License

This package is available under the MIT License.
