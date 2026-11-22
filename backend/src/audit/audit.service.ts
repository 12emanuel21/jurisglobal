import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  data?: Prisma.InputJsonValue;
  ip?: string | null;
}

/** Bitácora de acciones sensibles (exportar, cambiar estados, configuración, anonimizar). Nunca lanza. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: { ...entry, data: entry.data ?? undefined } });
    } catch (error) {
      this.logger.error(`No se pudo registrar la auditoría ${entry.action}: ${(error as Error).message}`);
    }
  }
}
