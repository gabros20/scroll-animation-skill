import type { Metadata } from "next";
import { Archivo, Fraunces } from "next/font/google";
import { GATE_SCRIPT } from "@/animation/config";
import { MotionProvider } from "@/animation/motion/MotionProvider";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";
import "@/animation/css/animation.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
});

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
});

export const metadata: Metadata = {
  title: {
    default: "Folio",
    template: "%s · Folio",
  },
  description:
    "Folio is an independent journal about designed objects, the places that made them, and the materials underneath both. A fictional brand built to demonstrate the scroll-animation skill.",
};

// The scroll authority is per route, so it lives in the route-group layouts,
// not here. <html> carries attributes React doesn't render (GATE_SCRIPT's
// data-animation, the engines' data-animation-ready, SmoothScroll's
// data-scroll-authority, Lenis's classes), hence suppressHydrationWarning.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${archivo.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* The pre-JS gate (animation.css): entrance hidden states apply only
            once this has run, so a reader without JavaScript sees everything. */}
        <script dangerouslySetInnerHTML={{ __html: GATE_SCRIPT }} />
      </head>
      <body className="flex min-h-screen flex-col font-sans antialiased">
        <MotionProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </MotionProvider>
      </body>
    </html>
  );
}
