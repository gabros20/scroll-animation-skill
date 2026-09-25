import { LenisScroll } from "@/components/lenis-scroll";

// scroll authority: native | lenis
// this route: lenis (Expressive profile), on GSAP's ticker.
export default function ExpressiveLayout({ children }: LayoutProps<"/">) {
  return <LenisScroll>{children}</LenisScroll>;
}
