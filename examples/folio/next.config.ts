import type { NextConfig } from "next";

// Nothing needed: media is same-origin under public/media, and /lab's
// three.js/R3F canvas is a lazy chunk of its own (src/three/camera-stage.tsx),
// imported from inside the route rather than configured here.
const nextConfig: NextConfig = {};

export default nextConfig;
