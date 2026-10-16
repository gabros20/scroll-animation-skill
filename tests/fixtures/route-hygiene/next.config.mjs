// The route-hygiene fixture's Next config. tests/route-hygiene.mjs copies this app to tests/.scratch, once per
// variant, and sets the variant through the environment for both `next build` and `next start`.
const root = process.env.RH_ROOT

/** @type {import('next').NextConfig} */
export default {
  // Activity keeps hidden routes in the document (display: none) instead of unmounting them.
  cacheComponents: process.env.RH_CACHE_COMPONENTS === '1',
  // The app's node_modules is a link into examples/folio's, so the build reads files across the repository.
  ...(root ? { turbopack: { root }, outputFileTracingRoot: root } : {}),
  // tests/tsconfig.* type the copied blocks; the fixture's pages are not the subject.
  typescript: { ignoreBuildErrors: true },
}
