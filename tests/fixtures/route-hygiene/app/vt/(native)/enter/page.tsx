import { SplitWords } from '@/animation/motion/SplitWords'
import { Enter } from '@/components/enter'

// F3: a page whose first screen enters four ways, reached through a React <ViewTransition>.
export default function Page() {
  return <Enter heading={<SplitWords text="Every word waits for the page" />} />
}
