// App-wide Motion runtime — LazyMotion + MotionConfig + BreakpointProvider.
// Mount once, near the root.
export { MotionProvider } from './MotionProvider'
// Triggered: a stage fires once and then plays on its own clock. `trigger="mount"`
// for a section on screen at load (a hero, paired with StageVeil),
// `trigger="view"` for everything below the fold.
//
// This is the default entrance system for a whole site. The one exception is a
// pinned scrubbed scene, which owns its own driver — see `ScrubStage`.
export { Stage, StageItem, StageVeil } from './Stage'
// A number that counts up on first sight. Not a StageItem: variants animate style,
// this animates text.
export { CountUp } from './CountUp'
// The one scroll-driven primitive: a pinned background video scrubbed across the
// sections stacked on it. Requires an ALL-INTRA asset — see the docblock.
export {
  ScrubStage,
  type ScrubLoopConfig,
  type CameraShot,
  type CameraTierShots,
  type CropRect,
  type SubjectPoint,
  type SubjectTierPoints,
  type FrameSize,
  type CameraConfig,
  type BackdropStop
} from './ScrubStage'
// Fades a group out as it scrolls away, so copy over a pinned render does not
// compete with it. One manual opacity write per scroll frame — not a timeline.
export { FadeOnExit } from './FadeOnExit'
// Attracts the scroll toward centring its parent while that parent is on screen.
// A client leaf, so the section around it stays a server component. Additive and
// releasable — it never blocks or holds scroll; see lib/scrollPull.ts.
export { PullToCentre } from './PullToCentre'
// A background render that starts on view and pauses off-screen; optional
// intro-then-seamless-loop policy for a build-once render.
export { InViewLoopVideo } from './InViewLoopVideo'
