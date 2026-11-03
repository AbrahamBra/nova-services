import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Police unique de Nova Services (DESIGN.md).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Nova Services",
  description: "Gestion des demandes clients de Nova Services",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
