import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kotori Mail Bird",
  description: "A review-first Gmail assistant.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
