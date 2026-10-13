import type { Metadata } from "next";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "bootstrap/dist/css/bootstrap.min.css";
import "./globals.css";
import "./modules.css";

export const metadata: Metadata = {
  title: "TernaKu — Peternakan dalam genggaman",
  description:
    "Kelola produksi telur, penjualan, stok dan pakan ternak dalam satu aplikasi.",
  icons: { icon: "/icon.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
