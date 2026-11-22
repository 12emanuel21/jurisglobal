/**
 * Cliente HTTP único del frontend (en KovalCloud había ~30 copias de API_URL).
 * En el navegador todo va a /api en el mismo origen (nginx o el rewrite de Next) con la cookie
 * httpOnly de sesión; en SSR se usa la URL interna de Docker.
 */
export const API_BASE = typeof window !== 'undefined' ? '/api' : process.env.BACKEND_INTERNAL_URL || 'http://api:4000';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get code(): string | undefined {
    return typeof this.data.code === 'string' ? this.data.code : undefined;
  }
}

/** Mensaje legible de un error del backend (los de ValidationPipe vienen como lista) */
export async function apiErrorMessage(res: Response, fallback: string): Promise<{ message: string; data: Record<string, unknown> }> {
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const raw = data.message;
  const message = Array.isArray(raw) ? raw.join('. ') : typeof raw === 'string' ? raw : fallback;
  return { message, data };
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
}

/** JSON o ApiError con el mensaje del backend */
export async function apiJson<T>(path: string, init: RequestInit = {}, fallback = 'No se pudo completar la solicitud'): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    const { message, data } = await apiErrorMessage(res, fallback);
    throw new ApiError(message, res.status, data);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
