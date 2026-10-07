# ps-package

This package automates the process of building and packaging a PowerSchool plugin. It handles tasks such as:

* **Updating the plugin version number in plugin.xml, all pagecataloging JSON files, and package.json**
* **Merging PowerSchool-specific folders into the build directory**
* **Removing junk files from the build directory**
* **Creating ZIP files for the plugin and its schema**
* **Pruning the archive directory to keep only the most recent builds**

## Installation

To install the package, run the following command from the root directory of your plugin project:

```bash
pnpm i -D @tesd-tech/ps-package
```

## Usage
```bash
npx ps-package
```

## Options

The CLI takes no arguments. To build a Svelte project, add this to your project's `package.json` (defaults to `vue`):

```json
{
  "ps-package": { "projectType": "svelte" }
}
```

Svelte builds copy `public/build` into `dist/WEB_ROOT/<plugin name>`.

## Additional Notes

* The package expects the plugin's source files to be located in a directory named `src` in the project's root directory.
* Additionally, PowerSchool-specific files and directories should be located in a subdirectory named "powerschool" within the `src` directory.
  * See the src directory within this project for an example of this structure.
* The package expects the plugin's XML manifest file to be named `plugin.xml` and located in the project's root directory.
* The package creates the following directories:
  * `dist`: The directory where the plugin's built files are placed.
  * `plugin_archive`: The directory where ZIP files of the plugin and its schema are created.
* `dist` and `schema` are deleted and regenerated on every build, so files removed from source don't ship. Don't hand-edit them.
* Versions use CalVer (`YY.MM.PATCH`). The patch resets to `01` when the year or month changes.
* The version bump is written to `package.json`, `plugin.xml` and any pagecataloging JSON that has a `version` key. If the build fails, those files are restored.
* The 10 most recent builds are kept in `plugin_archive` (a plugin ZIP and its `DATA-` ZIP count as one build), plus the one just created. Only `.zip` files are pruned.

## Credits

This package was developed by Benjamin Kemp and is based on the work of others who have contributed to the open-source community.

## License

This package is available under the MIT License.
