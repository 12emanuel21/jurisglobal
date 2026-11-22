import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SETTING_DEFAULTS, type SettingKey } from './defaults';

type SettingValue<K extends SettingKey> = (typeof SETTING_DEFAULTS)[K];

/**
 * Lectura de parámetros vivos (tabla Setting). Si una clave no existe en la BD se usa el valor por
 * defecto de defaults.ts, así la web y el bot nunca quedan sin configuración.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return (row?.value ?? SETTING_DEFAULTS[key]) as SettingValue<K>;
  }

  /** Guarda un valor ya validado (lo valida el módulo de administración) */
  async set(key: SettingKey, value: unknown, userId: string | null): Promise<void> {
    const json = value as Prisma.InputJsonValue;
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: json, updatedById: userId },
      update: { value: json, updatedById: userId },
    });
  }

  async getMany<K extends SettingKey>(keys: readonly K[]): Promise<{ [P in K]: SettingValue<P> }> {
    const rows = await this.prisma.setting.findMany({ where: { key: { in: [...keys] } } });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    return Object.fromEntries(keys.map((k) => [k, byKey.get(k) ?? SETTING_DEFAULTS[k]])) as {
      [P in K]: SettingValue<P>;
    };
  }
}
