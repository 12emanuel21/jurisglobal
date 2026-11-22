import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { assertValidWindow, toMinutes, type SendWindowRule } from '../../compliance/send-window';
import { isUniqueViolation } from '../../prisma/prisma-errors';
import {
  DAY_NAMES,
  EDITABLE_SETTING_KEYS,
  LEY_2300_LIMITS,
  validateSettingsPatch,
  type EditableSettingKey,
} from './setting-rules';

/** Longitud máxima del nombre de un motivo: título de un botón de WhatsApp (20) */
export const MOTIVO_NAME_MAX = 20;

const normalizeName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * Configuración dinámica (solo ADMIN): parámetros, motivos, ventanas horarias (Ley 2300) y
 * festivos. Los cambios aplican al instante en la web (/public/config) y en el chatbot, que leen
 * la BD en cada solicitud. Todo queda en la bitácora.
 */
@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  // ─────────────────────────── Parámetros ───────────────────────────

  async getSettings(): Promise<Record<EditableSettingKey, unknown>> {
    return this.settings.getMany(EDITABLE_SETTING_KEYS);
  }

  async updateSettings(actor: AuthenticatedUser, patch: Record<string, unknown>) {
    const current = await this.getSettings();
    const result = validateSettingsPatch(patch, current);
    if (!result.ok) throw new BadRequestException(result.errors);
    const changed = Object.entries(result.values).filter(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(current[key as EditableSettingKey]),
    );
    for (const [key, value] of changed) await this.settings.set(key as EditableSettingKey, value, actor.id);
    if (changed.length) {
      await this.audit.record({
        userId: actor.id,
        action: 'SETTING_UPDATED',
        entity: 'Setting',
        data: { keys: changed.map(([key]) => key) },
      });
    }
    return this.getSettings();
  }

  // ─────────────────────────── Motivos ───────────────────────────

  async listMotivos() {
    const rows = await this.prisma.motivo.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { leads: true } } },
    });
    return rows.map((m) => ({
      id: m.id,
      name: m.name,
      isActive: m.isActive,
      sortOrder: m.sortOrder,
      leadCount: m._count.leads,
    }));
  }

  private async assertUniqueName(name: string, exceptId?: string) {
    const all = await this.prisma.motivo.findMany({ select: { id: true, name: true } });
    if (all.some((m) => m.id !== exceptId && normalizeName(m.name) === normalizeName(name))) {
      throw new ConflictException(`Ya existe un motivo llamado «${name}»`);
    }
  }

  async createMotivo(actor: AuthenticatedUser, name: string) {
    await this.assertUniqueName(name);
    const last = await this.prisma.motivo.aggregate({ _max: { sortOrder: true } });
    try {
      const motivo = await this.prisma.motivo.create({ data: { name, sortOrder: (last._max.sortOrder ?? -1) + 1 } });
      await this.audit.record({
        userId: actor.id,
        action: 'MOTIVO_CREATED',
        entity: 'Motivo',
        entityId: motivo.id,
        data: { name },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(`Ya existe un motivo llamado «${name}»`);
      throw error;
    }
    return this.listMotivos();
  }

  async updateMotivo(actor: AuthenticatedUser, id: string, dto: { name?: string; isActive?: boolean }) {
    const motivo = await this.prisma.motivo.findUnique({ where: { id } });
    if (!motivo) throw new NotFoundException('Motivo no encontrado');
    if (dto.name !== undefined && dto.name !== motivo.name) await this.assertUniqueName(dto.name, id);
    if (dto.isActive === false && motivo.isActive) {
      const active = await this.prisma.motivo.count({ where: { isActive: true } });
      if (active <= 1)
        throw new BadRequestException('Debe quedar al menos un motivo activo (la web y el bot lo exigen)');
    }
    await this.prisma.motivo.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.audit.record({
      userId: actor.id,
      action: 'MOTIVO_UPDATED',
      entity: 'Motivo',
      entityId: id,
      data: { ...dto },
    });
    return this.listMotivos();
  }

  /** Nuevo orden: todos los ids, sin repetir, en el orden deseado */
  async reorderMotivos(actor: AuthenticatedUser, ids: string[]) {
    const all = await this.prisma.motivo.findMany({ select: { id: true } });
    const known = new Set(all.map((m) => m.id));
    if (new Set(ids).size !== ids.length || ids.length !== known.size || ids.some((id) => !known.has(id))) {
      throw new BadRequestException('El nuevo orden debe incluir todos los motivos, una sola vez');
    }
    await this.prisma.$transaction(
      ids.map((id, sortOrder) => this.prisma.motivo.update({ where: { id }, data: { sortOrder } })),
    );
    await this.audit.record({ userId: actor.id, action: 'MOTIVOS_REORDERED', entity: 'Motivo' });
    return this.listMotivos();
  }

  // ─────────────────────────── Ventanas horarias ───────────────────────────

  async listWindows() {
    return this.prisma.sendWindow.findMany({
      orderBy: { dayOfWeek: 'asc' },
      select: { dayOfWeek: true, opensAt: true, closesAt: true, enabled: true },
    });
  }

  /** Reemplaza las franjas indicadas. Nunca por fuera de la Ley 2300 (domingo siempre cerrado) */
  async updateWindows(actor: AuthenticatedUser, windows: SendWindowRule[]) {
    const days = windows.map((w) => w.dayOfWeek);
    if (new Set(days).size !== days.length) throw new BadRequestException('Cada día debe aparecer una sola vez');
    const errors: string[] = [];
    for (const w of windows) {
      const day = DAY_NAMES[w.dayOfWeek] ?? `día ${w.dayOfWeek}`;
      try {
        assertValidWindow(w);
      } catch (error) {
        errors.push(`${capitalize(day)}: ${(error as Error).message}`);
        continue;
      }
      const limit = LEY_2300_LIMITS[w.dayOfWeek];
      if (!limit) {
        if (w.enabled) errors.push(`${capitalize(day)}: la Ley 2300 no permite envíos los domingos`);
      } else if (
        w.enabled &&
        (toMinutes(w.opensAt) < toMinutes(limit.opensAt) || toMinutes(w.closesAt) > toMinutes(limit.closesAt))
      ) {
        errors.push(`${capitalize(day)}: la Ley 2300 solo permite entre ${limit.opensAt} y ${limit.closesAt}`);
      }
    }
    if (errors.length) throw new BadRequestException(errors);
    await this.prisma.$transaction(
      windows.map((w) =>
        this.prisma.sendWindow.upsert({
          where: { dayOfWeek: w.dayOfWeek },
          create: w,
          update: { opensAt: w.opensAt, closesAt: w.closesAt, enabled: w.enabled },
        }),
      ),
    );
    await this.audit.record({
      userId: actor.id,
      action: 'SEND_WINDOWS_UPDATED',
      entity: 'SendWindow',
      data: { days },
    });
    return this.listWindows();
  }

  // ─────────────────────────── Festivos ───────────────────────────

  async listHolidays(year?: number) {
    const where = year
      ? { date: { gte: new Date(`${year}-01-01T00:00:00Z`), lte: new Date(`${year}-12-31T00:00:00Z`) } }
      : {};
    const rows = await this.prisma.holiday.findMany({ where, orderBy: { date: 'asc' } });
    return rows.map((h) => ({ ...h, date: h.date.toISOString().slice(0, 10) }));
  }

  async createHoliday(actor: AuthenticatedUser, date: string, name: string) {
    const day = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) {
      throw new BadRequestException('La fecha no es válida');
    }
    try {
      const holiday = await this.prisma.holiday.create({ data: { date: day, name, source: 'MANUAL' } });
      await this.audit.record({
        userId: actor.id,
        action: 'HOLIDAY_CREATED',
        entity: 'Holiday',
        entityId: holiday.id,
        data: { date },
      });
      return { ...holiday, date };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Esa fecha ya está en la lista de festivos');
      throw error;
    }
  }

  async setHolidayEnabled(actor: AuthenticatedUser, id: string, enabled: boolean) {
    const holiday = await this.prisma.holiday.findUnique({ where: { id } });
    if (!holiday) throw new NotFoundException('Festivo no encontrado');
    const updated = await this.prisma.holiday.update({ where: { id }, data: { enabled } });
    await this.audit.record({
      userId: actor.id,
      action: 'HOLIDAY_UPDATED',
      entity: 'Holiday',
      entityId: id,
      data: { enabled },
    });
    return { ...updated, date: updated.date.toISOString().slice(0, 10) };
  }

  /**
   * Quitar un festivo: los agregados a mano se borran; los del calendario oficial se desactivan
   * (si se borraran, el seed los volvería a crear).
   */
  async removeHoliday(actor: AuthenticatedUser, id: string) {
    const holiday = await this.prisma.holiday.findUnique({ where: { id } });
    if (!holiday) throw new NotFoundException('Festivo no encontrado');
    if (holiday.source === 'MANUAL') await this.prisma.holiday.delete({ where: { id } });
    else await this.prisma.holiday.update({ where: { id }, data: { enabled: false } });
    await this.audit.record({
      userId: actor.id,
      action: 'HOLIDAY_REMOVED',
      entity: 'Holiday',
      entityId: id,
      data: { date: holiday.date.toISOString().slice(0, 10), source: holiday.source },
    });
    return { removed: holiday.source === 'MANUAL' ? 'deleted' : 'disabled' };
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
