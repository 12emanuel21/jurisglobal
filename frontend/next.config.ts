import type { NextConfig } from 'next';

/** API interna (red Docker). En el navegador todo va por /api en el mismo origen (nginx). */
const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || 'http://api:4000';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Solo modo dev: orígenes permitidos además de localhost (túnel de pruebas)
  allowedDevOrigins: ['*.trycloudflare.com'],
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
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
