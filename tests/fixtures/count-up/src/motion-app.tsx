// The Motion page: stats.ts's numbers as <CountUp> under MotionProvider, server-rendered by motion-ssr.tsx and hydrated
// by motion-entry.tsx. The route sits in an <Activity> boundary so a check can hide and show it the way Next keeps a
// visited route alive.
import { Activity, Fragment, useEffect, useState } from 'react'

import { CountUp } from '../../../../skills/scroll-animation/assets/motion/CountUp'
import { MotionProvider } from '../../../../skills/scroll-animation/assets/motion/MotionProvider'
import { STATS } from './stats'

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
          <h1 data-reveal-item="">Numbers</h1>
          {STATS.map((s, i) => (
            <Fragment key={s.id}>
              {i > 0 && <div className="spacer" />}
              <p className="stat" id={s.id} lang={s.lang}>
                {s.prefix}
                <CountUp id={`n-${s.id}`} to={s.to} from={s.from} format={s.format} />
                {s.suffix}
              </p>
            </Fragment>
          ))}
          <div className="tail" />
        </main>
      </Activity>
    </MotionProvider>
  )
}
