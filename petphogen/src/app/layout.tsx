import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Petpho Gen — Pixar Image Generator",
  description: "Admin tool for generating Pixar-style pet portraits",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-orange-50 text-gray-800 min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
