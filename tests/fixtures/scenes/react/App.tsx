import { ScrubStage } from '../../../../skills/scroll-animation/assets/motion/components/ScrubStage'

// The same all-intra test clip and the same explicit config as the GSAP smoke
// page (tests/smoke-gsap/main.ts): 2 s at 30 fps, a five-frame head loop and a
// tail loop over the last five frames. The blocks above and below the scene are
// static stand-ins for the smoke page's stage, count-up, fade-on-exit and
// travel section, sized the same so the scene sits on the same geometry.
export function App() {
  return (
    <>
      <div style={{ padding: 40 }}>
        <p>Triggered entrance smoke test</p>
      </div>

      <div style={{ padding: 40, fontSize: 32 }}>
        Count: <span>42</span>
      </div>

      <div style={{ padding: 40 }}>
        <p>Fades out as it scrolls above the viewport.</p>
      </div>

      <ScrubStage src="/clip.mp4" fps={30} headLoop={{ fromFrame: 0, matchFrame: 5 }} tailLoop={{ fromFrame: 55 }}>
        <section style={{ height: '100vh' }} />
        <section style={{ height: '100vh' }} />
        <section style={{ height: '100vh' }} />
      </ScrubStage>

      <section style={{ position: 'relative', height: '200vh' }} />

      <div style={{ height: '50vh' }} />
    </>
  )
}
