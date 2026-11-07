import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import { Inter } from 'next/font/google';
import type { Metadata } from 'next';
import { basePath, siteUrl } from '@/lib/shared';

const inter = Inter({
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Label Lab',
    template: '%s | Label Lab',
  },
  description:
    'How to use Label Lab: fill a master, check the preview, export the print PDF.',
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <a
          href="#nd-page"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-fd-primary focus:px-3 focus:py-2 focus:text-fd-primary-foreground"
        >
          Skip to content
        </a>
        <RootProvider search={{ options: { type: 'static', api: `${basePath}/api/search` } }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
