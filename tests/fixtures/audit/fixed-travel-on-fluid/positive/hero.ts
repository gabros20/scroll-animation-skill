import gsap from 'gsap'
// page styles: .hero { padding: calc(120 * var(--fluid)); }
gsap.to('.peel', { x: 600, scrollTrigger: { trigger: '.hero', end: '+=1800', scrub: true } })
