import path from 'node:path'
import fs from 'node:fs'
import xml2js from 'xml2js'
import archiver from 'archiver'
import calver from 'calver'
import minimist from 'minimist'

const argv = minimist(process.argv.slice(2))
const source = argv.source || 'src'
const type = argv.type || 'vue'

const archiveDirectory = 'plugin_archive'
const buildDirectory = 'dist'
const schemaDirectory = 'schema'
const srcDirectory = source
const psFolders = ['permissions_root', 'user_schema_root', 'queries_root', 'WEB_ROOT', 'pagecataloging']

const psXML = await parseXml()
const format = 'yy.mm.patch' // CalVer filename format
const junkFiles = ['.DS_Store', 'Thumbs.db', 'robots.txt', 'sitemap.xml', 'ssr-manifest.json']
let zipFileName = `${psXML.plugin.$.name}-${psXML.plugin.$.version}.zip`
let schemaZipFileName

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
    const thisDir = folder === 'user_schema_root' ? schemaDirectory : targetDir

    if (fs.existsSync(`${thisDir}/${folder}`) && folder !== 'WEB_ROOT') {
      await fs.promises.rm(`${thisDir}/${folder}`, { recursive: true })
    }

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

async function updatePackageVersion(v) {
  try {
    const packageJsonString = await fs.promises.readFile('package.json', 'utf8')
    const packageJson = JSON.parse(packageJsonString)
    packageJson.version = v
    await fs.promises.writeFile('package.json', JSON.stringify(packageJson, null, 2))
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

    const recentFiles = files.slice(0, 3);
    for (const file of files) {
      if (!recentFiles.includes(file)) {
        try {
          await fs.promises.unlink(path.join(archiveDirectory, file));
        } catch (error) {
          console.error(`Error deleting "${file}": ${error}`);
        }
      }
    }
  } catch (error) {
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

async function updateVersion() {
  const packageJsonString = await fs.promises.readFile('package.json', 'utf8')
  const packageJson = JSON.parse(packageJsonString)

  let newVersion
  try {
    newVersion = calver.inc(format, packageJson.version, 'calendar.patch')
  } catch (error) {
    newVersion = calver.inc(format, '', 'calendar.patch')
  }

  const psXML = await parseXml()
  psXML.plugin.$.version = newVersion
  await updatePackageVersion(newVersion)
  await writeXml(psXML)
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

async function main() {
  try {
    const packageJsonString = await fs.promises.readFile('package.json', 'utf8')
    const packageJson = JSON.parse(packageJsonString)
    const newVersion = await calver.inc(format, packageJson.version, 'calendar.patch')

    await updatePackageVersion(newVersion)
    await updateVersion()
    await prepareBuildDirectory()
    await copySvelteBuildContents()
    await createZipFiles(psXML, newVersion)
    await pruneArchive()
  } catch (error) {
    console.error(error)
  }
}

main()
