export function Stage() {
  return (
    <m.div whileInView={{ opacity: 1, amount: 0.5 }} viewport={{ once: true }}>
      content
    </m.div>
  )
}
