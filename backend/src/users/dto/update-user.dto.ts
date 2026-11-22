import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Role } from '@prisma/client';

/** Nombre y/o rol de un usuario (lo cambia un ADMIN) */
export class UpdateUserDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEnum(Role, { message: 'El rol debe ser ADMIN o ASESOR' })
  role?: Role;
}
