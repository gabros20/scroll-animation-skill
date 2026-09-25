// list.mjs — scroll-animation list [--engine <e>] [--profile <p>] [--json]

import { loadRegistry } from '../../lib/registry.mjs'
import { c, fail, prettyJson } from '../ui.mjs'

export async function cmdList(flags) {
  if (flags.engine === true) fail('--engine wants a value', 2)
  if (flags.profile === true) fail('--profile wants a value', 2)
  const engineFilter = typeof flags.engine === 'string' ? flags.engine : undefined
  const profileFilter = typeof flags.profile === 'string' ? flags.profile : undefined

  const registry = loadRegistry()
  const blocks = registry.blocks ?? {}
  const ids = Object.keys(blocks)
    .filter((id) => !engineFilter || Object.keys(blocks[id].engines ?? {}).includes(engineFilter))
    .filter((id) => !profileFilter || (blocks[id].profiles ?? []).includes(profileFilter))
    .sort()

  if (flags.json) {
    console.log(prettyJson(Object.fromEntries(ids.map((id) => [id, blocks[id]]))))
    return
  }
  if (!ids.length) {
    console.log('No blocks match.')
    return
  }
  const width = Math.max(...ids.map((id) => id.length))
  console.log(`${c.bold('scroll-animation')} ${registry.version} — ${ids.length} block(s)\n`)
  for (const id of ids) {
    const b = blocks[id]
    const engines = Object.keys(b.engines ?? {}).join(', ')
    console.log(`  ${id.padEnd(width)}  ${c.dim(`[${b.clock}/${b.tier}]`.padEnd(20))}  ${c.dim(`(${engines})`.padEnd(14))}  ${b.summary}`)
  }
}
