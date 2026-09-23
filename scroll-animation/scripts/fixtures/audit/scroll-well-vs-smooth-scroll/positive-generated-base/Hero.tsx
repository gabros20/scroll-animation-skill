// The canonical setup: the shipped, generated base.css sets
// scroll-behavior: smooth (see base.css in this fixture dir), and this file
// carries the scroll well via the data-pull-to-centre attribute contract
// instead of the <PullToCentre> component import. Neither file alone
// mentions both facts -- the rule only fires because buildContext() reads
// scroll-behavior from base.css (a generated file) while this per-file rule
// still runs against Hero.tsx.
export function Hero() {
  return (
    <section>
      <div data-pull-to-centre>Dough</div>
    </section>
  )
}
