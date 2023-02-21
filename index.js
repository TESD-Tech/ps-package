// This script parses an xml file 'ps-plugin.xml', converts it to an object,
// writes the object back to the xml file, and then creates a zip file
// containing the contents of the 'dist' directory.
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
import util from 'util'

const format = 'yy.mm.dd.patch' // CalVer filename format
const archive_directory = 'plugin_archive'
const junkFiles = ['.DS_Store', 'Thumbs.db', 'robots.txt', 'sitemap.xml', 'ssr-manifest.json']
let errCount = 0
let zipFileName

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

const main = async () => {
  try {
    // Parse the xml file 'ps-plugin.xml' using xml2js and store the result in 'psXML'
    const xml = fs.readFileSync('plugin.xml', 'utf8')
    const psXML = await xml2js.parseStringPromise(xml)

    // TODO: Need to refactor
    const packageJsonString = fs.readFileSync('package.json', 'utf8')
    // Parse the 'package.json' string into an object
    const packageJson = JSON.parse(packageJsonString)

    console.log(util.inspect( psXML, {showHidden: false, depth: null, colors: true} ) )
    console.log(util.inspect( packageJson, {showHidden: false, depth: null, colors: true} ) )

    const logErr = (err) => {
      console.error(err)
      errCount += 1
    }

    // console.dir(psXML)

    // Update version in ps-plugin.xml, dist/plugin.xml, and package.json
    const newVersion = calver.inc(format, packageJson.version, 'calendar.patch')
    psXML.plugin.$.version = newVersion
    
    // Write the updated 'package.json' object back to the file
    fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2))

    zipFileName = `${psXML.plugin.$.name.replaceAll(' ', '_')}-${newVersion}.zip`

    const builder = new xml2js.Builder()
    const xmlOutput = builder.buildObject(psXML)
    fs.writeFileSync('plugin.xml', xmlOutput)
    fs.writeFileSync('dist/plugin.xml', xmlOutput)

    // Remove junk files
    await removeJunk('dist')

    // Remove root index.html
    fs.unlink('dist/WEB_ROOT/index.html', (err) => {
      if (err)
        console.error(err)

      else
        console.log(`Deleted /index.html`)
    })

    // Create a zip file containing the contents of 'dist' and all subdirectories
    const output = fs.createWriteStream(`plugin_archive/${zipFileName}`)
    const archive = archiver('zip', { zlib: { level: 9 } })

    output.on('close', () => {
      let errMsg = 'No errors encountered.'
      if (errCount > 0)
        errMsg = `${errCount} errors encountered.`
      console.dir(`PS Plugin created. ${errMsg} Size: ${archive.pointer()} Bytes`)
    })

    archive.pipe(output)
    archive.directory('dist/', false)
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
