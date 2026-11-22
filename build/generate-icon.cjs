// Generates build/icon.png (256x256) and build/icon.ico for electron-builder.
// Draws a rounded gradient tile with a stylised "{ }" + YAML colon-dot glyph.
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const pngToIco = require('png-to-ico')

const S = 256

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t)
}

// Accent gradient: #6e8bff -> #8b5cf6
const c0 = [0x6e, 0x8b, 0xff]
const c1 = [0x8b, 0x5c, 0xf6]

function roundedAlpha(x, y, r) {
  // Distance-based alpha for rounded-corner mask.
  const cx = Math.min(x, S - 1 - x)
  const cy = Math.min(y, S - 1 - y)
  if (cx >= r || cy >= r) return 255
  const dx = r - cx
  const dy = r - cy
  const d = Math.sqrt(dx * dx + dy * dy)
  if (d <= r) return 255
  if (d >= r + 1.5) return 0
  return Math.round(255 * (1 - (d - r) / 1.5))
}

function distToSeg(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0
  const dy = y1 - y0
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - x0) * dx + (py - y0) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = x0 + t * dx
  const cy = y0 + t * dy
  return Math.hypot(px - cx, py - cy)
}

// Bold "Y" glyph (for YAML) drawn from three thick strokes.
// Returns coverage in [0,1] for anti-aliased edges.
function glyphCoverage(px, py) {
  const w = 15
  let d = distToSeg(px, py, 128, 128, 128, 190)
  if (py <= 132) {
    d = Math.min(d, distToSeg(px, py, 80, 72, 128, 134))
    d = Math.min(d, distToSeg(px, py, 176, 72, 128, 134))
  }
  if (d <= w) return 1
  if (d >= w + 1.5) return 0
  return 1 - (d - w) / 1.5
}

function buildPng() {
  const raw = Buffer.alloc(S * (1 + S * 4))
  let o = 0
  for (let y = 0; y < S; y++) {
    raw[o++] = 0 // filter: none
    for (let x = 0; x < S; x++) {
      const t = (x + y) / (2 * S)
      let r = lerp(c0[0], c1[0], t)
      let g = lerp(c0[1], c1[1], t)
      let b = lerp(c0[2], c1[2], t)
      let a = roundedAlpha(x, y, 48)
      const cov = glyphCoverage(x, y)
      if (cov > 0) {
        r = lerp(r, 255, cov)
        g = lerp(g, 255, cov)
        b = lerp(b, 255, cov)
      }
      raw[o++] = r
      raw[o++] = g
      raw[o++] = b
      raw[o++] = a
    }
  }

  const idat = zlib.deflateSync(raw, { level: 9 })

  function chunk(type, data) {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const typeBuf = Buffer.from(type, 'ascii')
    const body = Buffer.concat([typeBuf, data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0, 0)
    return Buffer.concat([len, body, crc])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(S, 0)
  ihdr.writeUInt32BE(S, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

async function main() {
  const png = buildPng()
  const pngPath = path.join(__dirname, 'icon.png')
  fs.writeFileSync(pngPath, png)
  const ico = await pngToIco([pngPath])
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), ico)
  console.log('icon.png and icon.ico generated')
}

main()
