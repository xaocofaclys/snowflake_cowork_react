import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Auth, type AuthContext } from '../auth/auth.types';
import { PlannerService, type AdjustRequest, type PlannerChatRequest } from './planner.service';

@Controller('planner')
export class PlannerController {
  constructor(private readonly planner: PlannerService) {}

  @Get('context')
  context(@Auth() a: AuthContext) {
    return this.planner.context(a);
  }

  @Get('territory')
  territory(@Auth() a: AuthContext, @Query('repId') repId: string) {
    return this.planner.territory(a, repId);
  }

  @Post('plan')
  plan(@Auth() a: AuthContext, @Body() b: { repId: string; date: string; startTime?: string }) {
    return this.planner.plan(a, b.repId, b.date, b.startTime);
  }

  /** One change from the map (FR_ADJUST_PLAN), returning the re-planned route. */
  @Post('adjust')
  adjust(@Auth() a: AuthContext, @Body() b: AdjustRequest) {
    return this.planner.adjust(a, b);
  }

  /** Chat with the planner agent (SSE). */
  @Post('chat')
  chat(@Auth() a: AuthContext, @Body() b: PlannerChatRequest, @Req() req: Request, @Res() res: Response) {
    return this.planner.chat(a, b, req, res);
  }
}
