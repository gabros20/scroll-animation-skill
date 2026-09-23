/**
 * Header colour themes.
 *
 * A nav that floats over whatever section follows it, rather than painting
 * its own background, needs its ink chosen per page or per section: a light
 * hero wants dark ink, a near-black hero wants white. Model that as a
 * `HeaderTheme` variant rather than a one-off override, so a design system's
 * "inverted" nav state and this stay the same fact in two places.
 */
export type HeaderTheme = 'light' | 'dark'

/**
 * The crossfade every themed part of a nav should share.
 *
 * `useHeaderTheme` flips the theme the instant its probe crosses a section
 * boundary, so without a shared transition the whole bar hard-cuts from black
 * ink to white mid-scroll. Easing it turns that cut into a dissolve that
 * reads as the nav responding to the section arriving underneath it.
 *
 * It has to be on EVERY themed part at the SAME duration — logo, triggers,
 * links, hamburger and any scrolled surface — or the bar comes apart during
 * the flip, each piece arriving on its own clock.
 *
 * 200ms is a compromise with a second job these colours often do: `color`
 * also tends to carry a link's hover state, so a duration tuned purely for
 * the theme dissolve (300ms+) makes every hover feel like it is lagging the
 * pointer. 200 is short enough to stay crisp on hover and long enough to
 * read as a fade.
 */
export const THEME_FADE = 'transition-colors duration-200 ease-out'
