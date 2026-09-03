import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { AppShell } from "@/components/AppShell";
export const metadata: Metadata = {
  title: "E-SOLUTIONS Tendering",
  description: "Electrical Tendering · CPQ · Panel Engineering",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <a href="#main-content" className="sr-only focus:not-sr-only">
          Skip to content
        </a>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
