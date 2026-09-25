import { LenisScroll } from "@/components/lenis-scroll";

// scroll authority: native | lenis
// this route: lenis (Immersive profile), on GSAP's ticker. The R3F canvas
// tracks the DOM and the route also uses Motion for UI, which rules out
// ScrollSmoother (GSAP-only fit).
export default function LabLayout({ children }: LayoutProps<"/lab">) {
  return <LenisScroll>{children}</LenisScroll>;
}
