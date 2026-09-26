/**
 * media/frame-sequence.ts — an image sequence scrubbed on a <canvas> from a 0–1 progress, holding only a DECODE
 * WINDOW of frames in memory. Engine-agnostic: motion/FrameSequence.tsx and gsap/frame-sequence.ts feed it progress.
 *
 *   const seq = createFrameSequence(canvas, { manifest: '/media/hero/manifest.json', mobile: true })
 *   seq.setProgress(p)   // exact progress, from the producer's own tick (a pinned scene, ScrollTrigger, useScroll)
 *   await seq.ready      // the first frame is drawn and the prefix is in memory
 *   seq.destroy()        // closes every bitmap and aborts the fetches; the canvas keeps its last pixels
 *
 * Decoding a whole sequence up front is the trap: 120 frames at 1600×900 are 690 MB of RGBA. So the network side
 * keeps frames COMPRESSED (one Blob each, 20–40 kB of WebP), and only the frames around the current one are
 * decoded, at the size they are drawn, into an LRU of ImageBitmaps bounded by a byte budget. Every bitmap that
 * leaves it is close()d: its pixels live outside the JS heap and the GC is in no hurry to free them.
 *
 * Input. `manifest` is the manifest.json `scroll-animation media sequence` writes (this reads its `frames`, `width`
 * and `height`), as a URL or an imported object (give it `base`, the URL its frame names resolve against), or plain
 * frame URLs in order. `mobile: true` adds the variant `--mobile-width` writes to mobile/manifest.json (or pass its
 * URL or object): both manifests load and the smallest variant at least the canvas's CSS width × min(dpr, dprCap)
 * wide wins, else the widest. Picked once; a rotation doesn't refetch the sequence.
 *
 * Loading, once the canvas is within `warmMargin` viewports: the frame on screen first (high priority), then the
 * `prefix` frames from the top, the last frame (where a finished scroll rests), then coarse to fine over the rest
 * (every 64th frame, every 32nd, …), so a fast early scrub steps through the whole sequence instead of stalling where
 * the fetch got to. A frame the scrub needs before its turn jumps the queue. Leaving the warm margin pauses the queue.
 *
 * Decode window. Within `wakeMargin` viewports, the frames around the current one decode with
 * `createImageBitmap(blob, { resizeWidth, resizeHeight })` at the size they are drawn (never above the source's
 * size; at full size when that is within 10%, where a resample saves little), in a worker: WebKit decodes on the
 * main thread otherwise, a dropped frame per decode (see "the decode worker" below). The window holds as many
 * frames as the budget does, three quarters of them ahead in the direction of travel. A browser that ignores or
 * rejects the resize options is detected on the first decode and gets full-size bitmaps that drawImage scales.
 * Default budgets (bitmap bytes = w × h × 4; `navigator.deviceMemory` is Chromium-only):
 *
 *   deviceMemory        ≤ 1 GB   2 GB    4 GB    8 GB     unknown (Safari, Firefox)
 *   budget              24 MiB   48 MiB  96 MiB  192 MiB  64 MiB
 *   1600×900 frames     4        8       17      34       11
 *   900×506 (mobile)    13       27      55      110      36
 *
 * A budget below two frames at the decode size is raised to two: the one on screen and the next.
 *
 * Drawing. The backing store is the canvas's CSS size × min(devicePixelRatio, dprCap), redrawn on resize, and never
 * finer than the frames: a 1600×900 sequence covering a 1440×900 box on a 2× screen gets 1440×900, not 2880×1800, and
 * the compositor scales it up. The extra pixels would only hold an upscale, and repainting them dropped ~47% of the
 * scroll frames in headless Chromium (2880×1800), none at 1440×900, at a quarter of the canvas memory. Also capped at
 * 16.7 MP, Safari's canvas limit. SIZE THE CANVAS WITH CSS (display: block; width/height: 100%): its backing store
 * follows its CSS box, and an unsized canvas takes its size from the backing store, which grows it without end. The
 * canvas only ever shows decoded frames: while the exact frame decodes it holds the nearest decoded one, and upgrades
 * when the exact one lands. `data-frame` on the canvas is the index drawn (for tests). Nothing decodes or draws
 * outside `wakeMargin`; outside `warmMargin` the decoded frames are released too (the blobs stay).
 *
 * Reduced motion ('user' follows the OS setting live): one static frame, `reducedMotionFrame` (negative counts from
 * the end; default 0, the head a pinned scene holds under reduced motion and a frame the prefix has already loaded),
 * and nothing else is fetched or decoded.
 *
 * Frames on another origin need CORS headers: they are fetched, not loaded by <img>.
 */
import { REDUCED_MOTION_QUERY } from '../config'

// ── types ───────────────────────────────────────────────────────────────

/** What `scroll-animation media sequence` writes as manifest.json (and mobile/manifest.json). */
export interface FrameManifest {
  count?: number
  /** Frame size in px; 0 or missing means "learn it from the first frame". */
  width?: number
  height?: number
  format?: string
  /** Frame file names, in order, relative to the manifest's URL (or to `base`). */
  frames: readonly string[]
  /** Compressed bytes of all frames. */
  bytes?: number
  /** For a manifest passed as an object: the URL its frame names resolve against. */
  base?: string
}

/** A manifest.json URL, a manifest object, or plain frame URLs in order. */
export type FrameSource = string | FrameManifest | readonly string[]

export type FrameFit = 'cover' | 'contain'

