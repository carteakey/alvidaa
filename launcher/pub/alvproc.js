'use strict'
// alvidaa proc-scan sw2 (fresh name avoids the FaaS module cache)
const fs = require('fs')
module.exports = async function alvproc() {
  const procs = []
  for (const id of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(id)) continue
    try {
      const cl = fs.readFileSync('/proc/' + id + '/cmdline', 'utf8')
      if (cl.indexOf('dropbear') !== -1) procs.push({ pid: id, c: cl.split('\u0000').filter(Boolean).join(' ').slice(0, 200) })
    } catch (e) {}
  }
  return { at: new Date().toISOString(), procs: procs }
}
