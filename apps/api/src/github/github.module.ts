import type { DynamicModule } from "@nestjs/common";
import { Module } from "@nestjs/common";

import { GitHubApiService } from "./github-api.service";
import { GitHubAppAuthService } from "./github-app-auth.service";
import { GitHubCommitSyncService } from "./github-commit-sync.service";
import { GitHubConnectionService } from "./github-connection.service";
import { GitHubManualSyncService } from "./github-manual-sync.service";
import {
  defaultGitHubSyncWorkerOptions,
  GitHubSyncWorkerService,
} from "./github-sync-worker.service";
import { GitHubController } from "./github.controller";
import {
  GITHUB_APP_CONFIG,
  GITHUB_FETCH,
  GITHUB_RETRY_DELAY,
  GITHUB_RETRY_RANDOM,
  GITHUB_SYNC_CLOCK,
  GITHUB_SYNC_WORKER_OPTIONS,
} from "./github.tokens";
import type { GitHubAppConfig } from "./github.types";

@Module({})
export class GitHubModule {
  static register(config: GitHubAppConfig): DynamicModule {
    return {
      module: GitHubModule,
      controllers: [GitHubController],
      providers: [
        { provide: GITHUB_APP_CONFIG, useValue: config },
        { provide: GITHUB_FETCH, useValue: fetch },
        {
          provide: GITHUB_RETRY_DELAY,
          useValue: (milliseconds: number) =>
            new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
        },
        { provide: GITHUB_RETRY_RANDOM, useValue: Math.random },
        { provide: GITHUB_SYNC_CLOCK, useValue: () => new Date() },
        {
          provide: GITHUB_SYNC_WORKER_OPTIONS,
          useValue: defaultGitHubSyncWorkerOptions,
        },
        GitHubAppAuthService,
        GitHubApiService,
        GitHubCommitSyncService,
        GitHubConnectionService,
        GitHubManualSyncService,
        GitHubSyncWorkerService,
      ],
      exports: [GitHubCommitSyncService],
    };
  }
}
