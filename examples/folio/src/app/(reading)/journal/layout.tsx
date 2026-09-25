import { SmoothScroll } from "@/animation/smooth/SmoothScroll";

// scroll authority: native | lenis
// this route: native (Reading profile). Covers both /journal and
// /journal/[slug].
export default function JournalLayout({ children }: LayoutProps<"/journal">) {
  return <SmoothScroll authority="native">{children}</SmoothScroll>;
}
