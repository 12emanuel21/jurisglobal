import type { NextConfig } from 'next';

/** API interna (red Docker). En el navegador todo va por /api en el mismo origen (nginx). */
const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || 'http://api:4000';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Sin mapas de código fuente en el navegador en producción (no se expone el código del panel)
  productionBrowserSourceMaps: false,
  // Solo modo dev: Next bloquea sus recursos (/_next/*, HMR) para otros orígenes. Se entra por nginx
  // en 127.0.0.1:8088 y, para probar el webhook, por un túnel temporal de Cloudflare.
  allowedDevOrigins: ['127.0.0.1', 'localhost', '*.trycloudflare.com'],
  async rewrites() {
    // Permite usar /api también al entrar directo al puerto de Next (sin nginx)
    return [{ source: '/api/:path*', destination: `${BACKEND_URL}/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
