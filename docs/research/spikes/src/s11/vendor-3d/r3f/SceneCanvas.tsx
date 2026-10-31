// Vendored by copy for spike S11 from ~/.claude/skills/3d/assets/web/r3f/SceneCanvas.tsx on 2026-10-30 (unchanged below this line).
'use client'
/**
 * r3f/SceneCanvas.tsx: the Canvas wrapper for a scroll scene in the Next App Router.
 *
 * Owns: capability + reduced-motion gate, poster slot (the LCP element), lazy load of three and
 * R3F (the poster path never downloads them), dpr clamp, colour/tone defaults, frameloop control,
 * off-screen and hidden-tab pause, context-loss fallback, and `ConductorDriver` (the one tick).
 * Must not: start the scroll authority or pin, hold scene content, or decide budgets (those live in
 * the project's 3D.md). Mount it from a Client Component; children must come from a chunk that is
 * itself lazy (or be tiny), or three loads anyway.
 *
 * Colour: `look="neutral"` (Khronos PBR Neutral, brand-accurate) or `"agx"` (cinematic), with R3F's
 * default ACES switched off through `flat`. Same intent as the Blender view transform.
 */
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type ReactNode,
} from 'react'
import type { CanvasProps } from '@react-three/fiber'
import type { Conductor } from '../conductor'

export interface SceneCanvasProps {
  children: ReactNode
  /** Rendered first and again on failure: the designed still of the scene's hero frame. */
  poster?: ReactNode
  /** 'demand' renders only on input or while smoothing (pair with ConductorDriver). Default 'demand'. */
  frameloop?: 'always' | 'demand'
  /** [min, max] device pixel ratio. Default [1, 1.5]; 2 only for a close-up hero that earns it. */
  dpr?: readonly [number, number]
  look?: 'neutral' | 'agx'
  exposure?: number
  /** 'poster' (default) never mounts the Canvas; 'live' mounts it and relies on the conductor's snap. */
  reducedMotion?: 'poster' | 'live'
  camera?: CanvasProps['camera']
  className?: string
  style?: CSSProperties
  /** Extra warm margin for the off-screen pause, CSS length. Default '200px'. */
  pauseMargin?: string
  onContextLost?: () => void
}

type Mode = 'pending' | 'live' | 'poster'

function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas')
    const gl = (probe.getContext('webgl2') ?? probe.getContext('webgl')) as WebGLRenderingContext | null
    if (!gl) return false
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}

interface LiveProps {
  children: ReactNode
  frameloop: 'always' | 'demand' | 'never'
  dpr: [number, number]
  look: 'neutral' | 'agx'
  exposure: number
  camera?: CanvasProps['camera'] | undefined
  onReady: () => void
  onLost: () => void
}

// three + R3F load here, once, only after the gate decided the Canvas should exist.
const Live = lazy(async () => {
  const [{ Canvas }, three] = await Promise.all([import('@react-three/fiber'), import('three')])
  function LiveCanvas(props: LiveProps): ReactNode {
    return (
      <Canvas
        flat
        frameloop={props.frameloop}
        dpr={props.dpr}
        {...(props.camera ? { camera: props.camera } : {})}
        style={{ position: 'absolute', inset: 0 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          // After R3F's own setup, so nothing overwrites it.
          gl.outputColorSpace = three.SRGBColorSpace
          gl.toneMapping = props.look === 'agx' ? three.AgXToneMapping : three.NeutralToneMapping
          gl.toneMappingExposure = props.exposure
          gl.domElement.addEventListener('webglcontextlost', (event) => {
            event.preventDefault()
            props.onLost()
          })
          // Two frames: the poster stays until the first real frame has been presented.
          requestAnimationFrame(() => requestAnimationFrame(props.onReady))
        }}
      >
        {props.children}
      </Canvas>
    )
  }
  return { default: LiveCanvas as ComponentType<LiveProps> }
})

export function SceneCanvas(props: SceneCanvasProps): ReactNode {
  const {
    children,
    poster,
    frameloop = 'demand',
    look = 'neutral',
    exposure = 1,
    reducedMotion = 'poster',
    pauseMargin = '200px',
  } = props
  const dprMin = props.dpr?.[0] ?? 1
  const dprMax = props.dpr?.[1] ?? 1.5
  // Stable array: R3F 9.8 re-applies the dpr prop on every Canvas re-render.
  const dpr = useMemo<[number, number]>(() => [dprMin, dprMax], [dprMin, dprMax])

  const root = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<Mode>('pending')
  const [ready, setReady] = useState(false)
  const [inView, setInView] = useState(true)
  const [pageVisible, setPageVisible] = useState(true)

  // Gate once on the client: WebGL present, reduced motion honoured.
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!webglAvailable() || (reduced && reducedMotion === 'poster')) setMode('poster')
    else setMode('live')
  }, [reducedMotion])

  // Pause the render loop off-screen and in a hidden tab (rAF stops there anyway; this also stops demand).
  useEffect(() => {
    const el = root.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => setInView(entries.some((entry) => entry.isIntersecting)), {
      rootMargin: `${pauseMargin} 0px`,
    })
    observer.observe(el)
    const onVisibility = (): void => setPageVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [pauseMargin])

  const running = inView && pageVisible
  const showPoster = mode !== 'live' || !ready

  return (
    <div
      ref={root}
      className={props.className}
      style={{ position: 'relative', width: '100%', height: '100%', ...props.style }}
      data-scene-ready={mode === 'live' && ready ? 'true' : 'false'}
      data-scene-mode={mode}
    >
      {mode === 'live' && (
        <Suspense fallback={null}>
          <Live
            frameloop={running ? frameloop : 'never'}
            dpr={dpr}
            look={look}
            exposure={exposure}
            camera={props.camera}
            onReady={() => setReady(true)}
            onLost={() => {
              setReady(false)
              setMode('poster')
              props.onContextLost?.()
            }}
          >
            {children}
          </Live>
        </Suspense>
      )}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          opacity: showPoster ? 1 : 0,
          transition: 'opacity 400ms ease-out',
        }}
      >
        {poster}
      </div>
    </div>
  )
}

export interface ConductorDriverProps {
  conductor: Conductor
  /** Runs inside the R3F frame, right after the tick: write camera, world state, uniforms here. */
  onFrame: (state: Readonly<Conductor['state']>) => void
}

/**
 * The one tick. Render it inside <SceneCanvas>. It ticks the conductor from useFrame, calls
 * onFrame with the fresh state, wakes an on-demand loop when input arrives, and keeps frames
 * coming until smooth has settled. Loaded lazily so this file stays free of three at import time.
 */
export const ConductorDriver = lazy(async () => {
  const { useFrame, useThree } = await import('@react-three/fiber')
  function Driver({ conductor, onFrame }: ConductorDriverProps): null {
    const invalidate = useThree((s) => s.invalidate)
    const frameloop = useThree((s) => s.frameloop)

    useEffect(() => conductor.onInput(() => invalidate()), [conductor, invalidate])
    // setFrameloop does not request a frame: wake after resuming from 'never'.
    useEffect(() => {
      if (frameloop !== 'never') invalidate()
    }, [frameloop, invalidate])

    useFrame((_state, delta) => {
      const state = conductor.tick(delta)
      onFrame(state)
      if (!state.settled) invalidate()
    })
    return null
  }
  return { default: Driver as ComponentType<ConductorDriverProps> }
})
