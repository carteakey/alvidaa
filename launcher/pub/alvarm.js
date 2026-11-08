'use strict'
// alvidaa diagnostic sw2 v4: process discovery for dropbear + local TCP probe
// of the dropbear listener from inside the TV. Read-only.
const fs = require('fs')
const net = require('net')

function readText(p) { try { return fs.readFileSync(p, 'utf8') } catch (e) { return null } }

module.exports = async function sw2(args) {
  const rep = { at: new Date().toISOString() }
  // dropbear process discovery via /proc
  const procs = []
  for (const id of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(id)) continue
    const cl = readText('/proc/' + id + '/cmdline')
    if (cl && cl.indexOf('dropbear') !== -1) {
      procs.push({ pid: id, cmdline: cl.split('\u0000').filter(Boolean).join(' ') })
    }
  }
  rep.dropbear_procs = procs
  // local TCP probe: dropbear speaks its banner FIRST
  rep.local_probe = await new Promise(function (resolve) {
    let buf = ''
    const s = net.connect({ host: '127.0.0.1', port: 8008 })
    let settled = false
    const fin = (extra) => { if (settled) return; settled = true; try { s.destroy() } catch (e) {}; resolve(Object.assign({ banner: buf.slice(0, 120) }, extra || {})) }
    s.setTimeout(4000)
    s.on('connect', () => fin({ connected: true }))
    s.on('data', (d) => { buf += d.toString('latin1'); fin({ got_banner: true }) })
    s.on('error', (e) => fin({ err: e.code }))
    s.on('timeout', () => fin({ timed_out: true, connected: true }))
  })
  // firewall chain snapshot from a non-root reader (headers only)
  rep.proc_net_tcp_8008 = (function () {
    try {
      const t = readText('/proc/net/tcp') || ''
      return t.split('\n').filter(l => l.indexOf(':1F48') !== -1)[0] || null
    } catch (e) { return 'ERR ' + e }
  })()
  try { fs.writeFileSync('/APPS/.sw2probe.json', JSON.stringify(rep, null, 1)) } catch (e) { rep.write_err = String(e) }
  return rep
}
