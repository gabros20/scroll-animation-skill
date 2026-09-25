import { SmoothScroll } from "@/animation/smooth/SmoothScroll";

// scroll authority: native | lenis
// this route: native. A fixture host and catalogue, not a profile page;
// nothing on it needs smoothing.
export default function BlocksLayout({ children }: LayoutProps<"/blocks">) {
  return <SmoothScroll authority="native">{children}</SmoothScroll>;
}
