// scroll authority: native | lenis
// this route: lenis (Immersive profile). The R3F canvas tracks the DOM and
// the route also uses Motion for UI, which rules out ScrollSmoother
// (GSAP-only fit). Wired in Phase 1b, placeholder until then.
export default function LabLayout({ children }: LayoutProps<"/lab">) {
  return <>{children}</>;
}
