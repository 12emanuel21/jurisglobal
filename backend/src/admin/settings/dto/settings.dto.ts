import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const clean = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value;

/** Cambio parcial de parámetros: { values: { showConsultationPrice: true, consultationPrice: 100000 } } */
export class UpdateSettingsDto {
  @IsObject({ message: 'values debe ser un objeto' })
  values: Record<string, unknown>;
}

export class CreateMotivoDto {
  @Transform(clean)
  @IsString({ message: 'Escribe el nombre del motivo' })
  @IsNotEmpty({ message: 'Escribe el nombre del motivo' })
  @MaxLength(20, { message: 'El nombre del motivo admite máximo 20 caracteres (límite de los botones de WhatsApp)' })
  @Matches(/^[\p{L}\d][\p{L}\d .,'()/-]*$/u, { message: 'El nombre solo puede tener letras, números y signos simples' })
  name: string;
}

export class UpdateMotivoDto {
  @IsOptional()
  @Transform(clean)
  @IsString()
  @IsNotEmpty({ message: 'Escribe el nombre del motivo' })
  @MaxLength(20, { message: 'El nombre del motivo admite máximo 20 caracteres (límite de los botones de WhatsApp)' })
  @Matches(/^[\p{L}\d][\p{L}\d .,'()/-]*$/u, { message: 'El nombre solo puede tener letras, números y signos simples' })
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ReorderMotivosDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  ids: string[];
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class SendWindowDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @Matches(TIME, { message: 'Usa horas en formato HH:MM (24 h)' })
  opensAt: string;

  @Matches(TIME, { message: 'Usa horas en formato HH:MM (24 h)' })
  closesAt: string;

  @IsBoolean()
  enabled: boolean;
}

export class UpdateSendWindowsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => SendWindowDto)
  windows: SendWindowDto[];
}

export class CreateHolidayDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha debe tener el formato AAAA-MM-DD' })
  date: string;

  @Transform(clean)
  @IsString()
  @IsNotEmpty({ message: 'Escribe el nombre del festivo' })
  @MaxLength(80)
  name: string;
}

export class UpdateHolidayDto {
  @IsBoolean()
  enabled: boolean;
}

export class HolidayQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}
