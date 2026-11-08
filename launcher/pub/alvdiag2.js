'use strict'
// v3: incremental writes after every measurement; no child-exec steps.
const fs = require('fs')
const net = require('net')
function readText(p) { try { return fs.readFileSync(p, 'utf8') } catch (e) { return null } }
function save(patch) {
  try {
    const cur = fs.existsSync('/APPS/.alvdiag.json') ? JSON.parse(fs.readFileSync('/APPS/.alvdiag.json', 'utf8')) : {}
    fs.writeFileSync('/APPS/.alvdiag.json', JSON.stringify(Object.assign(cur, patch), null, 1))
  } catch (e) {}
}
function waitBanner(port, wait) {
  return new Promise(function (resolve) {
    let buf = ''
    let settled = false
    const s = net.connect({ host: '127.0.0.1', port: port })
    const fin = (extra) => { if (settled) return; settled = true; try { s.destroy() } catch (e) {}; resolve(Object.assign({ bytes: buf.length, banner: buf.slice(0, 160) }, extra)) }
    s.setTimeout(wait + 300)
    s.on('data', (d) => { buf += d.toString('latin1'); fin({ got_banner: true }) })
    s.on('error', (e) => fin({ err: e.code }))
    s.on('timeout', () => fin({ timed_out: true, connected: true }))
    setTimeout(() => fin({ waited_ms: wait, connected: true }), wait)
    setTimeout(() => s.destroy(), wait + 350)
  })
}
module.exports = async function alvdiag2() {
  const procs = []
  for (const id of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(id)) continue
    const cl = readText('/proc/' + id + '/cmdline')
    if (cl && cl.indexOf('dropbear') !== -1) procs.push({ pid: id, c: cl.split('\u0000').filter(Boolean).join(' ').slice(0, 160) })
  }
  save({ at: new Date().toISOString(), procs: procs })
  save({ banner_8008_A: await waitBanner(8008, 400) })
  // second, longer read: some servers flush late
  save({ banner_8008_B: await waitBanner(8008, 1300) })
  save({ done: true })
  return { done: true }
}
