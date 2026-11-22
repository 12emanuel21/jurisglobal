'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, apiFetch, apiJson } from '@/lib/api';
import { PANEL_HOME, type UserRole } from '@/lib/roles';
import { clearSudoToken } from '@/lib/sudo-token';

/** Error del login con el código del backend (TWO_FACTOR_REQUIRED / TWO_FACTOR_INVALID) */
export class LoginError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'LoginError';
  }
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isTwoFactorEnabled: boolean;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, totpCode?: string, next?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Sesión con cookie httpOnly (adaptado del AuthContext de KovalCloud, que guardaba el JWT en
 * localStorage): el navegador envía la cookie sola; el estado se obtiene de GET /auth/profile.
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    try {
      setUser(await apiJson<User>('/auth/profile'));
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Sesión al montar: la cookie httpOnly viaja sola; setState solo en los callbacks
  useEffect(() => {
    let cancelled = false;
    apiJson<User>('/auth/profile')
      .then((profile) => !cancelled && setUser(profile))
      .catch(() => !cancelled && setUser(null))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (email: string, password: string, totpCode?: string, next?: string) => {
    try {
      const data = await apiJson<{ user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password, ...(totpCode ? { totpCode: totpCode.replace(/\s/g, '') } : {}) }),
      }, 'Credenciales incorrectas');
      clearSudoToken();
      setUser(data.user);
      router.push(next && next.startsWith('/panel') ? next : PANEL_HOME);
    } catch (error) {
      if (error instanceof ApiError) throw new LoginError(error.message, error.code);
      throw error;
    }
  };

  const logout = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
    clearSudoToken();
    setUser(null);
    router.push('/login');
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: Boolean(user), isLoading, login, logout, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de un AuthProvider');
  return context;
};
