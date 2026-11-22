import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { AdminSettingsService } from './admin-settings.service';
import {
  CreateHolidayDto,
  CreateMotivoDto,
  HolidayQueryDto,
  ReorderMotivosDto,
  UpdateHolidayDto,
  UpdateMotivoDto,
  UpdateSendWindowsDto,
  UpdateSettingsDto,
} from './dto/settings.dto';

/** Configuración dinámica: solo ADMIN (sin @AsesorAccess, el ASESOR recibe 403) */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminSettingsController {
  constructor(private readonly service: AdminSettingsService) {}

  @Get('settings')
  getSettings() {
    return this.service.getSettings();
  }

  @Patch('settings')
  updateSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateSettingsDto) {
    return this.service.updateSettings(user, dto.values);
  }

  @Get('motivos')
  listMotivos() {
    return this.service.listMotivos();
  }

  @Post('motivos')
  createMotivo(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMotivoDto) {
    return this.service.createMotivo(user, dto.name);
  }

  /** Va antes de 'motivos/:id' */
  @Put('motivos/order')
  reorderMotivos(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReorderMotivosDto) {
    return this.service.reorderMotivos(user, dto.ids);
  }

  @Patch('motivos/:id')
  updateMotivo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMotivoDto,
  ) {
    return this.service.updateMotivo(user, id, dto);
  }

  @Get('send-windows')
  listWindows() {
    return this.service.listWindows();
  }

  @Put('send-windows')
  updateWindows(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateSendWindowsDto) {
    return this.service.updateWindows(user, dto.windows);
  }

  @Get('holidays')
  listHolidays(@Query() query: HolidayQueryDto) {
    return this.service.listHolidays(query.year);
  }

  @Post('holidays')
  createHoliday(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateHolidayDto) {
    return this.service.createHoliday(user, dto.date, dto.name);
  }

  @Patch('holidays/:id')
  updateHoliday(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHolidayDto,
  ) {
    return this.service.setHolidayEnabled(user, id, dto.enabled);
  }

  @Delete('holidays/:id')
  removeHoliday(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.removeHoliday(user, id);
  }
}
