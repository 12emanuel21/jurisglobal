import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && !value.trim() ? undefined : typeof value === 'string' ? value.trim() : value;

// ───────────── Contactos ─────────────

export const CONTACT_STATUS_FILTERS = ['verified', 'unverified', 'opted_out'] as const;
export type ContactStatusFilter = (typeof CONTACT_STATUS_FILTERS)[number];

export class ContactQueryDto {
  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(100) q?: string;
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn(CONTACT_STATUS_FILTERS, { message: 'Estado no válido' })
  status?: ContactStatusFilter;
  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(150) source?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}

export class CreateContactDto {
  @Transform(trim) @IsString() @MinLength(7, { message: 'Escribe el celular' }) @MaxLength(30) phone!: string;
  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(150) name?: string;
  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(254) email?: string;
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Indica el origen del contacto' })
  @MaxLength(150)
  source!: string;
  @IsIn(['DOCUMENTED', 'UNVERIFIED'], { message: 'Indica si hay soporte documental de la autorización' })
  consent!: 'DOCUMENTED' | 'UNVERIFIED';
  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(500) consentNote?: string;
}

export class OptOutContactDto {
  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(300) note?: string;
}

export class ImportContactsDto {
  /** Descripción del soporte documental de la base (dónde está, quién lo firmó) */
  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(500) consentNote?: string;
}

// ───────────── Plantillas ─────────────

export class TemplateButtonDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(25, { message: 'Cada botón admite máximo 25 caracteres' })
  text!: string;
  @IsIn(['OPT_OUT', 'OPT_IN_ACCEPT', 'OTHER'], { message: 'Rol de botón no válido' }) role!:
    'OPT_OUT' | 'OPT_IN_ACCEPT' | 'OTHER';
}

export class TemplateDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(512) name!: string;
  @Transform(trim) @IsString() @MaxLength(10) language!: string;
  @IsIn(['MARKETING', 'UTILITY'], { message: 'La categoría debe ser MARKETING o UTILITY' }) category!:
    'MARKETING' | 'UTILITY';
  @IsIn(['MARKETING', 'OPT_IN'], { message: 'El tipo debe ser marketing o confirmación de autorización' })
  purpose!: 'MARKETING' | 'OPT_IN';
  @IsOptional() @IsIn(['APPROVED', 'PENDING', 'PAUSED', 'REJECTED', 'DISABLED']) status?: string;
  @Transform(trim)
  @IsString()
  @MinLength(10, { message: 'Escribe el cuerpo de la plantilla' })
  @MaxLength(1024)
  bodyText!: string;
  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(60) footerText?: string;
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TemplateButtonDto)
  buttons: TemplateButtonDto[] = [];
}

// ───────────── Campañas ─────────────

export class AudienceDto {
  @IsIn(['all', 'source', 'selection'], { message: 'Audiencia no válida' }) type!: 'all' | 'source' | 'selection';
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) sources?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(5000) @IsUUID('4', { each: true }) contactIds?: string[];
}

export class CampaignPreviewDto {
  @IsUUID() templateId!: string;
  @ValidateNested() @Type(() => AudienceDto) audience!: AudienceDto;
  @IsOptional() @IsObject() variableMapping?: Record<string, unknown>;
}

export class CreateCampaignDto extends CampaignPreviewDto {
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Ponle un nombre a la campaña' })
  @MaxLength(120)
  name!: string;
  /** null/ausente = inmediata (igual respeta ventanas, festivos y topes) */
  @IsOptional() @IsDateString({}, { message: 'Fecha de programación no válida' }) scheduledAt?: string;
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

export class RecipientsQueryDto {
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn(['PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED'])
  status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}

// ───────────── Envío de prueba / unitario ─────────────

export class TestSendDto {
  @IsUUID() templateId!: string;
  @Transform(trim) @IsString() @MinLength(7, { message: 'Escribe el celular' }) @MaxLength(30) phone!: string;
  /** Valores de {{1}}, {{2}}… en orden */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  variables?: string[];
  /** Solo pruebas: omitir el horario Ley 2300 (queda en la bitácora) */
  @IsOptional() @IsBoolean() skipWindow?: boolean;
}
