import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { THEME_COOKIE } from "@/lib/labels";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Biblio B1", template: "%s — Biblio B1" },
  description: "Cours, exercices et entraide de la promo B1",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf8" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0f11" },
  ],
};

// Sans cookie : on suit la préférence système, appliquée avant le premier rendu.
const NO_COOKIE_SCRIPT = `try{if(!document.cookie.match(/(?:^|; )${THEME_COOKIE}=/)&&matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')}catch(e){}`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = (await cookies()).get(THEME_COOKIE)?.value;
  return (
    <html
      lang="fr"
      className={`${inter.variable} ${jetbrains.variable} ${theme === "dark" ? "dark" : ""}`}
      suppressHydrationWarning
    >
      <head>
        {theme === undefined && <script dangerouslySetInnerHTML={{ __html: NO_COOKIE_SCRIPT }} />}
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
