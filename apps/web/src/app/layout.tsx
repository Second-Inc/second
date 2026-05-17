import type { Metadata } from "next";
import "./globals.css";
import { Caveat, IBM_Plex_Sans } from "next/font/google";
import { cn } from "@/lib/utils";
import { InputModalityTracker } from "@/components/input-modality-tracker";
import { LoaderPreferencesProvider } from "@/components/loader-preferences-provider";
import { LocalReleaseUpdateCallout } from "@/components/local-release-update-callout";
import { ThemeAwareFavicon } from "@/components/theme-aware-favicon";
import { Toaster } from "@/components/ui/sonner";
import { readSentryDsn } from "@/lib/sentry-public-config";

// Toggle font: true = IBM Plex Sans, false = Inter (CSS fallback)
const USE_IBM_PLEX = false;

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["300", "400", "500", "600", "700"],
});

const caveat = Caveat({
  subsets: ["latin"],
  variable: "--font-hand",
  weight: ["600"],
});

export const metadata: Metadata = {
  title: "Second",
  description: "Second is a generative workspace for internal tools.",
  icons: {
    icon: [
      {
        url: "/favicon-light.svg?v=2",
        type: "image/svg+xml",
      },
      {
        url: "/favicon-dark.svg?v=2",
        media: "(prefers-color-scheme: dark)",
        type: "image/svg+xml",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const errorReportingEnabled = Boolean(readSentryDsn());

  return (
    <html lang="en" className={cn("font-sans", USE_IBM_PLEX && ibmPlexSans.variable, caveat.variable)}>
      <head>
        <meta
          name="second-error-reporting"
          content={errorReportingEnabled ? "enabled" : "disabled"}
        />
      </head>
      <body>
        <LoaderPreferencesProvider>
          <ThemeAwareFavicon />
          {/* Mount once so focus ring behavior is controlled globally by input modality. */}
          <InputModalityTracker />
          {children}
          <LocalReleaseUpdateCallout />
          <Toaster />
        </LoaderPreferencesProvider>
      </body>
    </html>
  );
}
