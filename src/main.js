import * as fs from 'node:fs';
import path from 'node:path';
import xml2js from 'xml2js';
import archiver from 'archiver';

// Use the promises API from the core fs module for async operations
const fsPromises = fs.promises;

// --- CONFIGURATION ---
// Centralized configuration for easier management of paths and settings.
const config = {
  sourceDir: 'src',
  buildDir: 'dist',
  archiveDir: 'plugin_archive',
  schemaDir: 'schema',
  powerSchoolSourceDir: 'src/powerschool',
  // Folders to be merged into the build.
  psFolders: ['permissions_root', 'user_schema_root', 'queries_root', 'WEB_ROOT', 'pagecataloging', 'MessageKeys'],
  // Files to be removed from the build.
  junkFiles: ['.DS_Store', 'Thumbs.db', 'robots.txt', 'sitemap.xml', 'ssr-manifest.json'],
  // Number of recent archives to keep.
  archivesToKeep: 10,
  // The type of project ('vue', 'svelte', etc.). This can influence build steps.
  projectType: 'vue',
};

/**
 * Generates a new version string based on the current date.
 * Format: YY.MM.PATCH
 * The patch number increments unless the year or month has changed, in which case it resets to 1.
 * @param {string} currentVersion - The current version string (e.g., "25.07.01").
 * @returns {string} The new, incremented version string.
 */
export function getNewVersion(currentVersion) {
  try {
    const [year, month, patch] = currentVersion.split('.').map(Number);
    if (isNaN(year) || isNaN(month) || isNaN(patch)) {
      throw new Error('Invalid version format');
    }

    const now = new Date();
    const currentYear = now.getFullYear() % 100; // Last two digits of the year
    const currentMonth = now.getMonth() + 1; // JS months are 0-indexed

    let newYear = year;
    let newMonth = month;
    let newPatch = patch + 1;

    // Reset if the year has changed.
    if (year !== currentYear) {
      newYear = currentYear;
      newMonth = currentMonth;
      newPatch = 1;
    }
    // Reset if the month has changed.
    else if (month !== currentMonth) {
      newMonth = currentMonth;
      newPatch = 1;
    }

    return `${newYear}.${String(newMonth).padStart(2, '0')}.${String(newPatch).padStart(2, '0')}`;
  } catch (error) {
    console.warn(`Warning: Could not parse current version "${currentVersion}". Falling back to a new version based on today's date.`);
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}.${month}.01`;
  }
}

/**
 * Converts a string into a filename-friendly "slug".
 * Replaces sequences of spaces and/or hyphens with a single underscore.
 * @param {string} text The text to slugify.
 * @returns {string} The slugified text.
 */
export function slugify(text) {
  // This regex replaces one or more spaces, or a hyphen surrounded by optional spaces, with a single underscore.
  return text.replace(/\s*-\s*|\s+/g, '_');
}

/**
 * Recursively removes specified junk files from a directory.
 * @param {string} dir - The directory to clean.
 */
async function removeJunk(dir) {
  try {
    const files = await fsPromises.readdir(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = await fsPromises.stat(fullPath);

      if (stat.isDirectory()) {
        await removeJunk(fullPath);
      } else if (config.junkFiles.includes(file)) {
        await fsPromises.unlink(fullPath);
        console.log(`Deleted junk file: ${fullPath}`);
      }
    }
  } catch (error) {
    // Ignore errors for non-existent directories, as the goal is to ensure junk is gone.
    if (error.code !== 'ENOENT') {
      console.error(`Error removing junk from ${dir}:`, error);
    }
  }
}

/**
 * Merges PowerSchool-specific folders from the source directory into a target directory.
 * @param {string} targetDir - The destination directory (e.g., 'dist' or 'schema').
 */
async function mergePSfolders(targetDir) {
  console.log('Merging PowerSchool folders...');
  for (const folder of config.psFolders) {
    const sourcePath = path.join(config.powerSchoolSourceDir, folder);
    // Specific folders go into the schema directory.
    const destPath = (folder === 'user_schema_root' || folder === 'MessageKeys')
      ? path.join(config.schemaDir, folder)
      : path.join(targetDir, folder);

    try {
      // Check if the source exists before trying to copy.
      await fsPromises.access(sourcePath);
      // Clean up the destination if it's not the WEB_ROOT folder.
      if (folder !== 'WEB_ROOT') {
        await fsPromises.rm(destPath, { recursive: true, force: true });
      }
      await fsPromises.cp(sourcePath, destPath, { recursive: true });
      console.log(`  - Merged ${sourcePath} -> ${destPath}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // It's okay if a source folder doesn't exist, just skip it.
        // console.log(`  - Skipping non-existent source folder: ${sourcePath}`);
      } else {
        console.error(`Error merging folder ${folder}:`, error);
      }
    }
  }
}

