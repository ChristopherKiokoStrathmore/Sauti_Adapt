import type { Metadata, Viewport } from 'next';
import './style.css';
import { HeadwayProvider } from '@/components/HeadwayProvider';
export const metadata: Metadata = {
  title: 'Sauti Adapt | Personalized Voice Accessibility',
  description: 'Co-designed accessibility control for Kenyan English and Kiswahili',
  manifest: '/manifest.webmanifest'
};
export const viewport: Viewport = { themeColor: '#4829a8', width: 'device-width', initialScale: 1 };
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>) {
  return <html lang="en"><body><HeadwayProvider>{children}</HeadwayProvider></body></html>;
}
