import * as fs from 'node:fs';
import path from 'node:path';
import xml2js from 'xml2js';
import archiver from 'archiver';
import logger from './utils/logger.js';
import * as util from 'node:util';
import * as stream from 'node:stream';

// Use the promises API from the core fs module for async operations
const fsPromises = fs.promises;

// --- CONFIGURATION ---
// Centralized configuration for easier management of paths and settings.
export const config = {
  projectRoot: process.cwd(),
  sourceDir: path.join(process.cwd(), 'src'),
  buildDir: path.join(process.cwd(), 'dist'),
  archiveDir: path.join(process.cwd(), 'plugin_archive'),
  schemaDir: path.join(process.cwd(), 'schema'),
  powerSchoolSourceDir: path.join(process.cwd(), 'src', 'powerschool'),
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
    logger.warn(`Could not parse current version "${currentVersion}". Falling back to a new version based on today's date.`);
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
export async function removeJunk(dir) {
  try {
    const files = await fsPromises.readdir(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = await fsPromises.stat(fullPath);

      if (stat.isDirectory()) {
        await removeJunk(fullPath);
      } else if (config.junkFiles.includes(file)) {
        await fsPromises.unlink(fullPath);
        logger.info(`Deleted junk file: ${fullPath}`);
      }
    }
  } catch (error) {
    // Ignore errors for non-existent directories, as the goal is to ensure junk is gone.
    if (error.code !== 'ENOENT') {
      logger.error(`Error removing junk from ${dir}:`, error);
    }
  }
}

/**
 * Merges PowerSchool-specific folders from the source directory into a target directory.
 * @param {string} targetDir - The destination directory (e.g., 'dist' or 'schema').
 */
async function mergePSfolders() {
  logger.info('Merging PowerSchool folders...');
  for (const folder of config.psFolders) {
    const sourcePath = path.join(config.powerSchoolSourceDir, folder);
    // Specific folders go into the schema directory.
    const destPath = (folder === 'user_schema_root' || folder === 'MessageKeys')
      ? path.join(config.schemaDir, folder)
      : path.join(config.buildDir, folder);

    try {
      // Check if the source exists before trying to copy.
      await fsPromises.access(sourcePath);
      // Clean up the destination if it's not the WEB_ROOT folder.
      if (folder !== 'WEB_ROOT') {
        await fsPromises.rm(destPath, { recursive: true, force: true });
      }
      await fsPromises.cp(sourcePath, destPath, { recursive: true });
      logger.info(`  - Merged ${sourcePath} -> ${destPath}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // It's okay if a source folder doesn't exist, just skip it.
        // logger.info(`  - Skipping non-existent source folder: ${sourcePath}`);
      } else {
        logger.error(`Error merging folder ${folder}:`, error);
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
async function createPluginZip(sourceFolder, zipFileName) {
  try {
    await fsPromises.access(sourceFolder); // Check if source folder exists.
    const outputPath = path.join(config.archiveDir, zipFileName);
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    const streamPipeline = util.promisify(stream.pipeline);

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        logger.warn('Archiver warning:', err);
      } else {
        logger.error('Archiver error:', err);
        throw err; // Re-throw other warnings as errors
      }
    });

    archive.on('error', (err) => {
      logger.error('Archiver error:', err);
      throw err;
    });

    archive.directory(sourceFolder, false);
    archive.finalize();

    await streamPipeline(archive, output);
    logger.info(`Archive created: ${outputPath} (${archive.pointer()} bytes)`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.info(`Skipping archive creation for non-existent folder: ${sourceFolder}`);
    } else {
      throw new Error(`Failed to create zip for ${sourceFolder}: ${error.message}`);
    }
  }
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
          logger.warn(`Could not parse or update JSON file: ${fullPath}`, parseError);
        }
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.error(`Error updating JSON versions in ${dir}:`, error);
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
  await fsPromises.writeFile(path.join(config.projectRoot, 'plugin.xml'), xmlOutput);
  await fsPromises.writeFile(path.join(config.buildDir, 'plugin.xml'), xmlOutput);
  logger.info(`Updated plugin.xml to version ${newVersion}`);

  // Create and write schema-only plugin.xml
  try {
    // Modify for the "DATA" plugin
    const originalName = psXML.plugin.$.name;
    if (originalName.length > 35) {
      psXML.plugin.$.name = originalName.substring(0, 35);
      logger.warn(`Plugin name truncated for schema XML: ${psXML.plugin.$.name}`);
    }
    psXML.plugin.$.name += ' DATA';
    delete psXML.plugin.access_request; // Remove fields not needed for data plugin

    const xmlOutputData = builder.buildObject(psXML);
    await fsPromises.writeFile(path.join(config.schemaDir, 'plugin.xml'), xmlOutputData);
    logger.info(`Created schema-only plugin.xml`);

    // Restore original name for any subsequent operations
    psXML.plugin.$.name = originalName;
  } catch (error) {
    logger.error('Could not create schema XML variant:', error);
  }
}


/**
 * Updates the version in package.json and plugin.xml.
 * @param {string} newVersion - The new version string.
 * @returns {Promise<object>} The parsed plugin.xml object.
 */
async function updatePackageVersions(newVersion) {
  // Update package.json
  const packageJsonString = await fsPromises.readFile(path.join(config.projectRoot, 'package.json'), 'utf8');
  const packageJson = JSON.parse(packageJsonString);
  packageJson.version = newVersion;
  await fsPromises.writeFile(path.join(config.projectRoot, 'package.json'), JSON.stringify(packageJson, null, 2));
  logger.info(`Updated package.json to version ${newVersion}`);

  // Update plugin.xml
  const xmlString = await fsPromises.readFile(path.join(config.projectRoot, 'plugin.xml'), 'utf8');
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
      logger.info(`Pruning old archives (keeping last ${config.archivesToKeep})...`);
      for (const { file } of filesToDelete) {
        const itemPath = path.join(config.archiveDir, file);
        // Use rm which can handle both files and directories
        await fsPromises.rm(itemPath, { recursive: true, force: true });
        logger.info(`  - Deleted old archive item: ${file}`);
      }
    }
  } catch (error) {
    // This check might be redundant with force:true in rm, but it's safe.
    if (error.code !== 'ENOENT') {
      logger.error('Error pruning archives:', error);
    }
  }
}

/**
 * Prepares the build directory by merging folders and cleaning junk.
 */
async function prepareBuildDirectory() {
  logger.info('Preparing build directory...');
  await mergePSfolders();
  await removeJunk(config.buildDir);

  // Remove the template index.html if it exists in the final build
  const indexPath = path.join(config.buildDir, 'WEB_ROOT', 'index.html');
  try {
    await fsPromises.unlink(indexPath);
    logger.info(`Deleted template file: ${indexPath}`);
  } catch (error) {
    // Only log an error if it's something other than "file not found".
    if (error.code !== 'ENOENT') {
      logger.error(`Error deleting ${indexPath}:`, error);
    }
    // Otherwise, we silently ignore the error, as the file not existing is acceptable.
  }
}

/**
 * Copies Svelte build artifacts to the correct plugin location.
 * @param {object} psXML - The parsed plugin.xml object.
 */
export async function copySvelteBuildContents(psXML) {
  if (config.projectType !== 'svelte') return;

  try {
    const pluginName = slugify(psXML.plugin.$.name);
    const sourceDir = path.join(config.projectRoot, 'public', 'build');
    const targetDir = path.join(config.buildDir, 'WEB_ROOT', pluginName);

    await fsPromises.access(sourceDir); // Check if svelte build output exists
    await fsPromises.cp(sourceDir, targetDir, { recursive: true });
    logger.info(`Copied Svelte build contents to ${targetDir}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.warn('Svelte build output not found, skipping copy step.');
    } else {
      logger.error('Error copying Svelte build contents:', error);
    }
  }
}

/**
 * Ensures that all necessary directories exist before the build starts.
 */
async function ensureDirectoriesExist() {
  logger.info('Verifying directory structure...');
  const dirs = [config.buildDir, config.archiveDir, config.schemaDir];
  for (const dir of dirs) {
    await fsPromises.mkdir(dir, { recursive: true });
  }
}

/**
 * Main build process orchestrator.
 */
export async function main() {
  logger.info('Starting plugin build process...');
  try {
    const packageJsonString = await fsPromises.readFile(path.join(config.projectRoot, 'package.json'), 'utf8');
    const { version: currentVersion, name: pluginName } = JSON.parse(packageJsonString);
    const newVersion = getNewVersion(currentVersion);

    logger.info(`Plugin: ${pluginName}`);
    logger.info(`Current Version: ${currentVersion} -> New Version: ${newVersion}`);

    await ensureDirectoriesExist();
    const psXML = await updatePackageVersions(newVersion);
    await prepareBuildDirectory();
    await copySvelteBuildContents(psXML);

    // Create Archives
    logger.info('Creating zip archives...');
    const slugName = slugify(psXML.plugin.$.name);
    const zipFileName = `${slugName}-${newVersion}.zip`;
    const schemaZipFileName = `DATA-${zipFileName}`;
    await createPluginZip(config.buildDir, zipFileName);
    await createPluginZip(config.schemaDir, schemaZipFileName);

    await pruneArchives();

    logger.info('Build process completed successfully!');
  } catch (error) {
    logger.error('\n--- BUILD FAILED ---');
    logger.error(error);
    throw error; // Throw the error instead of exiting
  }
}

// --- EXECUTION ---
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
