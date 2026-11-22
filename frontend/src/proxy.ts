import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next 16 (proxy reemplaza a middleware): sin cookie de sesión, /panel redirige al login antes de
 * renderizar. Es solo UX: la autorización real la valida el backend en cada petición (JWT + rol).
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.get('jg_session')?.value) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/panel/:path*'],
};
