import type { Metadata } from "next";
import "./globals.css";
import { ServiceWorker } from "@/components/service-worker";
import { AuthProvider } from "@/components/auth-provider";
import { getToken } from "@/lib/auth-server";

export const metadata: Metadata = {
  title: "Kotori Mail Bird",
  description: "A review-first Gmail assistant.",
  applicationName: "Kotori",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Kotori" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const testMode = process.env.PLAYWRIGHT_TEST_MODE === "1";
  const initialToken = testMode ? null : await getToken();
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <AuthProvider initialToken={initialToken} disabled={testMode}>
          {children}
        </AuthProvider>
        {!testMode && <ServiceWorker />}
      </body>
    </html>
  );
}
