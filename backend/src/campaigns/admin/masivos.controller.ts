import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { SUDO_HEADER } from '../../auth/sudo';
import { ContactsService, MAX_IMPORT_BYTES, type UploadedSpreadsheet } from './contacts.service';
import { TemplatesService } from './templates.service';
import { CampaignsService } from './campaigns.service';
import {
  CampaignPreviewDto,
  ContactQueryDto,
  CreateCampaignDto,
  CreateContactDto,
  ImportContactsDto,
  OptOutContactDto,
  RecipientsQueryDto,
  TemplateDto,
} from './dto';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Contactos de masivos: solo ADMIN (el ASESOR recibe 403) */
@Controller('admin/contacts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  list(@Query() q: ContactQueryDto) {
    return this.contacts.list(q);
  }

  @Get('sources')
  sources() {
    return this.contacts.sources();
  }

  @Get('imports')
  imports() {
    return this.contacts.imports();
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateContactDto) {
    return this.contacts.create(user, dto);
  }

  @Post('import')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } }))
  import(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedSpreadsheet | undefined,
    @Body() dto: ImportContactsDto,
  ) {
    return this.contacts.import(user, file, dto.consentNote);
  }

  @Post(':id/opt-out')
  @HttpCode(200)
  optOut(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid) id: string, @Body() dto: OptOutContactDto) {
    return this.contacts.optOut(user, id, dto.note);
  }
}

/** Plantillas de Meta: solo ADMIN */
@Controller('admin/templates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminTemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  list() {
    return this.templates.list();
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: TemplateDto) {
    return this.templates.create(user, dto);
  }

  /** Va antes de ':id' */
  @Post('sync')
  @HttpCode(200)
  sync(@CurrentUser() user: AuthenticatedUser) {
    return this.templates.sync(user);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid) id: string, @Body() dto: TemplateDto) {
    return this.templates.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid) id: string) {
    return this.templates.remove(user, id);
  }
}

/** Campañas: solo ADMIN */
@Controller('admin/campaigns')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminCampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  list() {
    return this.campaigns.list();
  }

  @Post('preview')
  @HttpCode(200)
  preview(@Body() dto: CampaignPreviewDto) {
    return this.campaigns.preview(dto);
  }

  /** Lanzar es una acción sensible: con 2FA activo exige Sudo Mode (x-sudo-token) */
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCampaignDto,
    @Headers(SUDO_HEADER) sudoToken?: string,
  ) {
    return this.campaigns.create(user, dto, sudoToken);
  }

  @Get(':id')
  detail(@Param('id', uuid) id: string) {
    return this.campaigns.detail(id);
  }

  @Get(':id/recipients')
  recipients(@Param('id', uuid) id: string, @Query() q: RecipientsQueryDto) {
    return this.campaigns.recipients(id, q);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid) id: string) {
    return this.campaigns.pause(user, id);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid) id: string) {
    return this.campaigns.resume(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid) id: string) {
    return this.campaigns.cancel(user, id);
  }
}
