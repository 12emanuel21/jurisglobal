import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AsesorAccess } from '../auth/decorators/asesor-access.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ConversationsService } from './conversations.service';
import { SendMessageDto, SetHandoverDto } from './dto/conversation-actions.dto';

/** Inbox de WhatsApp: ADMIN y ASESOR (ESP §8, respuesta 11/12 de la Etapa 0) */
@Controller('conversations')
@UseGuards(JwtAuthGuard)
@AsesorAccess()
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  list() {
    return this.conversations.list();
  }

  /** Adjunto (imagen, nota de voz, PDF). Va antes de ':id'. Con sesión: nginx no publica uploads/chat */
  @Get('media/:file')
  async media(@Param('file') file: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const media = await this.conversations.openMedia(file);
    res.set({
      'Content-Type': media.mime,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(media.downloadName)}`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(media.stream);
  }

  @Get(':id/messages')
  messages(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.messages(id);
  }

  @Get(':id/status')
  status(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.status(id);
  }

  @Post(':id/messages')
  send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto, @CurrentUser() user: AuthenticatedUser) {
    return this.conversations.sendManual(id, dto.text, user.id);
  }

  @Patch(':id/handover')
  @HttpCode(HttpStatus.OK)
  handover(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetHandoverDto) {
    return this.conversations.setBotPaused(id, dto.botPaused);
  }
}
