import gsap from 'gsap'
// a plain px site: fixed travel is correct here
gsap.to('.peel', { x: 600, scrollTrigger: { trigger: '.hero', end: '+=1800', scrub: true } })
