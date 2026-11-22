import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { isTokenRevoked } from '../auth/token-revocation';
import { SESSION_COOKIE, readCookie } from '../auth/session-cookie';

/** Sala única del panel (instancia de un solo cliente: no hay multi-tenancy) */
export const PANEL_ROOM = 'panel';

type SocketUser = { id: string; role: string };

/**
 * Tiempo real del panel (adaptado de OrdersGateway de KovalCloud): autentica con la misma cookie
 * httpOnly de la sesión (mismo origen, llega en el handshake), valida usuario activo y revocación.
 * CORS: solo mismo origen (nginx sirve web y API bajo el mismo dominio).
 */
@WebSocketGateway({ cors: { origin: false } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  private async authenticate(client: Socket): Promise<SocketUser | null> {
    const token = readCookie(client.handshake.headers?.cookie, SESSION_COOKIE);
    if (!token) return null;
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, role: true, isActive: true, passwordChangedAt: true },
      });
      if (!user?.isActive || isTokenRevoked(payload.iat, user.passwordChangedAt)) return null;
      return { id: user.id, role: user.role };
    } catch {
      return null;
    }
  }

  private reject(client: Socket, reason: string) {
    client.emit('unauthorized', { message: reason });
    client.disconnect(true);
  }

  async handleConnection(client: Socket) {
    const user = await this.authenticate(client);
    if (!user) return this.reject(client, 'Sesión ausente o inválida');
    client.data.user = user;
    await client.join(PANEL_ROOM);
  }

  /** Evento para todo el equipo conectado (message:new, conversation:updated, lead:new…) */
  emitToPanel(event: string, payload: unknown) {
    this.server?.to(PANEL_ROOM).emit(event, payload);
  }

  /** Cierra en el acto los sockets de un usuario (desactivado o cambio de contraseña) */
  disconnectUser(userId: string, reason = 'Tu acceso al sistema fue desactivado') {
    if (!this.server) return;
    for (const client of this.server.sockets.sockets.values()) {
      if ((client.data.user as SocketUser | undefined)?.id === userId) this.reject(client, reason);
    }
    this.logger.log(`Sockets cerrados para el usuario ${userId}`);
  }
}
