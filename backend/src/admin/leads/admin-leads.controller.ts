import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AsesorAccess } from '../../auth/decorators/asesor-access.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { SUDO_HEADER } from '../../auth/sudo';
import { csvDate } from './leads-csv';
import { AdminLeadsService } from './admin-leads.service';
import { LeadFiltersDto, LeadQueryDto } from './dto/lead-query.dto';
import { CreateLeadNoteDto, UpdateLeadDto } from './dto/update-lead.dto';

/**
 * Leads del panel. ADMIN y ASESOR: ver, filtrar, cambiar estado, asignar, notas y exportar.
 * Solo ADMIN: anonimizar (sin @AsesorAccess, JwtAuthGuard lo niega al ASESOR: deny-by-default).
 */
@Controller('admin/leads')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminLeadsController {
  constructor(private readonly leads: AdminLeadsService) {}

  @Get()
  @AsesorAccess()
  list(@Query() query: LeadQueryDto) {
    return this.leads.list(query);
  }

  @Get('summary')
  @AsesorAccess()
  summary() {
    return this.leads.summary();
  }

  @Get('assignees')
  @AsesorAccess()
  assignees() {
    return this.leads.assignees();
  }

  /** CSV con los filtros activos (mismos parámetros del listado, sin paginación) */
  @Get('export')
  @AsesorAccess()
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Query() filters: LeadFiltersDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { csv } = await this.leads.exportCsv(user, filters);
    const stamp = csvDate(new Date()).replace(/[: ]/g, '-');
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leads-jurisglobal-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    });
    return csv;
  }

  @Get(':id')
  @AsesorAccess()
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.leads.detail(id);
  }

  @Patch(':id')
  @AsesorAccess()
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeadDto) {
    return this.leads.update(user, id, dto);
  }

  @Post(':id/notes')
  @AsesorAccess()
  addNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateLeadNoteDto,
  ) {
    return this.leads.addNote(user, id, dto.body);
  }

  @Post(':id/anonymize')
  @HttpCode(200)
  @Roles(Role.ADMIN)
  anonymize(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers(SUDO_HEADER) sudoToken?: string,
  ) {
    return this.leads.anonymize(user, id, sudoToken);
  }
}