export interface FrameSequenceOptions {
  manifest: FrameSource
  /** The narrow variant: true for mobile/manifest.json beside `manifest`, or its URL or object. Manifests only. */
  mobile?: string | FrameManifest | true
  /** Default 'cover'. */
  fit?: FrameFit
  /** Where the frame sits in the canvas when it overflows or letterboxes, like object-position, as fractions. */
  position?: readonly [number, number]
  /** The highest devicePixelRatio the backing store follows. Default 2: past 2× a phone pays decode and fill cost for
   * detail nobody sees. The frames' own size caps it below that anyway; 1 makes a heavy page lighter still. */
  dprCap?: number
  /** Frames from the top fetched right after the first; `ready` waits for them. Default 12. */
  prefix?: number
  /** Decoded-bitmap budget in bytes. Default: by navigator.deviceMemory (table above). */
  budgetBytes?: number
  /** 'user' (default) follows prefers-reduced-motion live; 'always' / 'never' force it. */
  reducedMotion?: 'user' | 'always' | 'never'
  /** The static frame under reduced motion; negative counts from the end (-1: the last). Default 0: the head a pinned
   * scene holds under reduced motion. */
  reducedMotionFrame?: number
  /** Viewports above and below the fold within which frames are fetched. Default 1.5. */
  warmMargin?: number
  /** Viewports within which frames decode and draw. Default 0.5. */
  wakeMargin?: number
  /** Frame fetches in flight. Default 4. */
  fetchConcurrency?: number
  /** Decodes in flight. Default 2. */
  decodeConcurrency?: number
  /** createImageBitmap's resample quality. Default 'high': the resized frame is drawn 1:1, so this IS the image. */
  resizeQuality?: ResizeQuality
  /** Decode in the shared worker (default true). false decodes on the main thread: for a CSP that can't allow
   * `worker-src blob:` (a blocked worker falls back by itself, after the browser's CSP error). */
  worker?: boolean
}

export interface FrameSequenceStats {
  /** idle: waiting to come near · loading · ready · error · destroyed */
  state: 'idle' | 'loading' | 'ready' | 'error' | 'destroyed'
  /** The manifest URL in use ('object' for a manifest object, 'list' for frame URLs); null until it loads. */
  variant: string | null
  count: number
  /** The index on the canvas (-1 before the first draw) and the one progress asks for. */
  frame: number
  target: number
  reduced: boolean
  warm: boolean
  awake: boolean
  /** Backing store px. */
  canvas: { width: number; height: number }
  /** The size frames decode at. */
  decodeSize: { width: number; height: number }
  /** Whether this browser honours createImageBitmap's resize options, and where frames decode. */
  resize: ResizeSupport['resize']
  decoder: 'worker' | 'main'
  fetched: number
  fetchedBytes: number
  failed: number
  /** Live bitmaps, their bytes (w × h × 4), the most ever held at once, and bytes held for decodes in flight. */
  decoded: number
  decodedBytes: number
  peakDecodedBytes: number
  reservedBytes: number
  budgetBytes: number
  /** Frames the budget holds at the decode size. */
  capacity: number
  inflight: { fetch: number; decode: number }
  /** Bitmaps created and closed so far: equal once destroyed and settled. */
  decodes: number
  closed: number
  decodeMs: { last: number; avg: number; max: number }
}

export interface FrameSequence {
  /** Exact progress, 0–1 (clamped). Draws synchronously when the frame changes, so call it in the producer's tick. */
  setProgress(progress: number): void
  /** Resolves once the first frame is drawn and the prefix is in memory (under reduced motion: the static frame). */
  readonly ready: Promise<void>
  stats(): FrameSequenceStats
  /** Closes every bitmap (in-flight decodes close on arrival), aborts fetches, disconnects observers, and stops the
   * decode worker with the page's last sequence. Idempotent. */
  destroy(): void
}

// ── numbers ─────────────────────────────────────────────────────────────

export const MIB = 1024 * 1024
/** Safari refuses a canvas over 4096 × 4096 px of area. */
export const MAX_CANVAS_AREA = 4096 * 4096
/** Within this fraction of the source size, decode at full size: the resample would save little memory. */
const FULL_SIZE_ABOVE = 0.9
/** A resize that moves the decode size less than this keeps the decoded frames; drawImage scales them. */
const RESIZE_TOLERANCE = 0.1
/** Share of the decode window ahead in the direction of travel. */
const LEAD = 0.75
/** How many of the window's first frames may jump the fetch queue. */
const BUMP_AHEAD = 3
const CENTER = [0.5, 0.5] as const

// ── pure maths (unit-tested) ────────────────────────────────────────────

/** The frame for a progress: 0 → the first, 1 → the last, linear between. */
export function frameIndex(progress: number, count: number): number {
  if (count <= 1 || !(progress > 0)) return 0
  if (progress >= 1) return count - 1
  return Math.round(progress * (count - 1))
}

/** Index of the smallest variant at least `cssWidth × min(dpr, dprCap)` px wide, else of the widest. */
export function pickVariant(widths: readonly number[], cssWidth: number, dpr: number, dprCap = 2): number {
  const need = cssWidth * Math.min(dpr || 1, dprCap)
  let fit = -1
  let widest = 0
  widths.forEach((w, i) => {
    if (w > widths[widest]) widest = i
    if (w >= need && (fit < 0 || w < widths[fit])) fit = i
  })
  return fit >= 0 ? fit : widest
}

