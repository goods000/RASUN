import { Module, Controller, Get } from '@nestjs/common';
@Controller('health') class HealthController { @Get() check() { return { ok: true, service: 'RASUN API', chain: 'BSC Testnet' }; } }
@Module({ controllers: [HealthController] }) export class AppModule {}
