import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  public isConnected = false;

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async connectWithRetry(maxAttempts = 3, delayMs = 2000): Promise<void> {
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        await this.$connect();
        this.isConnected = true;
        this.logger.log(
          `✓ Database connected successfully on attempt ${attempt}/${maxAttempts}`,
        );
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Attempt ${attempt}/${maxAttempts} failed: ${message}`,
        );
        if (attempt >= maxAttempts) {
          throw error;
        }
        await this.sleep(delayMs);
      }
    }
  }

  async onModuleInit() {
    try {
      await this.connectWithRetry();
    } catch (error) {
      this.isConnected = false;
      this.logger.error(
        `✗ Failed to connect to database after retries: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.logger.warn(
        'Using mock/fallback mode. Check your DATABASE_URL and ensure the database is reachable.',
      );
      // Don't throw - allow server to start with mock data
    }
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
    } catch (error) {
      this.logger.error(`Error disconnecting: ${error}`);
    }
  }

  async checkConnection(): Promise<boolean> {
    if (!this.isConnected) {
      try {
        await this.$queryRaw`SELECT 1`;
        this.isConnected = true;
        return true;
      } catch {
        return false;
      }
    }
    return true;
  }
}
