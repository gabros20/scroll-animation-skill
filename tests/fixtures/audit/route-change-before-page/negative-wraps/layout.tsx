import { RouteScroll } from './route-scroll'

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <body>
      <RouteScroll>
        <main>{children}</main>
      </RouteScroll>
    </body>
  )
}
