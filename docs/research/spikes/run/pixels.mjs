// Painted-frame readout: decode a screencast JPEG and return the bounding box
// of every solid-colour box. Colour classes are loose because WebKit colour
// manages (pure red paints as ~rgb(233,50,35)).
import jpeg from 'jpeg-js'

const CLASSES = {
  red: (r, g, b) => r > 170 && g < 120 && b < 120,
  green: (r, g, b) => g > 140 && r < 160 && b < 130,
  blue: (r, g, b) => b > 170 && r < 100 && g < 100,
  yellow: (r, g, b) => r > 190 && g > 170 && b < 150,
  magenta: (r, g, b) => r > 170 && b > 170 && g < 110,
  cyan: (r, g, b) => g > 160 && b > 160 && r < 150,
  black: (r, g, b) => r < 60 && g < 60 && b < 60
}

export function decode(buf) {
  return jpeg.decode(buf, { useTArray: true, formatAsRGBA: true })
}

/** Connected components (4-connectivity) per colour class, min `minArea` px. */
export function boxes(img, classes = Object.keys(CLASSES), minArea = 150) {
  const { width: W, height: H, data } = img
  const cls = new Uint8Array(W * H)
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const r = data[p]
    const g = data[p + 1]
    const b = data[p + 2]
    for (let c = 0; c < classes.length; c++) {
      if (CLASSES[classes[c]](r, g, b)) {
        cls[i] = c + 1
        break
      }
    }
  }
  const seen = new Uint8Array(W * H)
  const out = []
  const stack = new Int32Array(W * H)
  for (let i = 0; i < W * H; i++) {
    if (!cls[i] || seen[i]) continue
    const c = cls[i]
    let sp = 0
    stack[sp++] = i
    seen[i] = 1
    let minX = W
    let minY = H
    let maxX = -1
    let maxY = -1
    let n = 0
    while (sp) {
      const j = stack[--sp]
      const x = j % W
      const y = (j - x) / W
      n++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x > 0 && cls[j - 1] === c && !seen[j - 1]) (seen[j - 1] = 1), (stack[sp++] = j - 1)
      if (x < W - 1 && cls[j + 1] === c && !seen[j + 1]) (seen[j + 1] = 1), (stack[sp++] = j + 1)
      if (y > 0 && cls[j - W] === c && !seen[j - W]) (seen[j - W] = 1), (stack[sp++] = j - W)
      if (y < H - 1 && cls[j + W] === c && !seen[j + W]) (seen[j + W] = 1), (stack[sp++] = j + W)
    }
    if (n >= minArea) out.push({ c: classes[c - 1], minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1, n })
  }
  return { W, H, boxes: out }
}
