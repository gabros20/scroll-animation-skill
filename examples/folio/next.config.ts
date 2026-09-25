import type { NextConfig } from "next";

// Nothing needed yet: media is same-origin under public/media, and the
// Three.js/R3F canvas (Phase 5) will be dynamically imported from inside
// the route that uses it rather than configured here.
const nextConfig: NextConfig = {};

export default nextConfig;
