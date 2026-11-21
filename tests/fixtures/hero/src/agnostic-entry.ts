// agnostic.html's entry: the engine-free mountReveals() on the route root with the entrance signal.
import { mountReveals } from '../../../../skills/scroll-animation/assets/reveal'
import { boot } from './boot'

boot(() => mountReveals(document.getElementById('page')!, { entrance: true }))
