#!/usr/bin/env node
// cli/index.mjs — the `scroll-animation` command: argument routing, help, error handling.
// bin/scroll-animation runs this.
//
//   commands/add.mjs      scroll-animation add <block…>
//   commands/list.mjs     scroll-animation list
//   commands/media.mjs    scroll-animation media probe|scrub|loop|sequence|poster
//
//   ui.mjs · args.mjs · project.mjs   what the commands share
//   ../lib/registry.mjs               the block catalogue (assets/registry.json)
//
// Exit codes: 0 ok · 1 problems (a refused overwrite, ffmpeg missing, an encode failure) ·
// 2 usage (an unknown command/block/engine, a bad or missing flag value).

import { resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadRegistry } from '../lib/registry.mjs'
import { CliError, fail } from './ui.mjs'
import { parse, wantsHelp } from './args.mjs'
import { cmdAdd } from './commands/add.mjs'
import { cmdList } from './commands/list.mjs'
import { cmdMedia, MEDIA_USAGE } from './commands/media.mjs'

function version() {
  try {
    return loadRegistry().version
  } catch {
    return '0.0.0'
  }
}

const HELP = `scroll-animation ${version()} — copy-and-own scroll motion blocks (GSAP + Motion)

  scroll-animation add <block…> [--engine gsap|motion] [--dir path] [--dry-run] [--force]
      copy blocks and their requires into src/animation (or the project's existing lock
      directory), record hashes in .scroll-animation.lock.json, and print the npm packages
      to install; refuses to overwrite a hand-edited or unrecorded file unless --force

  scroll-animation list [--engine <e>] [--profile <p>] [--json]
      the block catalogue from registry.json

  scroll-animation media probe|scrub|loop|sequence|poster <input> [--out] [flags]
      ffmpeg/ffprobe recipes — scroll-animation media --help lists all five

  --help, -h      this text, or (after a command) just that command's usage
  --version, -v   print the skill version`

// `scroll-animation <command> --help`: that command's own block of HELP (media gets its fuller,
// per-subcommand MEDIA_USAGE instead — see commands/media.mjs), never a run of the command.
const USAGE = {}
{
  let cur = null
  for (const line of HELP.split('\n').slice(2)) {
    const m = /^ {2}scroll-animation (\w+)/.exec(line)
    if (m) cur = USAGE[m[1]] = [line]
    else if (!line.trim()) cur = null
    else if (cur) cur.push(line)
  }
}
const usageOf = (cmd) => (cmd === 'media' ? MEDIA_USAGE : USAGE[cmd].join('\n'))

export async function main(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv
  if (USAGE[cmd] && wantsHelp(rest)) return void console.log(usageOf(cmd))
  if (cmd === 'help' && USAGE[rest[0]]) return void console.log(usageOf(rest[0]))
  const { _, flags } = parse(rest)
  switch (cmd) {
    case 'add':
      return cmdAdd(flags, _)
    case 'list':
      return cmdList(flags)
    case 'media':
      return cmdMedia(flags, _)
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP)
      return
    case '--version':
    case '-v':
      console.log(version())
      return
    default:
      fail(`unknown command "${cmd}"\n\n${HELP}`, 2)
  }
}

/** main() with the CLI's error handling: a CliError is a message and an exit code, not a stack. */
export function run(argv) {
  return main(argv).catch((err) => {
    if (err instanceof CliError) {
      console.error(err.message)
      process.exitCode = err.code
    } else {
      console.error(err.stack ?? String(err))
      process.exitCode = 1
    }
  })
}

const isMain = process.argv[1] && pathToFileURL(resolvePath(process.argv[1])).href === import.meta.url
if (isMain) run()
