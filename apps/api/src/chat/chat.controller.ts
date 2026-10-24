import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Auth, type AuthContext } from '../auth/auth.types';
import { ChatService, type StreamRequest } from './chat.service';

@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('threads')
  list(@Auth() a: AuthContext, @Query('q') q?: string) {
    return this.chat.listThreads(a.user.id, q);
  }

  @Get('threads/:id')
  get(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.chat.getThreadWithMessages(a.user.id, id);
  }

  @Patch('threads/:id')
  update(@Auth() a: AuthContext, @Param('id') id: string, @Body() b: { title?: string; pinned?: boolean }) {
    return this.chat.updateThread(a.user.id, id, b);
  }

  @Delete('threads/:id')
  async remove(@Auth() a: AuthContext, @Param('id') id: string) {
    await this.chat.deleteThread(a.user.id, id);
    return { ok: true };
  }

  @Post('messages/:id/feedback')
  feedback(@Auth() a: AuthContext, @Param('id') id: string, @Body() b: { feedback: 'up' | 'down' | null; note?: string }) {
    return this.chat.feedback(a.user.id, id, b.feedback, b.note);
  }

  /** Streams one chat turn as SSE (normalized events from @cowork/shared). */
  @Post('chat/stream')
  stream(@Auth() a: AuthContext, @Body() b: StreamRequest, @Req() req: Request, @Res() res: Response) {
    return this.chat.streamTurn(a, b, req, res);
  }
}
