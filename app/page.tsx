import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plant Leave Management",
  description: "Annual leave management for factory employees",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
