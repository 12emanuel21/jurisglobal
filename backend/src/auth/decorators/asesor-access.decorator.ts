import { SetMetadata } from '@nestjs/common';

export const ASESOR_ACCESS_KEY = 'asesorAccess';

/**
 * Habilita la ruta para el rol ASESOR. Sin este decorador, JwtAuthGuard la deniega al ASESOR
 * (deny-by-default, patrón @KitchenAccess de KovalCloud): toda ruta nueva queda solo para ADMIN.
 */
export const AsesorAccess = () => SetMetadata(ASESOR_ACCESS_KEY, true);
