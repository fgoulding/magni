import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import { AppHeight } from "@/components/AppHeight";
import { BottomNav } from "@/components/BottomNav";
import { InstallHelp } from "@/components/InstallHelp";
import { getUser } from "@/lib/auth";
import "./globals.css";

const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "Magni",
    template: "%s | Magni",
  },
  description: "Magni — a self-hosted strength training planner and tracker.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Magni",
    // "default" lets iOS reserve the status bar so content starts below it.
    // (black-translucent draws content under the status bar and depends on
    // env(safe-area-inset-top), which iOS reports as 0 until the first reflow.)
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#faf9f7",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getUser();

  return (
    <html
      lang="en"
      className={`${barlow.variable} ${barlowCondensed.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <AppHeight />
        <main className="safe-top mx-auto flex min-h-[var(--app-height)] w-full max-w-xl flex-col pb-[calc(5.5rem+var(--safe-bottom))]">
          <InstallHelp />
          {children}
        </main>
        {user ? <BottomNav /> : null}
      </body>
    </html>
  );
}
