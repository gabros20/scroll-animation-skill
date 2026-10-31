"use client";

import { lazy, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { pinnedScene, type PinnedSceneHandle } from "@/animation/gsap/pinned-scene";
import { pinnedSceneRender, type PinnedSceneRender } from "@/animation/gsap/pinned-scene-render";
import { useReducedMotionLive } from "@/animation/motion/useReducedMotionLive";
import { createConductor, type Conductor, type ConductorState } from "@/three/conductor";
import { SceneCanvas } from "@/three/r3f/SceneCanvas";

// three, R3F and drei come with this chunk, and SceneCanvas asks for it only
// once its gate has decided the canvas should exist (WebGL, motion allowed).
const CameraStage = lazy(() => import("@/three/camera-stage"));

/** The five stops, in scroll order; src/three/camera-stage.tsx frames each one. */
const CHAPTERS = [{ id: "body" }, { id: "bellows" }, { id: "lens" }, { id: "tripod" }, { id: "whole" }] as const;

type LabDebug = {
  renders: number;
  draws: number;
  ticks: number;
  drawnAt: number | null;
  posterAt: number | null;
  mountedAt: number | null;
  lost: number;
  state: () => Readonly<ConductorState>;
  scene: () => PinnedSceneHandle | null;
  /** Draws once now and returns the share of the canvas that isn't paper (null without a canvas). */
  sample: () => number | null;
};

/** The share of a canvas's pixels that aren't Folio paper (#f4f0e9), read right after a draw. */
function inkShare(canvas: HTMLCanvasElement) {
  const probe = document.createElement("canvas");
  probe.width = 64;
  probe.height = 40;
  const ctx = probe.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0, probe.width, probe.height);
  const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - 244) + Math.abs(data[i + 1] - 240) + Math.abs(data[i + 2] - 233) > 30) ink++;
  }
  return ink / (data.length / 4);
}

function debugEnabled() {
  return "motionDebug" in document.documentElement.dataset || new URLSearchParams(location.search).has("motion-debug");
}

/**
 * /lab's pinned scene: the antique camera, scrolled through five chapters.
 *
 * GSAP's pinnedScene, because this route runs Lenis on GSAP's ticker (the
 * route's one authority, src/components/lenis-scroll.tsx) and a scene takes
 * its scroll from one engine. The scene's exact progress feeds the 3d skill's
 * conductor through render-bridge.ts (pinnedSceneRender), which draws the
 * canvas on the same ticker, after Lenis and ScrollTrigger, only when the
 * progress moved; the canvas runs no loop of its own (frameloop="never").
 * Lenis already smooths, so the conductor doesn't (`damping: null`).
 *
 * The acts are the chapter text, stacked in the pin: the scene latches the
 * active one and makes the rest `inert`. The poster is server HTML and the
 * LCP element; three loads after it has, and the canvas fades in over it once
 * it has drawn the model. Reduced motion, no WebGL, a lost context, no
 * JavaScript and print all keep the poster, with every chapter in flow.
 */
