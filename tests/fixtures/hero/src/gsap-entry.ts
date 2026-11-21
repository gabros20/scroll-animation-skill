// gsap.html's entry: reveal() on the route root with the entrance signal. setupGsap() inside it marks the engine ready.
import { reveal } from '../../../../skills/scroll-animation/assets/gsap/reveal'
import { boot } from './boot'

boot(() => reveal(document.getElementById('page')!, { entrance: true }))