/**
 * The canvas backing store for a CSS size: × min(dpr, dprCap), and never finer than `frame` (the frame is never
 * drawn larger than its own pixels: past that the canvas would only hold an upscale, which the compositor does for
 * free), rounded, and scaled down past MAX_CANVAS_AREA.
 */
export function backingSize(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  dprCap = 2,
  frame?: { width: number; height: number; fit?: FrameFit },
): { width: number; height: number } {
  let scale = Math.min(dpr || 1, dprCap)
  if (frame?.width && frame.height) {
    const sx = cssWidth / frame.width
    const sy = cssHeight / frame.height
    scale = Math.min(scale, 1 / (frame.fit === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy)))
  }
  const area = cssWidth * cssHeight * scale * scale
  if (area > MAX_CANVAS_AREA) scale *= Math.sqrt(MAX_CANVAS_AREA / area)
  return { width: Math.max(1, Math.round(cssWidth * scale)), height: Math.max(1, Math.round(cssHeight * scale)) }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Where a source-sized frame lands in a box under cover/contain, placed by `position` (fractions). */
export function fitRect(
  srcWidth: number,
  srcHeight: number,
  boxWidth: number,
  boxHeight: number,
  fit: FrameFit = 'cover',
  position: readonly [number, number] = CENTER,
): Rect {
  const sx = boxWidth / srcWidth
  const sy = boxHeight / srcHeight
  const scale = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy)
  const width = srcWidth * scale
  const height = srcHeight * scale
  return { x: (boxWidth - width) * position[0], y: (boxHeight - height) * position[1], width, height }
}

/** The size to decode a frame at: as drawn, never above the source, and the source itself within 10% of it. */
export function decodeSize(
  srcWidth: number,
  srcHeight: number,
  boxWidth: number,
  boxHeight: number,
  fit: FrameFit = 'cover',
): { width: number; height: number } {
  const r = fitRect(srcWidth, srcHeight, boxWidth, boxHeight, fit)
  if (r.width / srcWidth >= FULL_SIZE_ABOVE) return { width: srcWidth, height: srcHeight }
  return { width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) }
}

/** Decoded RGBA bytes. */
export function bitmapBytes(width: number, height: number): number {
  return width * height * 4
}

/** The default decoded-bitmap budget: 24 MiB per GB of deviceMemory, clamped to 24–192 MiB; 64 MiB when unknown. */
export function defaultBudgetBytes(deviceMemory?: number): number {
  if (!deviceMemory || !Number.isFinite(deviceMemory) || deviceMemory <= 0) return 64 * MIB
  return Math.min(192, Math.max(24, deviceMemory * 24)) * MIB
}

/**
 * The decode window around `target`, in decode order: `capacity` contiguous frames, three quarters ahead in the
 * direction of travel (half when it's unknown, 0), shifted inward at the ends. Ahead and behind interleave by
 * distance over share, so the frames the scrub reaches first decode first.
 */
export function windowOrder(target: number, count: number, capacity: number, direction = 0): number[] {
  const size = Math.max(1, Math.min(capacity, count))
  const dir = direction < 0 ? -1 : 1
  const lead = direction === 0 ? 0.5 : LEAD
  const roomAhead = dir > 0 ? count - 1 - target : target
  const roomBehind = dir > 0 ? target : count - 1 - target
  let ahead = Math.round((size - 1) * lead)
  let behind = size - 1 - ahead
  if (ahead > roomAhead) {
    behind += ahead - roomAhead
    ahead = roomAhead
  }
  if (behind > roomBehind) {
    ahead = Math.min(roomAhead, ahead + behind - roomBehind)
    behind = roomBehind
  }
  const out = [target]
  for (let a = 1, b = 1; a <= ahead || b <= behind; ) {
    if (a <= ahead && (b > behind || a / lead <= b / (1 - lead))) out.push(target + dir * a++)
    else out.push(target - dir * b++)
  }
  return out
}

/** Fetch order: `first`, the prefix from the top, the last frame, then coarse to fine over the rest. */
export function fetchOrder(count: number, prefix: number, first = 0): number[] {
  const seen = new Uint8Array(count)
  const out: number[] = []
  const add = (i: number) => {
    if (i < 0 || i >= count || seen[i]) return
    seen[i] = 1
    out.push(i)
  }
  add(first)
  for (let i = 0; i < Math.min(prefix, count); i++) add(i)
  add(count - 1)
  let step = 1
  while (step * 2 < count) step *= 2
  for (; step >= 1; step /= 2) for (let i = 0; i < count; i += step) add(i)
  return out
}

// ── the cache ───────────────────────────────────────────────────────────

interface Closable {
  close(): void
}

/**
 * An LRU of decoded frames bounded by bytes. `rank(key)` sorts eviction candidates into classes: the least recently
 * used entry of the lowest class goes first, and a rank of Infinity is never evicted. `reserve()` holds room for a
 * decode in flight, so the bytes held plus the bytes reserved never pass the budget, and `set()` refuses (returns
 * false, the caller keeps the value) rather than go over. Every value that leaves is close()d exactly once.
 */
export class BitmapCache<K, V extends Closable> {
  budget: number
  /** Bytes held, the most ever held, bytes reserved for decodes in flight, values closed. */
  bytes = 0
  peak = 0
  reserved = 0
  closed = 0
  private readonly entries = new Map<K, { value: V; bytes: number }>()
  private readonly rank: (key: K) => number

