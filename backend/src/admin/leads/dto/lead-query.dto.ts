import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Channel, LeadStatus } from '@prisma/client';
import { LEAD_ORIGINS, LEAD_STATUSES, toChannel, toLeadStatus } from '../lead-labels';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Filtros del listado y de la exportación (mismos para ambos) */
export class LeadFiltersDto {
  /** Nombre, correo o teléfono (con 3 dígitos o más se busca también en el teléfono) */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  /** NEW | CONTACTED | SCHEDULED | CLOSED o nuevo | contactado | agendado | cerrado */
  @IsOptional()
  @Transform(({ value }) => toLeadStatus(value))
  @IsIn(LEAD_STATUSES, { message: 'El estado debe ser nuevo, contactado, agendado o cerrado' })
  status?: LeadStatus;

  @IsOptional()
  @IsUUID('4', { message: 'El motivo no es válido' })
  motivoId?: string;

  /** web | whatsapp (también IMPORT y PANEL) */
  @IsOptional()
  @Transform(({ value }) => toChannel(value))
  @IsIn(LEAD_ORIGINS, { message: 'El origen debe ser web o whatsapp' })
  origin?: Channel;

  /** Desde (YYYY-MM-DD, hora de Colombia, inclusive) */
  @IsOptional()
  @Matches(DATE, { message: 'La fecha inicial debe tener el formato AAAA-MM-DD' })
  from?: string;

  /** Hasta (YYYY-MM-DD, hora de Colombia, inclusive) */
  @IsOptional()
  @Matches(DATE, { message: 'La fecha final debe tener el formato AAAA-MM-DD' })
  to?: string;
}

export class LeadQueryDto extends LeadFiltersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 25;
}
