import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import type { LeadStatus } from '@prisma/client';
import { LEAD_STATUSES, toLeadStatus } from '../lead-labels';

/** Cambio de estado y/o responsable. assignedToId: null = sin responsable */
export class UpdateLeadDto {
  @IsOptional()
  @Transform(({ value }) => toLeadStatus(value))
  @IsIn(LEAD_STATUSES, { message: 'El estado debe ser nuevo, contactado, agendado o cerrado' })
  status?: LeadStatus;

  @ValidateIf((_o, value) => value !== undefined && value !== null)
  @IsUUID('4', { message: 'El responsable no es válido' })
  assignedToId?: string | null;
}

export class CreateLeadNoteDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Escribe la nota' })
  @IsNotEmpty({ message: 'Escribe la nota' })
  @MaxLength(2000, { message: 'La nota no puede superar 2.000 caracteres' })
  body: string;
}
