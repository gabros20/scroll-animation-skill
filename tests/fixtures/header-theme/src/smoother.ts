// ScrollSmoother: the content moves by transform while window.scrollY runs ahead of it. The header stays outside the
// wrapper, where position: fixed still works.
import { ScrollSmoother } from 'gsap/ScrollSmoother'
import { setupGsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import { createSmoother } from '../../../../skills/scroll-animation/assets/smooth/smoother'
import { start } from './harness'

setupGsap({ plugins: [ScrollSmoother] })
createSmoother(ScrollSmoother, { smooth: 1 })
start()