/**
 * Creates a zip archive from a specified folder.
 * @param {string} sourceFolder - The folder to zip.
 * @param {string} zipFileName - The name of the output zip file.
 * @returns {Promise<void>} A promise that resolves when the archive is created.
 */
function createPluginZip(sourceFolder, zipFileName) {
  return new Promise(async (resolve, reject) => {
    try {
      await fsPromises.access(sourceFolder); // Check if source folder exists.
      const outputPath = path.join(config.archiveDir, zipFileName);
      // Use the core fs.createWriteStream, not from fsPromises
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        console.log(`Archive created: ${outputPath} (${archive.pointer()} bytes)`);
        resolve();
      });

      archive.on('warning', (err) => {
        if (err.code === 'ENOENT') {
          console.warn('Archiver warning:', err);
        } else {
          reject(err);
        }
      });

      archive.on('error', (err) => reject(err));

      archive.pipe(output);
      archive.directory(sourceFolder, false);
      await archive.finalize();
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`Skipping archive creation for non-existent folder: ${sourceFolder}`);
        resolve(); // Resolve silently if the source folder doesn't exist.
      } else {
        reject(new Error(`Failed to create zip for ${sourceFolder}: ${error.message}`));
      }
    }
  });
}

/**
 * Recursively finds all JSON files in a directory and updates their 'version' property.
 * @param {string} dir - The directory to search.
 * @param {string} newVersion - The new version string.
 */