  constructor(budget: number, rank: (key: K) => number = () => 0) {
    this.budget = budget
    this.rank = rank
  }

  get size(): number {
    return this.entries.size
  }

  has(key: K): boolean {
    return this.entries.has(key)
  }

  keys(): IterableIterator<K> {
    return this.entries.keys()
  }

  /** The value, without touching its recency. */
  peek(key: K): V | undefined {
    return this.entries.get(key)?.value
  }

  /** The value, marked most recently used. */
  get(key: K): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  /** Makes room for `bytes` (evicting) and holds it; false when the protected entries leave no room. */
  reserve(bytes: number): boolean {
    if (!this.fit(bytes)) return false
    this.reserved += bytes
    return true
  }

  release(bytes: number): void {
    this.reserved = Math.max(0, this.reserved - bytes)
  }

  /** Stores `value` as most recently used, turning `reserved` bytes of a reservation into it. */
  set(key: K, value: V, bytes: number, reserved = 0): boolean {
    this.release(reserved)
    const old = this.entries.get(key)
    if (!this.fit(bytes - (old?.bytes ?? 0), key)) return false
    if (old) this.remove(key, old)
    this.entries.set(key, { value, bytes })
    this.bytes += bytes
    this.peak = Math.max(this.peak, this.bytes)
    return true
  }

  delete(key: K): boolean {
    const entry = this.entries.get(key)
    if (!entry) return false
    this.remove(key, entry)
    return true
  }

  /** Closes every entry `keep` rejects. */
  retain(keep: (key: K) => boolean): void {
    for (const [key, entry] of [...this.entries]) if (!keep(key)) this.remove(key, entry)
  }

  /** A new budget, evicting down to it where the ranks allow. */
  setBudget(budget: number): void {
    this.budget = budget
    this.fit(0)
  }

  clear(): void {
    this.retain(() => false)
  }

  private fit(extra: number, except?: K): boolean {
    while (this.bytes + this.reserved + extra > this.budget) if (!this.evictOne(except)) return false
    return true
  }

  private evictOne(except?: K): boolean {
    let victim: { key: K; entry: { value: V; bytes: number } } | null = null
    let lowest = Infinity
    for (const [key, entry] of this.entries) {
      if (key === except) continue
      const r = this.rank(key)
      if (r < lowest) {
        lowest = r
        victim = { key, entry }
        if (r <= 0) break
      }
    }
    if (!victim) return false
    this.remove(victim.key, victim.entry)
    return true
  }

  private remove(key: K, entry: { value: V; bytes: number }): void {
    this.entries.delete(key)
    this.bytes -= entry.bytes
    this.closed++
    try {
      entry.value.close()
    } catch {
      // already closed
    }
  }
}

// ── decoding ────────────────────────────────────────────────────────────

export type CreateBitmap = (blob: Blob, options?: ImageBitmapOptions) => Promise<ImageBitmap>

export interface ResizeSupport {
  resize: 'unknown' | 'yes' | 'no'
}

/** One verdict per page: the first frame that asks for a resize settles it. */
const SUPPORT: ResizeSupport = { resize: 'unknown' }

const onMainThread: CreateBitmap = (blob, options) =>
  options ? createImageBitmap(blob, options) : createImageBitmap(blob)

/**
 * Decodes a frame at width × height (0 × 0: full size) with createImageBitmap's resize options, detecting support:
 * a browser that ignores them hands back the full-size bitmap (kept: drawImage scales it), and one that rejects them
 * gets a plain retry. Either way `support.resize` turns 'no' and later frames skip the options. A frame that fails
 * both ways is a bad frame, and the verdict stays open. `create` is where the decode runs (the worker, by default).
 */
export async function decodeFrame(
  blob: Blob,
  width: number,
  height: number,
  quality: ResizeQuality = 'high',
  support: ResizeSupport = SUPPORT,
  create: CreateBitmap = onMainThread,
): Promise<ImageBitmap> {
  if (width > 0 && height > 0 && support.resize !== 'no') {
    let bitmap: ImageBitmap
    try {
      bitmap = await create(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: quality })
    } catch (err) {
      if (support.resize === 'yes' || (err as Error)?.name === 'AbortError') throw err
      const plain = await create(blob)
      support.resize = 'no'
      return plain
    }
    support.resize = bitmap.width === width && bitmap.height === height ? 'yes' : 'no'
    return bitmap
  }
  return create(blob)
}

// ── the decode worker ───────────────────────────────────────────────────
//
// WebKit runs createImageBitmap(blob) on the main thread: a 1600×900 WebP blocks it 12–16 ms (measured), a dropped
// frame per decode while scrubbing, every one at 120 Hz. Chromium blocks 5–8 ms once resize options are set. In a
// worker the same decodes block it ≤ 1 ms, and the bitmap comes back transferred, not copied. One worker per page,
// shared by every sequence, started from an inline source (a blob: URL, so a CSP needs `worker-src blob:`) and
// terminated with the last sequence. If it can't start (an error, or no hello within WORKER_START_MS) its jobs and
// every later one decode on the main thread; `worker: false` goes there directly.

const WORKER_SOURCE = `postMessage({ hello: true })
onmessage = (e) => {
  const { id, blob, options } = e.data
  ;(options ? createImageBitmap(blob, options) : createImageBitmap(blob)).then(
    (bitmap) => postMessage({ id, bitmap }, [bitmap]),
    (error) => postMessage({ id, name: error?.name || 'Error', message: String(error?.message || error) }),
  )
}`
const WORKER_START_MS = 2000

