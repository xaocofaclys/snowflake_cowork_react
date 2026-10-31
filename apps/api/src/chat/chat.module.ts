import { Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module';
import { ChatController } from './chat.controller';
import { AssistantService } from './assistant.service';
import { ChatService } from './chat.service';

@Module({ imports: [MemoryModule], controllers: [ChatController], providers: [ChatService, AssistantService] })
export class ChatModule {}
