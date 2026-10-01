// ScrollSmoother, where sticky never sticks: the rail's scene pins through ScrollTrigger (`pin: 'gsap'`). The smoother
// comes first, so the rail's triggers bind to its wrapper.
import { ScrollSmoother } from 'gsap/ScrollSmoother'
import { setupGsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import { createSmoother } from '../../../../skills/scroll-animation/assets/smooth/smoother'
import { mount } from './rail'

setupGsap({ plugins: [ScrollSmoother] })
createSmoother(ScrollSmoother, { smooth: 1 })
mount({ pin: 'gsap' })
