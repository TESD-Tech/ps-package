import path from 'node:path';
import fs from 'node:fs';
import xml2js from 'xml2js';
import archiver from 'archiver';
import minimist from 'minimist';

const argv = minimist(process.argv.slice(2));
const source = argv.source || 'src';
const type = argv.type || 'vue';

const archiveDirectory = 'plugin_archive';
const buildDirectory = 'dist';
const schemaDirectory = 'schema';
const srcDirectory = source;
const psFolders = ['permissions_root', 'user_schema_root', 'queries_root', 'WEB_ROOT', 'pagecataloging', 'MessageKeys'];

const psXML = await parseXml();
const format = 'yy.mm.patch'; // CalVer filename format
const junkFiles = ['.DS_Store', 'Thumbs.db', 'robots.txt', 'sitemap.xml', 'ssr-manifest.json'];
let zipFileName = `${psXML.plugin.$.name}-${psXML.plugin.$.version}.zip`;
let schemaZipFileName;

async function getNewVersion(currentVersion) {
  try {
    // Split the version into components
    const [year, month, patch] = currentVersion.split('.').map(Number);
    const currentYear = new Date().getFullYear();

    // Increment patch or reset if new month/year
    let newYear = year;
    let newMonth = month;
    let newPatch = patch + 1;

    if (month !== new Date().getMonth() + 1) {
      newMonth = new Date().getMonth() + 1;
      newPatch = 1;
    }

    if (year !== currentYear % 100) {
      newYear = currentYear % 100;
      newMonth = new Date().getMonth() + 1;
      newPatch = 1;
    }

    return `${newYear}.${String(newMonth).padStart(2, '0')}.${String(newPatch).padStart(2, '0')}`;
  } catch (error) {
    console.error('Error incrementing version:', error);
    console.error('Invalid version format:', currentVersion);
    console.error('Falling back to current date as version...');

    const date = new Date();
    const year = date.getFullYear().toString().substr(-2); // last two digits of year
    const month = String(date.getMonth() + 1).padStart(2, '0'); // ensure 2 digits
    const patch = '01'; // default patch version

    return `${year}.${month}.${patch}`;
  }
}

async function removeJunk(dir) {
  const files = await fs.promises.readdir(dir)
  for (const file of files) {
    const fullPath = path.join(dir, file)
    const stat = await fs.promises.stat(fullPath)

    if (stat.isDirectory()) {
      await removeJunk(fullPath)
    } else if (junkFiles.includes(file)) {
      await fs.promises.unlink(fullPath)
      console.log(`Deleted junk file: ${fullPath}`)
    }
  }
}

async function mergePSfolders(targetDir) {
  for (const folder of psFolders) {
    const thisDir = (folder === 'user_schema_root' || folder === 'MessageKeys') ? schemaDirectory : targetDir

    if (fs.existsSync(`${thisDir}/${folder}`) && folder !== 'WEB_ROOT')
      await fs.promises.rm(`${thisDir}/${folder}`, { recursive: true })

    if (fs.existsSync(`${srcDirectory}/powerschool/${folder}`)) {
      await fs.promises.cp(`${srcDirectory}/powerschool/${folder}`, `${thisDir}/${folder}`, { recursive: true })
      console.log(`Merging ${srcDirectory}/powerschool/${folder} into ${thisDir}/${folder}`)
    }
  }
}

async function createPluginZip(folder, zipFileName) {
  if (fs.existsSync(folder)) {
    return new Promise((resolve) => {
      const output = fs.createWriteStream(`${archiveDirectory}/${zipFileName}`)
      const archive = archiver('zip', { zlib: { level: 9 } })

      output.on('close', () => {
        console.log(`${folder}/${zipFileName} created. Size: ${archive.pointer()} Bytes`)
        resolve()
      })

      archive.pipe(output)
      archive.directory(`${folder}/`, false)
      archive.finalize()
    })
  }
}

async function updateJsonVersion(dir, v) {
  if (!fs.existsSync(dir)) {
    return;
  }
  
  const files = await fs.promises.readdir(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = await fs.promises.stat(fullPath);

    if (stat.isDirectory()) {
      await updateJsonVersion(fullPath, v);
    } else if (path.extname(file) === '.json') {
      const jsonString = await fs.promises.readFile(fullPath, 'utf8');
      const jsonObj = JSON.parse(jsonString);

      updateVersionInObject(jsonObj, v);

      await fs.promises.writeFile(fullPath, JSON.stringify(jsonObj, null, 2));
    }
  }
}

