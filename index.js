// This script parses an xml file 'ps-plugin.xml', converts it to an object,
// writes the object back to the xml file, and then creates a zip file
// containing the contents of the build_directory directory.
//
// Author: OpenAI & Benjamin Kemp
// Date: 2022-12-16

/*

  Manual additions:
  package.json version update
  rename zip file using package name and version

  Prompt:

  Write a node.js script using es modules to:

  1. Parse an xml file 'ps-plugin.xml' using xml2js into an object named psXML
  2. Print psXML using console.dir
  3. Write psXML as an xml file to ps-plugin.xml and 'dist/plugin.xml'
  4. Create a new zip file named ps-plugin.zip containing the contents of the dist directory, including all subdirectories, using the archive library

  Please be sure to:
    1. use error handling
    2. include comments
    3. include a header in a comment block including author and date
    4. include a comment block containing this prompt

*/

import fs from 'fs'
import path from 'path'
import xml2js from 'xml2js'
import archiver from 'archiver'
import calver from 'calver'

const archive_directory = 'plugin_archive'
const build_directory = 'dist'
const src_directory = 'src'
const psFolders = ['user_schema_root', 'queries_root']

const format = 'yy.mm.dd.patch' // CalVer filename format
const junkFiles = ['.DS_Store', 'Thumbs.db', 'robots.txt', 'sitemap.xml', 'ssr-manifest.json']
let errCount = 0
let zipFileName

// Create build directory and archive directory
if (!fs.existsSync(archive_directory))
  fs.mkdirSync(archive_directory)

if (!fs.existsSync(build_directory))
  fs.mkdirSync(build_directory)

const removeJunk = async (dir) => {
  return new Promise((resolve, reject) => {
    fs.readdir(dir, (err, files) => {
      if (err) {
        reject(err)
        return
      }
      files.forEach((file) => {
        const fullPath = path.join(dir, file)

        fs.stat(fullPath, (err, stat) => {
          if (err) {
            reject(err)
            return
          }

          if (stat.isDirectory()) {
            removeJunk(fullPath)
          }
          else if (junkFiles.includes(file)) {
            fs.unlink(fullPath, (err) => {
              if (err)
                reject(err)

              else
                console.log(`Deleted junk file: ${fullPath}`)
            })
          }
        })
      })

      resolve()
    })
  })
}

const mergePSfolders = async (dir) => {
  // Clean existing PS folders from dist and copy fresh from src

  return new Promise((resolve, reject) => {
    psFolders.forEach((folder) => {
      if (fs.existsSync(`${dir}/${folder}`)) {
        fs.unlink(`${dir}/${folder}`, (err) => {
          if (err)
            reject(err)
          else
            console.log(`Removed ${dir}/${folder}`)
        })
      }
      if (fs.existsSync(`${src_directory}/${folder}`))
        fs.cpSync(`${src_directory}/${folder}`, `${dir}/${folder}`, {recursive: true})
    })

    resolve()
  })
}

const updatePackageJson = (v) => {
  try {
    // Read the contents of 'package.json'
    const packageJsonString = fs.readFileSync('package.json', 'utf8')

    // Parse the 'package.json' string into an object
    const packageJson = JSON.parse(packageJsonString)

    // Update the 'version' field with the value of 'v'
    packageJson.version = v

    // Write the updated 'package.json' object back to the file
    fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2))
  }
  catch (error) {
    // Handle any errors that may have occurred
    console.error(error)
  }
}

const main = async () => {
  try {
    // Parse the xml file 'ps-plugin.xml' using xml2js and store the result in 'psXML'
    const xml = fs.readFileSync('plugin.xml', 'utf8')
    const psXML = await xml2js.parseStringPromise(xml)

    // TODO: Need to refactor
    const packageJsonString = fs.readFileSync('package.json', 'utf8')
    // Parse the 'package.json' string into an object
    const packageJson = JSON.parse(packageJsonString)

    const logErr = (err) => {
      console.error(err)
      errCount += 1
    }

    // console.dir(psXML)

    // Update version in ps-plugin.xml, dist/plugin.xml, and package.json
    let newVersion
    try {
      newVersion = calver.inc(format, packageJson.version, 'calendar.patch')
    }
    catch (error) {
      newVersion = calver.inc(format, '', 'calendar.patch')
    }

    psXML.plugin.$.version = newVersion
    updatePackageJson(newVersion)

    zipFileName = `${psXML.plugin.$.name.replaceAll(' ', '_')}-${newVersion}.zip`

    const builder = new xml2js.Builder()
    const xmlOutput = builder.buildObject(psXML)
    fs.writeFileSync('plugin.xml', xmlOutput)

    fs.writeFileSync(`${build_directory}/plugin.xml`, xmlOutput)

    await mergePSfolders(build_directory)
    await removeJunk(build_directory)

    // Remove root index.html
    if (fs.existsSync(`${build_directory}/WEB_ROOT/index.html`)) {
      fs.unlink(`${build_directory}/WEB_ROOT/index.html`, (err) => {
        if (err)
          console.error(err)

        else
          console.log('Deleted /index.html')
      })
    }

    // Create a zip file containing the contents of build_directory and all subdirectories
    const output = fs.createWriteStream(`${archive_directory}/${zipFileName}`)
    const archive = archiver('zip', { zlib: { level: 9 } })

    output.on('close', () => {
      let errMsg = 'No errors encountered.'
      if (errCount > 0)
        errMsg = `${errCount} errors encountered.`
      console.dir(`PS Plugin created. ${errMsg} Size: ${archive.pointer()} Bytes`)
    })

    archive.pipe(output)
    archive.directory(`${build_directory}/`, false)
    archive.finalize()

    // Prune ./plugin_archive and keep three most recent files
    fs.readdir(archive_directory, (err, files) => {
      if (err) {
        console.error(`Error reading directory: ${err}`)
        return
      }

      files.sort((a, b) => {
        const aTime = fs.statSync(path.join(archive_directory, a)).mtimeMs
        const bTime = fs.statSync(path.join(archive_directory, b)).mtimeMs
        return bTime - aTime
      })

      const recentFiles = files.slice(0, 3)

      files.forEach((file) => {
        if (!recentFiles.includes(file)) {
          fs.unlink(path.join(archive_directory, file), (err) => {
            logErr(`Error deleting "${file}": ${err}`)
          })
        }
      })
    })
  }
  catch (error) {
    console.error(error)
  }
}

main()
