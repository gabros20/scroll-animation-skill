// The Motion page: page.ts's groups as Reveal/RevealItem under MotionProvider, server-rendered by motion-ssr.tsx and
// hydrated by motion-entry.tsx. The route sits in an <Activity> boundary so a check can hide and show it the way
// Next keeps a visited route alive.
import { Activity, Fragment, useEffect, useState } from 'react'

import { MotionProvider } from '../../../../skills/scroll-animation/assets/motion/MotionProvider'
import { Reveal, RevealItem, RevealVeil } from '../../../../skills/scroll-animation/assets/motion/Reveal'
import { GROUPS } from './page'

let showRoute: (visible: boolean) => void = () => {}
export const setRouteVisible = (visible: boolean) => showRoute(visible)

export function App() {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    showRoute = setVisible
  }, [])
  return (
    <MotionProvider>
      <Activity mode={visible ? 'visible' : 'hidden'}>
        <main id="page">
          {GROUPS.map((group, i) => (
            <Fragment key={group.id}>
              {i > 0 && <div className="spacer" />}
              <Reveal
                as={group.tag}
                id={group.id}
                className={`row${i === 0 ? ' first' : ''}`}
                trigger={group.trigger}
                replay={group.replay}
                margin={group.margin}
              >
                {group.items.map((item) => (
                  <RevealItem key={item.id} as={item.tag} id={item.id} effect={item.effect}>
                    {item.id}
                  </RevealItem>
                ))}
              </Reveal>
            </Fragment>
          ))}
          <div className="tail" />
        </main>
      </Activity>
      <RevealVeil className="veil" />
    </MotionProvider>
  )
}
