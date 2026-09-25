'use client'
/**
 * motion/FrameSequence.tsx — an image sequence scrubbed on a <canvas> by a progress MotionValue (or a number).
 * The decoding, memory budget, gating and reduced motion all live in media/frame-sequence.ts; read its header.
 *
 *   const range = useRef<HTMLDivElement>(null)
 *   const { scrollYProgress } = useScroll({ target: range, offset: ['start start', 'end end'] })
 *
 *   <div ref={range} style={{ height: '400lvh' }}>
 *     <div style={{ position: 'sticky', top: 0, height: '100lvh' }}>
 *       <FrameSequence
 *         manifest="/media/hero/manifest.json"
 *         mobile
 *         progress={scrollYProgress}
 *         label="A camera, turning"
 *       />
 *     </div>
 *   </div>
 *
 * - `progress` is read by hand (useMotionValueEvent) and never bound to a style: it only picks a frame, and a bound
 *   scroll-linked style can be handed to a native timeline that disagrees with the value (spike S3). Pass EXACT
 *   progress: a spring on top only makes the scrub late, and the canvas already holds the nearest decoded frame while
 *   the exact one decodes.
 * - The canvas is `role="img"` with `label` as its accessible name, and fills its box (`display: block`, 100% × 100%):
 *   size the box, not the canvas. Its backing store follows that box.
 * - The sequence is built in a layout effect and destroyed in its cleanup: on unmount, and when Next's Activity hides
 *   the route (effects clean up on hide, re-run on show; the canvas keeps its last frame meanwhile). It rebuilds when
 *   an option changes; `manifest` and `mobile` compare by content, so an inline object doesn't rebuild every render.
 * - `sequenceRef` receives the handle while mounted (stats(), ready).
 */
import { isMotionValue, useMotionValue, useMotionValueEvent, type MotionValue } from 'motion/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CanvasHTMLAttributes,
  type Ref,
  type RefObject,
} from 'react'

import {
  createFrameSequence,
  type FrameSequence as FrameSequenceHandle,
  type FrameSequenceOptions,
} from '../media/frame-sequence'

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

// `prefix` is also an RDFa attribute on every element; here it's the sequence's.
type CanvasProps = Omit<CanvasHTMLAttributes<HTMLCanvasElement>, 'children' | 'role' | 'width' | 'height' | 'prefix'>

export interface FrameSequenceProps extends FrameSequenceOptions, CanvasProps {
  /** 0–1: a MotionValue (a scene's or useScroll's progress) or a plain number. */
  progress: MotionValue<number> | number
  /** The accessible name of the canvas (role="img"): what the sequence shows. */
  label: string
  ref?: Ref<HTMLCanvasElement>
  sequenceRef?: RefObject<FrameSequenceHandle | null>
}

const keyOf = (source: unknown) =>
  typeof source === 'object' && source !== null ? JSON.stringify(source) : String(source)

export function FrameSequence({
  manifest,
  mobile,
  progress,
  label,
  ref,
  sequenceRef,
  fit,
  position,
  dprCap,
  prefix,
  budgetBytes,
  reducedMotion,
  reducedMotionFrame,
  warmMargin,
  wakeMargin,
  fetchConcurrency,
  decodeConcurrency,
  resizeQuality,
  worker,
  style,
  ...canvasProps
}: FrameSequenceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const handleRef = useRef<FrameSequenceHandle | null>(null)

  // A number becomes a MotionValue, so one subscription serves both kinds of `progress`.
  const own = useMotionValue(typeof progress === 'number' ? progress : 0)
  const source = isMotionValue(progress) ? progress : own
  useIsomorphicLayoutEffect(() => {
    if (typeof progress === 'number') own.set(progress)
  }, [progress, own])
  useMotionValueEvent(source, 'change', (v) => handleRef.current?.setProgress(v))

  const manifestKey = useMemo(() => keyOf(manifest), [manifest])
  const mobileKey = useMemo(() => keyOf(mobile), [mobile])
  const positionKey = position?.join(',')

  useIsomorphicLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handle = createFrameSequence(canvas, {
      manifest,
      mobile,
      fit,
      position,
      dprCap,
      prefix,
      budgetBytes,
      reducedMotion,
      reducedMotionFrame,
      warmMargin,
      wakeMargin,
      fetchConcurrency,
      decodeConcurrency,
      resizeQuality,
      worker,
    })
    handle.setProgress(source.get())
    handleRef.current = handle
    if (sequenceRef) sequenceRef.current = handle
    return () => {
      handle.destroy()
      handleRef.current = null
      if (sequenceRef?.current === handle) sequenceRef.current = null
    }
    // Keyed on content: an inline manifest object or position tuple must not rebuild the sequence every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    manifestKey,
    mobileKey,
    fit,
    positionKey,
    dprCap,
    prefix,
    budgetBytes,
    reducedMotion,
    reducedMotionFrame,
    warmMargin,
    wakeMargin,
    fetchConcurrency,
    decodeConcurrency,
    resizeQuality,
    worker,
  ])

  // `progress` switched to another MotionValue (or between a value and a number): hand over its current value.
  useIsomorphicLayoutEffect(() => {
    handleRef.current?.setProgress(source.get())
  }, [source])

  const setCanvas = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) (ref as RefObject<HTMLCanvasElement | null>).current = node
    },
    [ref],
  )

  return (
    <canvas
      {...canvasProps}
      ref={setCanvas}
      role="img"
      aria-label={label}
      style={{ display: 'block', width: '100%', height: '100%', ...style }}
    />
  )
}
