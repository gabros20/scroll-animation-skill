/**
 * motion/layout-features.ts — Motion's domMax (domAnimation plus drag and layout), in a module of its own so that
 * LayoutMorph's `import('./layout-features')` puts it in a chunk fetched only when a morph mounts. Importing domMax
 * anywhere else statically pulls it back into the main bundle.
 */
import { domMax } from 'motion/react'

export default domMax
