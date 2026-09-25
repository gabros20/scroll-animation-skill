export type FolioObject = {
  name: string;
  note: string;
  /** Path relative to public/media/. */
  image: string;
  alt: string;
};

// Six short entries for the horizontal rail on `/`. Not linked to anything
// yet — the rail is a visual idea, not a nav feature. See "Media shot list"
// in docs/designs/folio-art-direction.md for the six stills these draw on.
export const folioObjects: FolioObject[] = [
  {
    name: "Stoneware vessel",
    note: "Wood-fired, ash glaze, cooled over three days.",
    image: "objects/stoneware-vessel.avif",
    alt: "A tall stoneware vessel with an ash glaze.",
  },
  {
    name: "Weathering-steel panel",
    note: "Weathering steel, ten years outside, still changing colour.",
    image: "objects/corten-panel.avif",
    alt: "A rusted weathering-steel panel.",
  },
  {
    name: "Bent plywood chair",
    note: "One sheet, one mould, no screws.",
    image: "objects/plywood-chair.avif",
    alt: "A chair formed from a single sheet of bent plywood.",
  },
  {
    name: "Hand-forged hinge",
    note: "Drawn from a single bar of mild steel.",
    image: "objects/forged-hinge.avif",
    alt: "A hand-forged steel door hinge.",
  },
  {
    name: "Cast concrete stair",
    note: "Poured in place, formwork left visible on purpose.",
    image: "objects/concrete-stair.avif",
    alt: "A poured-concrete stair with visible formwork lines.",
  },
  {
    name: "Blown glass shade",
    note: "Cooled slowly enough that it never cracks.",
    image: "objects/glass-shade.avif",
    alt: "A hand-blown glass lamp shade.",
  },
];