function updateVersionInObject(obj, v) {
  for (const key in obj) {
    if (key === 'version') {
      obj[key] = v;
    } else if (typeof obj[key] === 'object') {
      updateVersionInObject(obj[key], v);
    }
  }
}

async function updatePackageVersion(v) {
  try {
    const packageJsonString = await fs.promises.readFile('package.json', 'utf8')
    const packageJson = JSON.parse(packageJsonString)
    console.log('Version from package.json:', packageJson.version);
    packageJson.version = v
    await fs.promises.writeFile('package.json', JSON.stringify(packageJson, null, 2))

    const psXML = await parseXml()
    psXML.plugin.$.version = v
    await writeXml(psXML)
    await updateJsonVersion(`${srcDirectory}/powerschool/pagecataloging/`, v);

  }
  catch (error) {
    console.error(error)
  }
}

async function pruneArchive() {
  try {
    const files = await fs.promises.readdir(archiveDirectory);
    files.sort((a, b) => {
      const aTime = fs.statSync(path.join(archiveDirectory, a)).mtimeMs;
      const bTime = fs.statSync(path.join(archiveDirectory, b)).mtimeMs;
      return bTime - aTime;
    });

    const recentFiles = files.slice(0, 10);
    for (const file of files) {
      if (!recentFiles.includes(file)) {
        try {
          await fs.promises.unlink(path.join(archiveDirectory, file));
        } catch (error) {
          console.error(`Error deleting "${file}": ${error}`);
        }
      }
    }
  }
  catch (error) {
    console.error(`Error pruning archive: ${error}`);
  }
}

async function parseXml() {
  const xml = await fs.promises.readFile('plugin.xml', 'utf8')
  return await xml2js.parseStringPromise(xml)
}

async function writeXml(psXML) {
  console.log(`Build Directory: ${buildDirectory}`)
  const builder = new xml2js.Builder()
  const xmlOutput = builder.buildObject(psXML)

  fs.writeFileSync('plugin.xml', xmlOutput)
  fs.writeFileSync(`${buildDirectory}/plugin.xml`, xmlOutput)

  if (fs.existsSync(`${schemaDirectory}`)) {
    psXML.plugin.$.name += ' DATA'
    delete psXML.plugin.access_request
    const xmlOutputData = builder.buildObject(psXML)
    fs.writeFileSync(`${schemaDirectory}/plugin.xml`, xmlOutputData)
  }
}

async function prepareBuildDirectory() {
  await mergePSfolders(buildDirectory)
  await removeJunk(buildDirectory)

  if (fs.existsSync(`${buildDirectory}/WEB_ROOT/index.html`)) {
    await fs.promises.unlink(`${buildDirectory}/WEB_ROOT/index.html`)
    console.log('Deleted /index.html')
  }
}

async function createZipFiles(psXML, newVersion) {
  zipFileName = `${psXML.plugin.$.name}-${newVersion}.zip`
  schemaZipFileName = `DATA-${zipFileName}`

  await createPluginZip(buildDirectory, zipFileName)
  await createPluginZip(schemaDirectory, schemaZipFileName)
}

async function copySvelteBuildContents() {
  const folderName = `${psXML.plugin.$.name}`.replaceAll(' ', '_').replaceAll('_-_', '_').replace('__', '_')

  if (type === 'svelte' && fs.existsSync('public')) {
    const targetDir = `dist/WEB_ROOT/${folderName}`
    await fs.promises.cp(`public/build`, targetDir, { recursive: true })
    console.log(`Copied Svelte build contents to ${targetDir}`)
  }
}

async function checkFolderStructure() {
  // Create dist folder if it doesn't exist
  if (!fs.existsSync('dist'))
    await fs.promises.mkdir('dist')

  // Create archive folder if it doesn't exist
  if (!fs.existsSync(archiveDirectory))
    await fs.promises.mkdir(archiveDirectory)
}

async function main() {
  try {
    const packageJsonString = await fs.promises.readFile('package.json', 'utf8');
    const packageJson = JSON.parse(packageJsonString);
    const newVersion = await getNewVersion(packageJson.version);

    await checkFolderStructure();
    await updatePackageVersion(newVersion);
    await prepareBuildDirectory();
    await copySvelteBuildContents();
    await createZipFiles(psXML, newVersion);
    await pruneArchive();
  } catch (error) {
    console.error('Error in main function:', error);
  }
}

main();
