import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Espacios internos colapsados: "  Ana   María " -> "Ana María" */
const cleanName = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value;

export class UtmDto {
  @IsOptional() @IsString() @MaxLength(100) source?: string;
  @IsOptional() @IsString() @MaxLength(100) medium?: string;
  @IsOptional() @IsString() @MaxLength(100) campaign?: string;
}

/**
 * Formulario unificado (ESP §5). Lo envía la web; el chatbot usa el mismo servicio internamente.
 * El teléfono se normaliza en el servicio (estricto: solo Colombia).
 */
export class SubmitLeadDto {
  @Transform(cleanName)
  @IsString({ message: 'El nombre es obligatorio' })
  @MinLength(3, { message: 'Escribe tu nombre completo' })
  @MaxLength(120, { message: 'El nombre no puede superar 120 caracteres' })
  @Matches(/^[\p{L}][\p{L} .'-]*$/u, {
    message: 'El nombre solo puede tener letras, espacios, puntos, guiones o apóstrofos',
  })
  fullName: string;

  @Transform(trim)
  @IsString({ message: 'El teléfono es obligatorio' })
  @IsNotEmpty({ message: 'El teléfono es obligatorio' })
  @MaxLength(30)
  phone: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'El correo electrónico no es válido' })
  @MaxLength(254)
  email: string;

  /** id del motivo (de GET /public/config) o su nombre */
  @Transform(trim)
  @IsString({ message: 'El motivo es obligatorio' })
  @IsNotEmpty({ message: 'El motivo es obligatorio' })
  @MaxLength(100)
  motivo: string;

  @IsIn(['web', 'whatsapp'], { message: 'origin debe ser "web" o "whatsapp"' })
  origin: 'web' | 'whatsapp';

  /** Autorización 1: Aviso de Privacidad, Términos y Condiciones, Política de Cookies */
  @Equals(true, {
    message: 'Debes aceptar el Aviso de Privacidad, los Términos y Condiciones y la Política de Cookies',
  })
  privacyAndTerms: boolean;

  /** Autorización 2: contacto por canal institucional + tratamiento de datos personales */
  @Equals(true, { message: 'Debes autorizar el contacto y el tratamiento de tus datos personales' })
  contactAndDataProcessing: boolean;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UtmDto)
  utm?: UtmDto;

  /** Honeypot anti-spam: campo oculto en el formulario; una persona nunca lo llena */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