interface WorkerReply {
  hello?: true
  id: number
  bitmap?: ImageBitmap
  name?: string
  message?: string
}

interface Job {
  blob: Blob
  options?: ImageBitmapOptions
  resolve: (bitmap: ImageBitmap) => void
  reject: (error: unknown) => void
}

const pool = {
  worker: null as Worker | null,
  url: '',
  users: 0,
  failed: false,
  started: false,
  jobs: new Map<number, Job>(),
  nextId: 0,
}

function workerFailed() {
  pool.failed = true
  pool.worker?.terminate()
  pool.worker = null
  for (const job of pool.jobs.values()) onMainThread(job.blob, job.options).then(job.resolve, job.reject)
  pool.jobs.clear()
}

function startWorker(): Worker | null {
  if (pool.worker || pool.failed || !pool.users) return pool.worker
  try {
    pool.url ||= URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }))
    const worker = new Worker(pool.url)
    pool.started = false
    const watchdog = setTimeout(() => pool.worker === worker && !pool.started && workerFailed(), WORKER_START_MS)
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const { hello, id, bitmap, name, message } = e.data
      if (hello) {
        // (a hello from a worker already replaced must not vouch for the new one)
        if (pool.worker === worker) pool.started = true
        clearTimeout(watchdog)
        return
      }
      // Job ids never repeat across workers, so a late reply from a stopped worker finds no job and is closed.
      const job = pool.jobs.get(id)
      pool.jobs.delete(id)
      if (!job) bitmap?.close()
      else if (bitmap) job.resolve(bitmap)
      else job.reject(new DOMException(message, name))
    }
    worker.onerror = (e) => {
      e.preventDefault()
      clearTimeout(watchdog)
      if (pool.worker === worker) workerFailed()
    }
    pool.worker = worker
  } catch {
    pool.failed = true
  }
  return pool.worker
}

const inWorker: CreateBitmap = (blob, options) => {
  const worker = startWorker()
  if (!worker) return onMainThread(blob, options)
  return new Promise((resolve, reject) => {
    const id = pool.nextId++
    pool.jobs.set(id, { blob, options, resolve, reject })
    worker.postMessage({ id, blob, options })
  })
}

/** The last sequence is gone: stop the worker, and settle its jobs so their callbacks run (and see `destroyed`). */
function releaseWorker() {
  if (--pool.users > 0) return
  pool.users = 0
  pool.worker?.terminate()
  pool.worker = null
  for (const job of pool.jobs.values()) job.reject(new DOMException('the decode worker was stopped', 'AbortError'))
  pool.jobs.clear()
}

// ── sources ─────────────────────────────────────────────────────────────

interface Variant {
  name: string
  urls: string[]
  width: number
  height: number
}

function isFrameList(source: FrameSource): source is readonly string[] {
  return Array.isArray(source)
}

function checkManifest(value: unknown, where: string): FrameManifest {
  const m = value as FrameManifest | null
  if (!m || !Array.isArray(m.frames) || !m.frames.length || m.frames.some((f) => typeof f !== 'string')) {
    throw new TypeError(`${where}: not a frame manifest (expected a non-empty "frames" list of file names)`)
  }
  return m
}

async function loadSource(source: FrameSource, signal: AbortSignal): Promise<Variant> {
  if (isFrameList(source)) {
    if (!source.length) throw new TypeError('the frame list is empty')
    return { name: 'list', urls: source.map((u) => new URL(u, document.baseURI).href), width: 0, height: 0 }
  }
  let manifest: FrameManifest
  let base: string
  let name: string
  if (typeof source === 'string') {
    const url = new URL(source, document.baseURI).href
    const res = await fetch(url, { signal, priority: 'high' })
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    manifest = checkManifest(await res.json(), url)
    base = res.url || url
    name = url
  } else {
    manifest = checkManifest(source, 'manifest')
    base = new URL(manifest.base ?? '', document.baseURI).href
    name = 'object'
  }
  return {
    name,
    urls: manifest.frames.map((f) => new URL(f, base).href),
    width: manifest.width ?? 0,
    height: manifest.height ?? 0,
  }
}

function mobileSource(options: FrameSequenceOptions): string | FrameManifest | null {
  const { manifest, mobile } = options
  if (!mobile || isFrameList(manifest)) return null
  if (mobile !== true) return mobile
  if (typeof manifest === 'string') return new URL('mobile/manifest.json', new URL(manifest, document.baseURI)).href
  if (manifest.base) return new URL('mobile/manifest.json', new URL(manifest.base, document.baseURI)).href
  warn('mobile: true needs a manifest URL, or a manifest object with `base`; using the one manifest')
  return null
}

function warn(message: string): void {
  if (typeof console !== 'undefined') console.warn(`[scroll-animation] frame-sequence: ${message}`)
}

// ── the sequence ────────────────────────────────────────────────────────

