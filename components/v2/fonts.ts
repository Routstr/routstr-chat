import {
  Archivo,
  Azeret_Mono,
  Faustina,
  IBM_Plex_Mono,
  Instrument_Sans,
  Instrument_Serif,
  JetBrains_Mono,
  Newsreader,
  Source_Serif_4,
} from "next/font/google";

/* Self-hosted at build time, so reading never asks a font CDN for anything.
   Each room names its three faces in rooms.css; a face that no room on screen
   uses is never downloaded. */

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--nf-instrument-sans",
  display: "swap",
});
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--nf-instrument-serif",
  display: "swap",
});
const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--nf-newsreader",
  display: "swap",
});
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--nf-source-serif",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--nf-plex-mono",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--nf-jetbrains",
  display: "swap",
});
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--nf-archivo",
  display: "swap",
});
const faustina = Faustina({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--nf-faustina",
  display: "swap",
});
const azeret = Azeret_Mono({
  subsets: ["latin"],
  variable: "--nf-azeret",
  display: "swap",
});

export const roomFontVariables = [
  instrumentSans,
  instrumentSerif,
  newsreader,
  sourceSerif,
  plexMono,
  jetbrains,
  archivo,
  faustina,
  azeret,
]
  .map((f) => f.variable)
  .join(" ");
