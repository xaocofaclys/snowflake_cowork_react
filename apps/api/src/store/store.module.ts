import { Global, Module, OnModuleInit } from '@nestjs/common';
import { env } from '../config/env';
import { SnowflakeClient } from '../snowflake/snowflake.client';
import { DocStore } from './doc-store';
import { FileStore } from './file.store';
import { SnowflakeStore } from './snowflake.store';

@Global()
@Module({
  providers: [
    SnowflakeClient,
    {
      provide: DocStore,
      inject: [SnowflakeClient],
      useFactory: (sf: SnowflakeClient) => (env.APP_STORE === 'snowflake' ? new SnowflakeStore(sf) : new FileStore()),
    },
  ],
  exports: [DocStore, SnowflakeClient],
})
export class StoreModule implements OnModuleInit {
  constructor(private readonly store: DocStore) {}

  async onModuleInit() {
    if (this.store instanceof SnowflakeStore) await this.store.ensureSchema();
  }
}
