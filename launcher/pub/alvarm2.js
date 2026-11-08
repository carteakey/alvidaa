'use strict'
// alvidaa arming forwarder (55E7QTUK): superwatch socket client with the
// vendor framing (4-byte LE length prefix + payload). The trigger page
// supplies {"list":["<sid>:<cmd>:<sid>;..."]}; each entry is one connection.
// Replies are "<sid>:<rc>" frames. Writes its report to /APPS/.sw2probe.json.
const net = require('net')
const fs = require('fs')

function forwardOnce(item) {
  return new Promise(function (resolve) {
    const chunks = []
    let done = false
    const fin = (extra) => { if (done) return; done = true; try { sock.destroy() } catch (e) {}
      resolve(Object.assign({ reply: Buffer.concat(chunks).toString('latin1') }, extra || {})) }
    let sock
    try { sock = net.createConnection('/var/run/superwatch_socket') }
    catch (e) { return resolve({ err: 'connect ' + e }) }
    sock.setTimeout(20000)
    sock.on('connect', function () {
      try {
        const b = Buffer.from(item, 'utf8')
        const h = Buffer.alloc(4)
        h.writeUInt32LE(b.length, 0)
        sock.write(Buffer.concat([h, b]))
      } catch (e) { fin({ err: 'write ' + e }) }
    })
    sock.on('data', (d) => chunks.push(d))
    sock.on('end', () => fin({ end: true }))
    sock.on('close', () => fin({ end: true }))
    sock.on('timeout', () => fin({ timed_out: true }))
    sock.on('error', (e) => fin({ err: e.code + ': ' + e.message }))
  })
}

module.exports = async function alvarm2(args) {
  const rep = { at: new Date().toISOString(), uid: process.getuid(), results: [] }
  const list = (args && Array.isArray(args.list)) ? args.list : []
  for (const entry of list) {
    const r = await forwardOnce(String((entry && entry.item != null) ? entry.item : entry))
    r.sent = (entry && entry.item != null) ? entry.item : String(entry)
    rep.results.push(r)
  }
  try { fs.writeFileSync('/APPS/.sw2probe.json', JSON.stringify(rep, null, 1)) } catch (e) { rep.write_err = String(e) }
  return rep
}
