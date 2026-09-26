/**
 * A worked example of `ScrubVideo`: a pinned, scrubbed scene with copy riding
 * over it in three acts.
 *
 * ## The geometry rule this exists to demonstrate
 *
 * With a pin, scroll progress advances `1/(N-1)` per viewport of content,
 * where N is the scene's total height in viewports. Three acts each one
 * viewport tall give N=3 — the landmarks fall on HALVES (0%, 50%, 100%) and
 * there is no middle third at all. Wanting thirds (a head act, a scrub act, a
 * tail act, evenly spaced) means N=4: one act has to be two viewports tall.
 *
 * That is exactly the shape below: two ONE-viewport copy acts and one
 * TWO-viewport spacer act between them, for a total of 4 — which lands
 * progress at 0%, 25%, 75% and 100% at each act boundary, close enough to the
 * design intent (the render is genuinely doing its scrubbing work across the
 * whole middle two-thirds, not just a symmetrical middle third). Adjust the
 * spacer's height to move where the boundaries fall; the rule to keep is "the
 * acts you want evenly spaced need one more viewport of total height than
 * you have acts".
 *
 * ## Why the copy acts render nothing of their own background
 *
 * The whole point of a scrubbed scene is that the render IS the background.
 * `FadeOnExit` clears each act's copy before the next act's composition needs
 * the frame — tune `--exit-from`/`--exit-to` per act rather than fighting the
 * defaults, which were tuned for the reference build's own act heights.
 *
 * Swap `src`/`mobileSrc`/`poster` for real assets. Pass `headLoop`/`tailLoop`
 * once you have measured your clip's seams (without them the head and tail
 * hold the first and last frames), and a `camera` once you have measured your
 * own subject placement — both omitted here, so this renders as a plain
 * `object-cover` scrub with no loops and no pan/zoom.
 */
import { ScrubVideo } from '../ScrubVideo'
import { FadeOnExit } from '../components/FadeOnExit'

export function ScrollStack() {
  return (
    <ScrubVideo src="/scene.mp4" mobileSrc="/scene-mobile.mp4" poster="/scene-poster.jpg">
      {/* Act 1 — one viewport. The scene holds its head through this act
          (the first frame here, a loop with `headLoop`) until the scrub
          engages, 12 px of scroll in (`headHoldPx`, scene.ts) — so this is a
          near-static render for the reader to arrive on. */}
      <section className="flex h-svh items-center px-6">
        <FadeOnExit className="max-w-lg [--exit-from:0.1] [--exit-to:0.5]">
          <h1 className="text-4xl font-semibold">Act one</h1>
          <p className="mt-4 text-lg">
            The render rests here at the head of the scene. This copy fades before
            the scrub genuinely gets moving, so it never has to compete with a
            transforming render underneath it.
          </p>
        </FadeOnExit>
      </section>

      {/* Act 2 — TWO viewports, and deliberately empty. It exists only to
          give the scrub band two viewports of scroll to spend while the
          render transforms underneath — see the geometry rule above.
          `data-scene-spacer` marks it as exactly that: an empty pacing act,
          not content. Under reduced motion there is no camera move left to
          give this space to, so `assets/css/scene.css` collapses it to zero
          height instead of leaving an 1800px blank band for a reduced-motion
          reader to scroll through for nothing (references/scenes.md
          §10, references/attribute-contract.md). */}
      <section aria-hidden="true" data-scene-spacer className="h-[200svh]" />

      {/* Act 3 — one viewport. The tail's composition (the last frame here,
          a loop with `tailLoop`) is the one a reader actually stops on, so if
          you bring a `camera` config, its `tail` shot is worth tuning by eye
          against this exact act. */}
      <section className="flex h-svh items-center justify-end px-6 text-right">
        <FadeOnExit className="max-w-lg [--exit-from:0.65] [--exit-to:0.9]">
          <h2 className="text-3xl font-semibold">Act three</h2>
          <p className="mt-4 text-lg">
            By the time this is readable the render has landed on its resting
            composition. The later range here (0.65 → 0.9) means this copy
            arrives already legible instead of fading in on top of a frame
            that is still settling.
          </p>
        </FadeOnExit>
      </section>
    </ScrubVideo>
  )
}
