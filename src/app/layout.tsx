import type { Metadata, Viewport } from "next";
import { PwaProvider } from "@/components/PwaProvider";
import { ThemeProvider } from "@/components/ThemeProvider";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "bootstrap/dist/css/bootstrap.min.css";
import "./globals.css";
import "./modules.css";
import "./themes.css";

export const metadata: Metadata = {
  title: "TernaKu — Peternakan dalam genggaman",
  description:
    "Kelola produksi telur, penjualan, stok dan pakan ternak dalam satu aplikasi.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "TernaKu", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};
export const viewport: Viewport = {
  themeColor: "#196348",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t='light',f='normal';try{if(localStorage.getItem('ternaku.theme')==='dark')t='dark';var s=localStorage.getItem('ternaku.font-size');if(s==='small'||s==='large')f=s}catch(e){}document.documentElement.dataset.theme=t;document.documentElement.dataset.bsTheme=t;document.documentElement.style.colorScheme=t;document.documentElement.dataset.fontSize=f})();`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <PwaProvider>{children}</PwaProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
