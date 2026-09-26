// PinnedScene hands FrameSequence its band through the `pinned` render function, the composition both docblocks
// show: no onProgress/onRehydrate bridge. The runner changes the holds (the band moves while scroll doesn't) and
// fires a rehydrate trigger; the sequence must follow either way.
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import '../../../../skills/scroll-animation/assets/css/animation.css'
import '../../../../skills/scroll-animation/assets/css/scene.css'
import type { FrameSequence as Handle } from '../../../../skills/scroll-animation/assets/media/frame-sequence'
import { FrameSequence } from '../../../../skills/scroll-animation/assets/motion/FrameSequence'
import { MotionProvider } from '../../../../skills/scroll-animation/assets/motion/MotionProvider'
import { PinnedScene, type PinnedSceneHandle } from '../../../../skills/scroll-animation/assets/motion/PinnedScene'
import { usePinnedScene } from '../../../../skills/scroll-animation/assets/motion/usePinnedScene'
import type { SceneHolds } from '../../../../skills/scroll-animation/assets/scene'
import { expose } from './fixture'

const sequenceRef: { current: Handle | null } = { current: null }
const sceneRef: { current: PinnedSceneHandle | null } = { current: null }
let setHolds: (holds: Partial<SceneHolds>) => void = () => {}

/** Hand markup on the hook alone: the scene itself must keep data-scene-state on this root. */
function HookScene() {
  const { rootRef, pinRef } = usePinnedScene()
  return (
    <div ref={rootRef} id="hook-range" data-scene-root="">
      <div ref={pinRef} data-scene-pin="" />
      <div data-scene-content="">
        <section style={{ height: '100vh' }}>Hook head</section>
        <section style={{ height: '100vh' }}>Hook band</section>
        <section style={{ height: '100vh' }}>Hook tail</section>
      </div>
    </div>
  )
}

function App() {
  const [holds, set] = useState<Partial<SceneHolds>>({})
  setHolds = set
  return (
    <>
      <div id="lead" />
      <PinnedScene
        id="range"
        ref={sceneRef}
        {...holds}
        pinned={({ band }) => (
          <FrameSequence
            id="seq"
            manifest="seq/manifest.json"
            progress={band}
            label="Test pattern"
            sequenceRef={sequenceRef}
          />
        )}
      >
        <section style={{ height: '100vh' }}>Head</section>
        <section style={{ height: '100vh' }}>Band</section>
        <section style={{ height: '100vh' }}>Tail</section>
      </PinnedScene>
      <div id="tail" />
      <HookScene />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <MotionProvider>
    <App />
  </MotionProvider>,
)

expose({
  handle: () => sequenceRef.current,
  // What the sequence follows: the scene's band, not raw scroll progress.
  progress: () => sceneRef.current?.band() ?? 0,
  scene: () => {
    const s = sceneRef.current
    return s && { p: s.progress(), band: s.band(), mode: s.mode(), reduced: s.reduced() }
  },
  setHolds: (holds: Partial<SceneHolds>) => flushSync(() => setHolds(holds)),
})
