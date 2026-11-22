import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';

// Fuentes locales: el build no depende de la red de Google Fonts
const geistSans = localFont({ src: './fonts/Geist-Variable.woff2', variable: '--font-geist-sans', weight: '100 900', display: 'swap' });
const geistMono = localFont({ src: './fonts/GeistMono-Variable.woff2', variable: '--font-geist-mono', weight: '100 900', display: 'swap' });
const playfair = localFont({ src: './fonts/playfair-display-latin-wght-normal.woff2', variable: '--font-playfair', weight: '400 900', display: 'swap' });

export const metadata: Metadata = {
  title: 'JurisGlobal | Soluciones Jurídicas y Financieras',
  description: 'Firma jurídica y financiera en Colombia. Tu tranquilidad, nuestra misión.',
};

export const viewport: Viewport = { themeColor: '#0f2a4a', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: next-themes pone la clase "dark" en <html> antes de hidratar (tema del panel)
    <html suppressHydrationWarning lang="es-CO" className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
