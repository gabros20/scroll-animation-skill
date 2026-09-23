export function Stage() {
  return (
    <m.div whileInView={{ opacity: 1 }} viewport={{ once: true, amount: 'some' }}>
      content
    </m.div>
  )
}
