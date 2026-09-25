export type MediaRef = {
  /** Path relative to public/media/. */
  src: string;
  alt: string;
  width: number;
  height: number;
};

export type JournalArticle = {
  slug: string;
  category: "Objects" | "Places";
  title: string;
  dek: string;
  /** ISO date. */
  publishedOn: string;
  readMinutes: number;
  cover: MediaRef;
  /** Paragraphs of body copy, rendered one per <p>. */
  body: string[];
  /** The one CSS-parallax figure the Reading page plan asks for. */
  parallaxFigure: MediaRef & { caption: string };
  /** The one loop video with pause control the Reading page plan asks for. */
  loop: MediaRef & { poster: string; caption: string };
};

// Two fictional stories. "Folio" is a placeholder editorial brand built to
// demonstrate this skill — see docs/designs/folio-art-direction.md — and
// these pieces, their subjects and their sources are invented for it.
export const journalArticles: JournalArticle[] = [
  {
    slug: "the-kiln-that-never-went-cold",
    category: "Objects",
    title: "The Kiln That Never Went Cold",
    dek: "Inside a two-room ceramics studio where one wood kiln has been firing for eleven years straight.",
    publishedOn: "2026-03-02",
    readMinutes: 6,
    cover: {
      src: "journal/kiln-cover.avif",
      alt: "A lidded stoneware jar with an uneven ash glaze, photographed on a wire cooling shelf.",
      width: 1600,
      height: 2000,
    },
    body: [
      "The kiln sits in a converted garage at the end of a gravel road, a brick chamber the size of a small car with a firebox at one end and a chimney bolted on with plumber's tape. It has been fired every five to six weeks for eleven years, which means it has never fully cooled: the bricks hold enough heat between firings that the studio smells faintly of woodsmoke even in the weeks nobody is working.",
      "A firing takes fourteen hours and burns close to a cord of scrap pine, most of it offcuts from a cabinet shop two towns over. There is no thermostat. The potter reads the kiln through a spyhole and a set of pyrometric cones, small clay wedges that bend at known temperatures, and adjusts the draft by hand. Ash from the firebox drifts over the pots on the back shelves and melts into the glaze surface as the kiln climbs past 1,300 degrees Celsius, which is the entire point: nobody can specify where the ash lands, so nobody can specify the finished color.",
      "The vessel photographed here came out of the back-left corner of the kiln, the coldest spot in the chamber, on a Tuesday firing in February. It is a stoneware jar, thrown in one pull on the wheel, thirty centimeters tall, with a lid that was thrown separately and ground to fit after both pieces shrank in the firing. Ash built up unevenly along one shoulder and ran in a thin green line toward the base. The potter did not plan that line. She says she has stopped trying to plan them.",
      "Eleven years of firings means several thousand pots have passed through this kiln, and the studio keeps almost none of them; most sell within a week of the firing that made them, still warm from the second cooling. What stays are the notes: cone numbers, wood weights, draft settings, one line per firing in a spiral notebook now on its fourth volume. It is the only specification that has ever mattered here, and it still will not tell you what color anything comes out.",
    ],
    parallaxFigure: {
      src: "journal/kiln-detail.avif",
      alt: "Close detail of ash glaze pooling near the base of a stoneware jar.",
      width: 1200,
      height: 1500,
      caption:
        "Ash from the firebox lands unevenly on every pot in the kiln. No two glazes finish the same.",
    },
    loop: {
      src: "journal/kiln-loop.mp4",
      poster: "journal/kiln-loop-poster.avif",
      alt: "The open kiln at the end of a firing, heat shimmering over the bricks.",
      width: 1280,
      height: 720,
      caption: "The kiln door, opened at the end of a fourteen-hour firing.",
    },
  },
  {
    slug: "what-rust-is-for",
    category: "Places",
    title: "What Rust Is For",
    dek: "A weathering-steel library wall was left outside to rust on purpose. Ten years on, the rust is the point.",
    publishedOn: "2026-04-18",
    readMinutes: 7,
    cover: {
      src: "journal/rust-cover.avif",
      alt: "A library reading room lit by clerestory windows above a rusted steel wall.",
      width: 1600,
      height: 2000,
    },
    body: [
      "The east wall of the reading room is forty steel plates bolted to a steel frame, and it has been rusting on purpose since the day it went up. The architect specified ASTM A588 weathering steel, formulated to rust into a stable skin instead of flaking the way ordinary steel does. Ten years after installation, that skin is a dark, even orange-brown, and it has not needed paint, sealant or a single maintenance visit.",
      "Weathering steel works because of what is in it: small amounts of copper, chromium and nickel, mixed into the alloy so the rust that forms bonds tightly to the plate instead of lifting off in flakes. The first two years are the ugly part. Rainwater carries loose iron oxide down the face of the building and stains anything porous underneath it, which is why the architect ran a gravel drip line the width of the wall and warned the client in writing not to plant anything beneath it for at least three years. By year three the runoff had mostly stopped. The stain is still there, a faint orange tide line in the gravel, left alone because covering it would have meant admitting the wall got away from the drawings.",
      "Inside, none of this shows. The reading room is lit from clerestory windows above the steel, and the wall reads as a warm, matte plane that changes slightly with the weather: darker and almost black when it rains, lighter and closer to terracotta on a dry afternoon. Staff say the building's regulars have opinions about which weather suits it best. Nobody has repainted a library wall in a decade, which by most maintenance budgets counts as the finish working.",
      "Weathering steel is not a trick, and it is not low-maintenance in the way a brochure means it: it needs a detail that keeps water moving away from anything it can stain, a client willing to let a building look unfinished for two or three years, and an answer ready for the first person who asks if the wall is supposed to look like that. Here, the answer is yes. The wall was supposed to do exactly what steel does when nobody stops it.",
    ],
    parallaxFigure: {
      src: "journal/rust-detail.avif",
      alt: "Close detail of weathering steel showing its even orange-brown patina.",
      width: 1200,
      height: 1500,
      caption:
        "The same alloy, ten years apart: bright mill finish at the corner post, full patina everywhere else.",
    },
    loop: {
      src: "journal/rust-loop.mp4",
      poster: "journal/rust-loop-poster.avif",
      alt: "Rain running down the face of a weathering-steel wall.",
      width: 1280,
      height: 720,
      caption: "Rain moving down the steel face during a spring storm.",
    },
  },
];

export function getJournalArticle(slug: string): JournalArticle | undefined {
  return journalArticles.find((article) => article.slug === slug);
}
