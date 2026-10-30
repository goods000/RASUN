import { Module, Controller, Get, Param, Query } from "@nestjs/common";
import { ChainService } from "./chain.service";
import { IndexerService } from "./indexer.service";
@Controller()
class ApiController {
  constructor(
    private chain: ChainService,
    private index: IndexerService,
  ) {}
  @Get("health") async health() {
    let chain = "ready";
    try {
      await this.chain.ready();
    } catch {
      chain = "unavailable";
    }
    return {
      ok: true,
      service: "RASUN API",
      runId: process.env.RASUN_DEV_RUN_ID || null,
      chain,
      index: { lastBlock: this.index.lastBlock, error: this.index.error },
    };
  }
  @Get("config") config() {
    return this.chain.publicConfig();
  }
  @Get("overview") overview() {
    return this.chain.overview();
  }
  @Get("market") market(@Query("wallet") wallet?: string) {
    return this.chain.market(wallet);
  }
  @Get("ranking") ranking(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.chain.ranking(page, limit);
  }
  @Get("wallet/:wallet") wallet(@Param("wallet") wallet: string) {
    return this.chain.wallet(wallet);
  }
  @Get("events") events(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("wallet") wallet?: string,
    @Query("event") event?: string,
  ) {
    return this.index.events(page, limit, wallet, event);
  }
}
@Module({
  controllers: [ApiController],
  providers: [ChainService, IndexerService],
})
export class AppModule {}
