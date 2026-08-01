import type { Metadata } from "next";
import "./globals.css";
import { ServiceWorker } from "@/components/service-worker";

export const metadata: Metadata = {
  title: "Kotori Mail Bird",
  description: "A review-first Gmail assistant.",
  applicationName: "Kotori",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Kotori" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
