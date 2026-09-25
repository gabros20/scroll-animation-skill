// scroll authority: native | lenis
// this route: native (Reading profile). Covers both /journal and
// /journal/[slug]; wired in Phase 1b, placeholder until then.
export default function JournalLayout({ children }: LayoutProps<"/journal">) {
  return <>{children}</>;
}