export function LabScene({ poster, children }: { poster: ReactNode; children: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  const [conductor] = useState<Conductor>(() => createConductor({ chapters: CHAPTERS, damping: null }));
  const reduced = useReducedMotionLive();
  const [warm, setWarm] = useState(false);
  const [posterReady, setPosterReady] = useState(false);
  const [drawn, setDrawn] = useState(false);

  // The scene's two callbacks go to whichever bridge is current.
  const bridge = useRef<PinnedSceneRender | null>(null);
  const scene = useRef<PinnedSceneHandle | null>(null);
  const draw = useRef<((ms: number) => void) | null>(null);
  const debug = useRef<LabDebug | null>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const handle = pinnedScene(el, {
      onProgress: (p, s) => bridge.current?.onProgress(p, s),
      onRehydrate: (state, s) => {
        // lab.css: the acts cross-fade from the frame after the scene first placed them.
        if (!("labLive" in el.dataset)) requestAnimationFrame(() => (el.dataset.labLive = ""));
        bridge.current?.onRehydrate(state, s);
      },
      onWarm: () => setWarm(true),
    });
    scene.current = handle;
    if (debugEnabled()) {
      debug.current = {
        renders: 0,
        draws: 0,
        ticks: 0,
        drawnAt: null,
        posterAt: null,
        mountedAt: null,
        lost: 0,
        state: () => conductor.state,
        scene: () => scene.current,
        sample: () => {
          const canvas = el.querySelector<HTMLCanvasElement>("[data-scene-canvas] canvas");
          if (!canvas || !draw.current) return null;
          // The drawing buffer is only readable in the task that drew it.
          draw.current(performance.now());
          return inkShare(canvas);
        },
      };
      (window as Window & { __lab?: LabDebug }).__lab = debug.current;
    }
    return () => {
      handle.destroy();
      scene.current = null;
      delete el.dataset.labLive;
    };
  }, [conductor]);

  // The bridge's ticker callback must run after the authority's (Lenis's
  // tick, then ScrollTrigger's update): created in a passive effect, after
  // the layout's SmoothScroll has started Lenis. A reduced-motion change
  // restarts Lenis (smooth/lenis.ts), which puts its tick behind this one,
  // so the bridge is made again with it, and asks the scene for its state.
  useEffect(() => {
    const render = pinnedSceneRender(conductor, {
      render: (ms) => {
        const stats = debug.current;
        if (stats) stats.renders++;
        if (!draw.current) return;
        draw.current(ms);
        if (stats) stats.draws++;
      },
    });
    bridge.current = render;
    scene.current?.rehydrate("render");
    return () => {
      render.destroy();
      if (bridge.current === render) bridge.current = null;
    };
  }, [conductor, reduced]);

  // Three waits for the poster: it is the LCP element, and its bytes come first.
  useEffect(() => {
    const img = root.current?.querySelector<HTMLImageElement>("img[data-scene-poster]");
    if (!img) return;
    const ready = () => {
      if (debug.current) debug.current.posterAt = performance.now();
      setPosterReady(true);
    };
    if (img.complete) {
      const id = requestAnimationFrame(ready);
      return () => cancelAnimationFrame(id);
    }
    img.addEventListener("load", ready, { once: true });
    return () => img.removeEventListener("load", ready);
  }, []);

  const attach = useCallback((next: ((ms: number) => void) | null) => {
    draw.current = next;
    // The canvas exists only now: render until the conductor has ticked.
    if (next) bridge.current?.requestRender();
  }, []);
  const onDrawn = useCallback((next: boolean) => {
    if (next && debug.current) debug.current.drawnAt = performance.now();
    setDrawn(next);
  }, []);
  const onTick = useCallback(() => {
    if (debug.current) debug.current.ticks++;
  }, []);
  const onContextLost = useCallback(() => {
    if (debug.current) debug.current.lost++;
  }, []);

  // Unmounted under reduced motion: no context, no work; the poster stands.
  const live = posterReady && warm && !reduced;
  useEffect(() => {
    if (live && debug.current && debug.current.mountedAt === null) debug.current.mountedAt = performance.now();
  }, [live]);

  return (
    <section ref={root} aria-label="The camera, chapter by chapter" data-scene-root="" className="lab-scene">
      <div data-scene-pin="">
        <div className="lab-frame">
          {poster}
          <div data-scene-canvas="" data-lab-drawn={drawn ? "" : undefined}>
            {live ? (
              <SceneCanvas
                frameloop="never"
                reducedMotion="poster"
                exposure={1.5}
                camera={{ fov: 22, near: 0.1, far: 200, position: [0, 4, 24] }}
                onContextLost={onContextLost}
              >
                <CameraStage conductor={conductor} attach={attach} onDrawn={onDrawn} onTick={onTick} />
              </SceneCanvas>
            ) : null}
          </div>
        </div>
        <ol className="lab-acts">{children}</ol>
      </div>
      <div data-scene-content="">
        {CHAPTERS.map((chapter) => (
          <div key={chapter.id} data-scene-spacer="" className="h-svh" />
        ))}
      </div>
    </section>
  );
}