export function createFrameSequence(canvas: HTMLCanvasElement, options: FrameSequenceOptions): FrameSequence {
  const {
    fit = 'cover',
    position = CENTER,
    dprCap = 2,
    prefix = 12,
    reducedMotion = 'user',
    reducedMotionFrame = 0,
    warmMargin = 1.5,
    wakeMargin = 0.5,
    fetchConcurrency = 4,
    decodeConcurrency = 2,
    resizeQuality = 'high',
    worker: useWorker = true,
  } = options
  const context = canvas.getContext('2d')
  if (!context) throw new Error('frame-sequence: the canvas already has a non-2d context')
  const ctx: CanvasRenderingContext2D = context
  const requestedBudget =
    options.budgetBytes ?? defaultBudgetBytes((navigator as Navigator & { deviceMemory?: number }).deviceMemory)
  const create = useWorker && typeof Worker !== 'undefined' ? inWorker : onMainThread
  if (create === inWorker) pool.users++

  let state: FrameSequenceStats['state'] = 'idle'
  let destroyed = false
  let started = false
  const abort = new AbortController()

  // frames
  let variant: string | null = null
  let urls: string[] = []
  let count = 0
  let srcW = 0
  let srcH = 0
  let staticFrame = 0
  let blobs: (Blob | null | undefined)[] = [] // undefined: not fetched · null: failed
  let order: number[] = []
  let cursor = 0
  const fetching = new Set<number>()
  const bumps: number[] = []
  let fetched = 0
  let fetchedBytes = 0
  let failed = 0
  let warnedFrame = false

  // decoding
  const decoding = new Map<number, number>() // frame → bytes reserved
  let decodeW = 0
  let decodeH = 0
  let budget = requestedBudget
  let capacity = 2
  let lo = 0 // the decode window, inclusive
  let hi = -1
  let created = 0
  let closedLate = 0
  let msLast = 0
  let msTotal = 0
  let msMax = 0

  // drawing and progress
  let progress = 0
  let target = 0
  let direction = 0
  let drawn = -1
  let painted = false
  let cssW = 0
  let cssH = 0
  let warm = false
  let awake = false

  /** Decoded at the current decode size (a resize past the tolerance makes every frame stale, still drawable). */
  const fresh = (i: number): boolean => {
    const b = cache.peek(i)
    return !!b && b.width === decodeW && b.height === decodeH
  }
  // Evict outside the window first, then stale frames inside it; never the frame on screen or a fresh window frame.
  const cache: BitmapCache<number, ImageBitmap> = new BitmapCache(budget, (i: number) =>
    i === drawn ? Infinity : i < lo || i > hi ? 0 : fresh(i) ? Infinity : 1,
  )

  let readySettled = false
  let settle: (error?: unknown) => void = () => {}
  const ready = new Promise<void>((resolve, reject) => {
    settle = (error) => {
      if (readySettled) return
      readySettled = true
      if (error === undefined) resolve()
      else reject(error)
    }
  })
  ready.catch(() => {}) // quiet when nobody awaits it; awaiting code still sees the rejection

  const rmq = window.matchMedia(REDUCED_MOTION_QUERY)
  const readReduced = () => reducedMotion === 'always' || (reducedMotion === 'user' && rmq.matches)
  let reduced = readReduced()

  function fail(error: unknown) {
    if (destroyed) return
    state = 'error'
    warn(error instanceof Error ? error.message : String(error))
    settle(error)
  }

  // ── geometry ──

  function resize(width: number, height: number) {
    if (destroyed) return
    cssW = width
    cssH = height
    fitCanvas()
    start()
    pump()
  }

  /**
   * The backing store for the CSS box, never finer than the frames, so it waits for their size (the manifest's, or a
   * frame list's first decode); until then the canvas keeps what it shows, like the last frame after an Activity
   * show. Assigning width or height clears the canvas, even to the same value: only on a change, redrawn at once.
   */
  function fitCanvas() {
    if (!cssW || !cssH || !srcW) return
    const size = backingSize(cssW, cssH, window.devicePixelRatio, dprCap, { width: srcW, height: srcH, fit })
    if (canvas.width !== size.width || canvas.height !== size.height) {
      canvas.width = size.width
      canvas.height = size.height
      ctx.imageSmoothingQuality = 'high'
      painted = false
    }
    layout()
    draw(!painted)
  }

  function layout() {
    if (!srcW || !canvas.width) return
    if (SUPPORT.resize === 'no') {
      decodeW = srcW
      decodeH = srcH
    } else {
      const want = decodeSize(srcW, srcH, canvas.width, canvas.height, fit)
      const moved = (a: number, b: number) => Math.abs(a / b - 1) > RESIZE_TOLERANCE
      if (!decodeW || moved(want.width, decodeW) || moved(want.height, decodeH)) {
        decodeW = want.width
        decodeH = want.height
      }
    }
    const frameBytes = bitmapBytes(decodeW, decodeH)
    budget = Math.max(requestedBudget, 2 * frameBytes)
    capacity = Math.floor(budget / frameBytes)
    cache.setBudget(budget)
  }

  // ── loading ──

  function start() {
    if (started || destroyed || !warm || !cssW) return
    started = true
    state = 'loading'
    if (create === inWorker) startWorker() // boots while the manifest and the first frame load
    const sources: (string | FrameManifest | readonly string[])[] = [options.manifest]
    const mobile = mobileSource(options)
    if (mobile) sources.push(mobile)
    Promise.allSettled(sources.map((s) => loadSource(s, abort.signal)))
      .then((results) => {
        const loaded = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
        if (!loaded.length) throw (results[0] as PromiseRejectedResult).reason
        const pick = loaded[pickVariant(loaded.map((v) => v.width), cssW, window.devicePixelRatio, dprCap)]
        if (loaded.length < results.length) warn(`a variant failed to load; using ${pick.name}`)
        apply(pick)
      })
      .catch(fail)
  }

  function apply(v: Variant) {
    if (destroyed) return
    variant = v.name
    urls = v.urls
    count = urls.length
    srcW = v.width
    srcH = v.height
    blobs = new Array(count)
    const still = Math.round(reducedMotionFrame < 0 ? count + reducedMotionFrame : reducedMotionFrame)
    staticFrame = Math.min(count - 1, Math.max(0, still))
    target = frameIndex(progress, count)
    order = reduced ? [staticFrame] : fetchOrder(count, prefix, target)
    cursor = 0
    fitCanvas()
    pump()
  }

  function nextFetch(): [number, RequestPriority] | null {
    while (bumps.length) {
      const i = bumps.shift()!
      if (blobs[i] === undefined && !fetching.has(i)) return [i, 'high']
    }
    if (!warm) return null
    for (; cursor < order.length; cursor++) {
      const i = order[cursor]
      if (blobs[i] !== undefined || fetching.has(i)) continue
      return [i, cursor === 0 ? 'high' : cursor <= prefix ? 'auto' : 'low']
    }
    return null
  }

  function fetchNext() {
    while (!destroyed && count && fetching.size < fetchConcurrency) {
      const next = nextFetch()
      if (!next) return
      fetchFrame(next[0], next[1])
    }
  }

  function fetchFrame(i: number, priority: RequestPriority) {
    fetching.add(i)
    fetch(urls[i], { signal: abort.signal, priority })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.blob()
      })
      .then(
        (blob) => {
          fetching.delete(i)
          if (destroyed) return
          blobs[i] = blob
          fetched++
          fetchedBytes += blob.size
          settleIfReady()
          pump()
        },
        (err) => {
          fetching.delete(i)
          if (destroyed) return
          frameFailed(i, err)
          pump()
        },
      )
  }

  function frameFailed(i: number, err: unknown) {
    blobs[i] = null
    failed++
    if (!warnedFrame) {
      warnedFrame = true
      warn(`frame ${i} (${urls[i]}) failed and is skipped: ${err instanceof Error ? err.message : String(err)}`)
    }
    settleIfReady()
  }

  function settleIfReady() {
    if (readySettled || !count) return
    const first = order.slice(0, reduced ? 1 : 1 + Math.min(prefix, count))
    if (drawn < 0) {
      if (first.every((i) => blobs[i] === null)) fail(new Error('the first frames failed to load'))
      return
    }
    if (!reduced) for (let i = 0; i < Math.min(prefix, count); i++) if (blobs[i] === undefined) return
    state = 'ready'
    settle()
  }

  // ── decoding ──

  function pump() {
    if (destroyed || !count) return
    if (awake && canvas.width) {
      if (!srcW) probeSize()
      else fillWindow()
    }
    fetchNext()
  }

  function fillWindow() {
    const list = reduced ? [staticFrame] : windowOrder(target, count, capacity, direction)
    lo = hi = list[0]
    for (const i of list) {
      if (i < lo) lo = i
      if (i > hi) hi = i
    }
    bumps.length = 0
    const frameBytes = bitmapBytes(decodeW, decodeH)
    for (let n = 0; n < list.length && decoding.size < decodeConcurrency; n++) {
      const i = list[n]
      if (decoding.has(i) || fresh(i)) continue
      const blob = blobs[i]
      if (blob === undefined) {
        if (n < BUMP_AHEAD && !fetching.has(i)) bumps.push(i)
        continue
      }
      if (blob === null) continue
      if (!cache.reserve(frameBytes)) break
      decode(i, blob, frameBytes, false)
    }
  }

  // A frame list has no size until a frame decodes: decode the nearest one at full size first.
  function probeSize() {
    if (decoding.size) return
    for (let d = 0; d < count; d++) {
      for (const i of [target - d, target + d]) {
        const blob = blobs[i]
        if (blob) return decode(i, blob, 0, true)
      }
    }
    bumps.length = 0
    if (blobs[target] === undefined && !fetching.has(target)) bumps.push(target)
  }

  function decode(i: number, blob: Blob, reservedBytes: number, probe: boolean) {
    decoding.set(i, reservedBytes)
    // Full size needs no resample: skip the resize options (and their cost) when that's the size wanted anyway.
    const plain = probe || SUPPORT.resize === 'no' || (decodeW === srcW && decodeH === srcH)
    const t0 = performance.now()
    decodeFrame(blob, plain ? 0 : decodeW, plain ? 0 : decodeH, resizeQuality, SUPPORT, create).then(
      (bitmap) => {
        decoding.delete(i)
        created++
        msLast = performance.now() - t0
        msTotal += msLast
        msMax = Math.max(msMax, msLast)
        // Destroyed, or gone far off-screen while it decoded: the memory was given back, so this goes too.
        if (destroyed || !warm) {
          cache.release(reservedBytes)
          bitmap.close()
          closedLate++
          return
        }
        // A plain bitmap's own size beats the manifest's, so a wrong manifest can't make every frame look stale.
        if (plain) {
          srcW = bitmap.width
          srcH = bitmap.height
        }
        fitCanvas() // a frame list's first size, a corrected one, or a resize-support verdict
        if (!cache.set(i, bitmap, bitmapBytes(bitmap.width, bitmap.height), reservedBytes)) {
          bitmap.close()
          closedLate++
        } else {
          // The best picture of the wanted frame now: the exact one if this was it, else the nearest decoded.
          draw(!painted || i === drawn)
        }
        settleIfReady()
        pump()
      },
      (err) => {
        decoding.delete(i)
        cache.release(reservedBytes)
        if (destroyed) return
        frameFailed(i, err)
        pump()
      },
    )
  }

  // ── drawing ──

  function nearestDecoded(want: number): number {
    let best = -1
    let bestD = Infinity
    for (const i of cache.keys()) {
      const d = Math.abs(i - want)
      // On a tie, the frame behind the direction of travel: the one the scrub just came through.
      if (d < bestD || (d === bestD && (i - want) * direction < 0)) {
        best = i
        bestD = d
      }
    }
    return best
  }

  /** Paints the wanted frame if it's decoded, else the nearest decoded one; never a frame that isn't. */
  function draw(force = false) {
    if (!awake || !count || !srcW || !canvas.width) return
    const want = reduced ? staticFrame : target
    const i = cache.has(want) ? want : nearestDecoded(want)
    if (i < 0 || (i === drawn && painted && !force)) return
    paint(i)
  }

  function paint(i: number) {
    const bitmap = cache.get(i)
    if (!bitmap) return
    const r = fitRect(srcW, srcH, canvas.width, canvas.height, fit, position)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height))
    painted = true
    if (i !== drawn) {
      drawn = i
      canvas.dataset.frame = String(i)
    }
  }

  // ── gating ──

  function setWarm(next: boolean) {
    if (warm === next || destroyed) return
    warm = next
    if (warm) {
      start()
      fetchNext()
    } else {
      // Far off-screen: give the decoded memory back. The canvas keeps its pixels and the blobs stay.
      cache.clear()
    }
  }

  function setAwake(next: boolean) {
    if (awake === next || destroyed) return
    awake = next
    if (awake) {
      draw(!painted)
      pump()
    }
  }

  function setReduced() {
    const next = readReduced()
    if (next === reduced || destroyed) return
    reduced = next
    if (!count) return
    if (reduced) cache.retain((i) => i === staticFrame || i === drawn)
    order = reduced ? [staticFrame] : fetchOrder(count, prefix, target)
    cursor = 0
    draw()
    pump()
  }

  const warmIo = new IntersectionObserver((e) => setWarm(e[e.length - 1].isIntersecting), {
    rootMargin: `${warmMargin * 100}% 0px`,
  })
  const wakeIo = new IntersectionObserver((e) => setAwake(e[e.length - 1].isIntersecting), {
    rootMargin: `${wakeMargin * 100}% 0px`,
  })
  const ro = new ResizeObserver((e) => resize(e[e.length - 1].contentRect.width, e[e.length - 1].contentRect.height))
  warmIo.observe(canvas)
  wakeIo.observe(canvas)
  ro.observe(canvas)

  // Safari's IntersectionObserver can go stale across a window resize: recompute both margins from the rect.
  const recheck = () => {
    const r = canvas.getBoundingClientRect()
    const vh = window.innerHeight
    const within = (m: number) => r.width > 0 && r.height > 0 && r.bottom > -m * vh && r.top < vh + m * vh
    setWarm(within(warmMargin))
    setAwake(within(wakeMargin))
  }
  window.addEventListener('resize', recheck)

  // A move to a screen with another pixel ratio changes the backing store, not the CSS box.
  let dprMq: MediaQueryList | null = null
  const onDpr = () => {
    watchDpr()
    resize(cssW, cssH)
  }
  function watchDpr() {
    dprMq?.removeEventListener('change', onDpr)
    dprMq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    dprMq.addEventListener('change', onDpr)
  }
  watchDpr()
  if (reducedMotion === 'user') rmq.addEventListener('change', setReduced)

  return {
    ready,

    setProgress(p: number) {
      if (destroyed || Number.isNaN(p)) return
      progress = Math.min(1, Math.max(0, p))
      if (!count) return
      const next = frameIndex(progress, count)
      if (next === target) return
      direction = next > target ? 1 : -1
      target = next
      if (reduced) return
      draw()
      pump()
    },

    stats(): FrameSequenceStats {
      return {
        state,
        variant,
        count,
        frame: drawn,
        target,
        reduced,
        warm,
        awake,
        canvas: { width: canvas.width, height: canvas.height },
        decodeSize: { width: decodeW, height: decodeH },
        resize: SUPPORT.resize,
        decoder: create === inWorker && !pool.failed ? 'worker' : 'main',
        fetched,
        fetchedBytes,
        failed,
        decoded: cache.size,
        decodedBytes: cache.bytes,
        peakDecodedBytes: cache.peak,
        reservedBytes: cache.reserved,
        budgetBytes: budget,
        capacity: Math.min(capacity, count || capacity),
        inflight: { fetch: fetching.size, decode: decoding.size },
        decodes: created,
        closed: cache.closed + closedLate,
        decodeMs: { last: msLast, avg: created ? msTotal / created : 0, max: msMax },
      }
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      state = 'destroyed'
      abort.abort()
      warmIo.disconnect()
      wakeIo.disconnect()
      ro.disconnect()
      window.removeEventListener('resize', recheck)
      dprMq?.removeEventListener('change', onDpr)
      rmq.removeEventListener('change', setReduced)
      cache.clear()
      blobs = []
      bumps.length = 0
      if (create === inWorker) releaseWorker()
      settle(new DOMException('the frame sequence was destroyed before it was ready', 'AbortError'))
    },
  }
}
