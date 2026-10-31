import { LenisScroll } from "@/components/lenis-scroll";

// scroll authority: native | lenis
// this route: lenis (Immersive profile), on GSAP's ticker. The scene is
// GSAP's pinnedScene, and render-bridge draws the R3F canvas on the same
// ticker, after Lenis (src/components/lab-scene.tsx). Not ScrollSmoother: a
// transformed wrapper would take the sticky pin with it.
export default function LabLayout({ children }: LayoutProps<"/lab">) {
  return <LenisScroll>{children}</LenisScroll>;
}
