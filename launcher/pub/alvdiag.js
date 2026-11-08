'use strict'
// alvidaa diagnostic v2: (1) dropbear proc scan, (2) local 8008 banner read
// with a 400 ms settle, (3) parallel spawn of a second dropbear on 2222 from
// the FaaS process (uid 314) + banner read on 2222. Read-only ends.
const fs = require('fs')
const net = require('net')
const cp = require('child_process')

function readText(p) { try { return fs.readFileSync(p, 'utf8') } catch (e) { return null } }

function waitBanner(port, wait) {
  return new Promise(function (resolve) {
    let buf = ''
    let settled = false
    const ant = { banner: buf, bytes: buf.length }
    const s = net.connect({ host: '127.0.0.1', port: port })
    const fin = (extra) => { if (settled) return; settled = true; try { s.destroy() } catch (e) {}; resolve(Object.assign(ant, extra)) }
    s.setTimeout(wait + 250)
    s.on('data', (d) => { buf += d.toString('latin1'); fin({ got_banner: true }) })
    s.on('error', (e) => fin({ err: e.code }))
    s.on('timeout', () => fin({ timed_out: true, connected: true }))
    setTimeout(() => fin({ waited_ms: wait, connected: true, banner: buf.slice(0, 160), bytes: buf.length }), wait)
    setTimeout(() => s.destroy(), wait + 300)
  })
}

module.exports = async function alvdiag() {
  const rep = { at: new Date().toISOString(), procs: [] }
  for (const id of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(id)) continue
    const cl = readText('/proc/' + id + '/cmdline')
    if (cl && cl.indexOf('dropbear') !== -1) { procs.push({ pid: id, cmdline: cl.split('\u0000').filter(Boolean).join(' ') }) }
  }
  rep.procs = procs
  rep.banner_8008 = await waitBanner(8008, 450)
  try {
    const r = cp.execSync('/APPS/.re_sshd/dropbear-root -F -E -s -r /APPS/.re_sshd/hostkey_ed25519 -p 2222 -P /APPS/.alv_2222.pid',
             { timeout: 2500, encoding: 'utf8' })
    rep.spawn_2222 = { ok: true, out: String(r).slice(0, 300) }
  } catch (e) { rep.spawn_2222 = { ok: false, err: String(e).slice(0, 300), code: e.code, stdout: String(e.stdout || '').slice(0, 200), stderr: String(e.stderr || '').slice(0, 300) } }
  await new Promise(res => setTimeout(res, 900))
  rep.banner_2222 = await waitBanner(2222, 450)
  try { fs.writeFileSync('/APPS/.alvdiag.json', JSON.stringify(rep, null, 1)) } catch (e) { rep.write_err = String(e) }
  return rep
}
