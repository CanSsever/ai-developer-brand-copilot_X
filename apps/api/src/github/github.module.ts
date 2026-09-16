import type { DynamicModule } from "@nestjs/common";
import { Module } from "@nestjs/common";

import { GitHubApiService } from "./github-api.service";
import { GitHubAppAuthService } from "./github-app-auth.service";
import { GitHubConnectionService } from "./github-connection.service";
import { GitHubController } from "./github.controller";
import { GITHUB_APP_CONFIG, GITHUB_FETCH } from "./github.tokens";
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
        GitHubAppAuthService,
        GitHubApiService,
        GitHubConnectionService,
      ],
    };
  }
}
