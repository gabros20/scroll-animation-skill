// Page-side helpers shared by the split-reveal pages (spike S6's measure.js, typed).

export const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/** The words of `el`'s text grouped into rendered lines, from Range rects: the lines the unsplit text really has. */
export function textLines(el: Element): string[] {
  const range = document.createRange()
  const lines: string[][] = []
  let lastTop: number | null = null
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const words = /\S+/g
    for (let m = words.exec(node.data); m; m = words.exec(node.data)) {
      range.setStart(node, m.index)
      range.setEnd(node, m.index + m[0].length)
      const rect = range.getClientRects()[0]
      if (!rect) continue
      const top = Math.round(rect.top)
      if (lastTop === null || Math.abs(top - lastTop) > 2) {
        lines.push([])
        lastTop = top
      }
      lines[lines.length - 1].push(m[0])
    }
  }
  return lines.map((line) => line.join(' '))
}

/** The element's top in the document. */
export function docTop(el: HTMLElement): number {
  return el.getBoundingClientRect().top + window.scrollY
}

export const frames = (n: number) =>
  new Promise<void>((resolve) => {
    let i = 0
    const step = () => (++i >= n ? resolve() : requestAnimationFrame(step))
    requestAnimationFrame(step)
  })
