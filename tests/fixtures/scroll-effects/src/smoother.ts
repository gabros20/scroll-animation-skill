// ScrollSmoother as the page's scroll authority. It stamps html[data-scroll-authority="smoother"], which switches
// scroll-effects.css's view() effects off: inside the smoothed content they would never progress (S2).
import { ScrollSmoother } from 'gsap/ScrollSmoother'
import { setupGsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import { createSmoother } from '../../../../skills/scroll-animation/assets/smooth/smoother'
import './probe'

setupGsap({ plugins: [ScrollSmoother] })
createSmoother(ScrollSmoother, { smooth: 1 })
