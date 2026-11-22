import { IsString, MaxLength, MinLength } from 'class-validator';

/** Nueva contraseña de otro usuario (la fija un ADMIN) */
export class UpdateUserPasswordDto {
  @IsString()
  @MinLength(10, { message: 'La contraseña debe tener al menos 10 caracteres' })
  @MaxLength(72) // límite de bcrypt
  password: string;
}
