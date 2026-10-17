/**
 * pages/transitions.ts — every page's render-blocking script: the direction of each cross-document navigation
 * between / and /guide/ as a view-transition type (view-transitions.ts). It has to listen for `pagereveal` before the
 * first frame, so both pages load it with blocking="render" (plugins/render-blocking.ts keeps the attribute through
 * the build), and it imports nothing that isn't needed for that.
 */
import { mountCrossDocumentTransitions } from '../animation/view-transitions'

mountCrossDocumentTransitions()
