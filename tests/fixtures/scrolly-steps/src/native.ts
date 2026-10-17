// Native scrolling, no scroll authority: the engine-free core as a GSAP or plain page mounts it. `?rtl` first, so the
// pre-mount layout is already the mirrored one.
import { start } from './harness'

if (new URLSearchParams(location.search).has('rtl')) document.documentElement.dir = 'rtl'
start()
