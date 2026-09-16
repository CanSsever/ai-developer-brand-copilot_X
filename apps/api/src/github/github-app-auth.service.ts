import { createPrivateKey, sign } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { GITHUB_APP_CONFIG } from "./github.tokens";
import type { GitHubAppConfig } from "./github.types";

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

@Injectable()
export class GitHubAppAuthService {
  constructor(
    @Inject(GITHUB_APP_CONFIG) private readonly config: GitHubAppConfig
  ) {}

  createAppJwt(now = new Date()): string {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const header = encode({ alg: "RS256", typ: "JWT" });
    const payload = encode({
      iat: nowSeconds - 60,
      exp: nowSeconds + 9 * 60,
      iss: this.config.clientId,
    });
    const unsignedToken = `${header}.${payload}`;
    const privateKey = createPrivateKey(this.config.privateKey);
    const signature = sign("RSA-SHA256", Buffer.from(unsignedToken), privateKey);

    return `${unsignedToken}.${signature.toString("base64url")}`;
  }
}