async function updateJsonVersionsInDir(dir, newVersion) {
  try {
    const files = await fsPromises.readdir(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = await fsPromises.stat(fullPath);

      if (stat.isDirectory()) {
        await updateJsonVersionsInDir(fullPath, newVersion);
      } else if (path.extname(file) === '.json') {
        try {
          const jsonString = await fsPromises.readFile(fullPath, 'utf8');
          const jsonObj = JSON.parse(jsonString);

          // Simple recursive function to find and update 'version' keys.
          const updateVersionInObject = (obj) => {
            for (const key in obj) {
              if (key === 'version') obj[key] = newVersion;
              else if (typeof obj[key] === 'object' && obj[key] !== null) {
                updateVersionInObject(obj[key]);
              }
            }
          };

          updateVersionInObject(jsonObj);
          await fsPromises.writeFile(fullPath, JSON.stringify(jsonObj, null, 2));
        } catch (parseError) {
          console.warn(`Could not parse or update JSON file: ${fullPath}`, parseError);
        }
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Error updating JSON versions in ${dir}:`, error);
    }
  }
}

/**
 * Reads, updates, and writes the plugin.xml file for both the main plugin and the schema.
 * @param {object} psXML - The parsed plugin.xml object.
 * @param {string} newVersion - The new version string.
 */
async function writeXmlVariants(psXML, newVersion) {
  const builder = new xml2js.Builder();
  psXML.plugin.$.version = newVersion;

  // Write main plugin.xml
  const xmlOutput = builder.buildObject(psXML);
  await fsPromises.writeFile('plugin.xml', xmlOutput);
  await fsPromises.writeFile(path.join(config.buildDir, 'plugin.xml'), xmlOutput);
  console.log(`Updated plugin.xml to version ${newVersion}`);

  // Create and write schema-only plugin.xml
  try {
    // Modify for the "DATA" plugin
    const originalName = psXML.plugin.$.name;
    if (originalName.length > 35) {
      psXML.plugin.$.name = originalName.substring(0, 35);
      console.warn(`Plugin name truncated for schema XML: ${psXML.plugin.$.name}`);
    }
    psXML.plugin.$.name += ' DATA';
    delete psXML.plugin.access_request; // Remove fields not needed for data plugin

    const xmlOutputData = builder.buildObject(psXML);
    await fsPromises.writeFile(path.join(config.schemaDir, 'plugin.xml'), xmlOutputData);
    console.log(`Created schema-only plugin.xml`);

    // Restore original name for any subsequent operations
    psXML.plugin.$.name = originalName;
  } catch (error) {
    console.error('Could not create schema XML variant:', error);
  }
}


/**
 * Updates the version in package.json and plugin.xml.
 * @param {string} newVersion - The new version string.
 * @returns {Promise<object>} The parsed plugin.xml object.
 */
async function updatePackageVersions(newVersion) {
  // Update package.json
  const packageJsonString = await fsPromises.readFile('package.json', 'utf8');
  const packageJson = JSON.parse(packageJsonString);
  packageJson.version = newVersion;
  await fsPromises.writeFile('package.json', JSON.stringify(packageJson, null, 2));
  console.log(`Updated package.json to version ${newVersion}`);

  // Update plugin.xml
  const xmlString = await fsPromises.readFile('plugin.xml', 'utf8');
  const psXML = await xml2js.parseStringPromise(xmlString);
  await writeXmlVariants(psXML, newVersion);

  // Update any other JSON files that might contain a version
  const pageCatalogingDir = path.join(config.powerSchoolSourceDir, 'pagecataloging');
  await updateJsonVersionsInDir(pageCatalogingDir, newVersion);

  return psXML;
}

/**
 * Keeps only the most recent N archives and deletes the rest.
 */
async function pruneArchives() {
  try {
    const files = await fsPromises.readdir(config.archiveDir);
    const filesWithStats = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(config.archiveDir, file);
        const stat = await fsPromises.stat(filePath);
        return { file, mtimeMs: stat.mtimeMs, isDirectory: stat.isDirectory() };
      })
    );

    filesWithStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

    const filesToDelete = filesWithStats.slice(config.archivesToKeep);
    if (filesToDelete.length > 0) {
      console.log(`Pruning old archives (keeping last ${config.archivesToKeep})...`);
      for (const { file } of filesToDelete) {
        const itemPath = path.join(config.archiveDir, file);
        // Use rm which can handle both files and directories
        await fsPromises.rm(itemPath, { recursive: true, force: true });
        console.log(`  - Deleted old archive item: ${file}`);
      }
    }
  } catch (error) {
    // This check might be redundant with force:true in rm, but it's safe.
    if (error.code !== 'ENOENT') {
      console.error('Error pruning archives:', error);
    }
  }
}

/**
 * Prepares the build directory by merging folders and cleaning junk.
 */
async function prepareBuildDirectory() {
  console.log('Preparing build directory...');
  await mergePSfolders(config.buildDir);
  await removeJunk(config.buildDir);

  // Remove the template index.html if it exists in the final build
  const indexPath = path.join(config.buildDir, 'WEB_ROOT', 'index.html');
  try {
    await fsPromises.unlink(indexPath);
    console.log(`Deleted template file: ${indexPath}`);
  } catch (error) {
    // Only log an error if it's something other than "file not found".
    if (error.code !== 'ENOENT') {
      console.error(`Error deleting ${indexPath}:`, error);
    }
    // Otherwise, we silently ignore the error, as the file not existing is acceptable.
  }
}

/**
 * Copies Svelte build artifacts to the correct plugin location.
 * @param {object} psXML - The parsed plugin.xml object.
 */
async function copySvelteBuildContents(psXML) {
  if (config.projectType !== 'svelte') return;

  try {
    const pluginName = slugify(psXML.plugin.$.name);
    const sourceDir = 'public/build';
    const targetDir = path.join(config.buildDir, 'WEB_ROOT', pluginName);

    await fsPromises.access(sourceDir); // Check if svelte build output exists
    await fsPromises.cp(sourceDir, targetDir, { recursive: true });
    console.log(`Copied Svelte build contents to ${targetDir}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.warn('Svelte build output not found, skipping copy step.');
    } else {
      console.error('Error copying Svelte build contents:', error);
    }
  }
}

/**
 * Ensures that all necessary directories exist before the build starts.
 */
async function ensureDirectoriesExist() {
  console.log('Verifying directory structure...');
  const dirs = [config.buildDir, config.archiveDir, config.schemaDir];
  for (const dir of dirs) {
    await fsPromises.mkdir(dir, { recursive: true });
  }
}

/**
 * Main build process orchestrator.
 */
export async function main() {
  console.log('Starting plugin build process...');
  try {
    const packageJsonString = await fsPromises.readFile('package.json', 'utf8');
    const { version: currentVersion, name: pluginName } = JSON.parse(packageJsonString);
    const newVersion = getNewVersion(currentVersion);

    console.log(`Plugin: ${pluginName}`);
    console.log(`Current Version: ${currentVersion} -> New Version: ${newVersion}`);

    await ensureDirectoriesExist();
    const psXML = await updatePackageVersions(newVersion);
    await prepareBuildDirectory();
    await copySvelteBuildContents(psXML);

    // Create Archives
    console.log('Creating zip archives...');
    const slugName = slugify(psXML.plugin.$.name);
    const zipFileName = `${slugName}-${newVersion}.zip`;
    const schemaZipFileName = `DATA-${zipFileName}`;
    await createPluginZip(config.buildDir, zipFileName);
    await createPluginZip(config.schemaDir, schemaZipFileName);

    await pruneArchives();

    console.log('Build process completed successfully!');
  } catch (error) {
    console.error('\n--- BUILD FAILED ---');
    console.error(error);
    throw error; // Throw the error instead of exiting
  }
}

// --- EXECUTION ---
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
