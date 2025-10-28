import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Token, TokenScope, ALL_TOKEN_SCOPES } from '../types';
import {
  hasAwsCredentials,
  s3BucketName,
  s3Client,
  s3MetadataPrefix,
} from './awsConfig';
import { streamToString } from '../utils/streamHelpers';

const VALID_SCOPE_STRINGS = new Set<string>(ALL_TOKEN_SCOPES);

const IMPLIED_SCOPE_MAP: Partial<Record<TokenScope, TokenScope[]>> = {
  [TokenScope.FilesWrite]: [TokenScope.FilesRead],
  [TokenScope.QaManage]: [TokenScope.QaRead],
  [TokenScope.McpAccess]: [TokenScope.FilesRead, TokenScope.QaRead],
};

class TokenService {
  private tokens: Map<string, Token> = new Map();
  private metadataKey: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private useLocalFile: boolean;
  private storageFile?: string;

  constructor() {
    this.metadataKey = `${s3MetadataPrefix}/tokens.json`;
    this.useLocalFile = !hasAwsCredentials;

    if (this.useLocalFile) {
      const dataDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      this.storageFile = path.join(dataDir, 'tokens.json');
      this.loadTokensFromDisk();
      this.initialized = true;
    }
  }

  resolveScopes(scopes?: (TokenScope | string)[]): TokenScope[] {
    return this.normaliseScopes(scopes);
  }

  getAvailableScopes(): TokenScope[] {
    return [...ALL_TOKEN_SCOPES];
  }

  tokenHasAllScopes(token: Token, scopes: TokenScope[]): boolean {
    if (!scopes.length) {
      return true;
    }

    const expanded = this.expandScopes(token.scopes);
    return scopes.every((scope) => expanded.has(scope));
  }

  tokenHasAnyScope(token: Token, scopes: TokenScope[]): boolean {
    if (!scopes.length) {
      return true;
    }

    const expanded = this.expandScopes(token.scopes);
    return scopes.some((scope) => expanded.has(scope));
  }

  async getActiveToken(tokenValue: string): Promise<Token | undefined> {
    await this.ensureInitialized();

    const token = this.tokens.get(tokenValue);
    if (!token) {
      return undefined;
    }

    if (!this.isTokenActive(token)) {
      return undefined;
    }

    token.scopes = this.normaliseScopes(token.scopes);
    return token;
  }

  private normaliseScopes(scopes?: (TokenScope | string)[]): TokenScope[] {
    if (!scopes || scopes.length === 0) {
      return [...ALL_TOKEN_SCOPES];
    }

    if (scopes.some((scope) => scope === 'ALL')) {
      return [...ALL_TOKEN_SCOPES];
    }

    const explicitScopes = scopes
      .map((scope) => this.parseScope(scope))
      .filter((scope): scope is TokenScope => scope !== undefined);

    if (explicitScopes.length === 0) {
      return [...ALL_TOKEN_SCOPES];
    }

    const expanded = this.expandScopes(explicitScopes);
    return Array.from(expanded).sort();
  }

  private parseScope(value: TokenScope | string | undefined): TokenScope | undefined {
    if (!value) {
      return undefined;
    }

    const scopeValue = value as string;
    if (!VALID_SCOPE_STRINGS.has(scopeValue)) {
      return undefined;
    }

    return scopeValue as TokenScope;
  }

  private expandScopes(scopes: Iterable<TokenScope>): Set<TokenScope> {
    const result = new Set<TokenScope>();

    const visit = (scope: TokenScope) => {
      if (result.has(scope)) {
        return;
      }

      result.add(scope);
      const implied = IMPLIED_SCOPE_MAP[scope];
      if (implied) {
        implied.forEach(visit);
      }
    };

    for (const scope of scopes) {
      visit(scope);
    }

    return result;
  }

  private isTokenActive(token: Token): boolean {
    if (!token.isActive) {
      return false;
    }

    if (token.expiresAt && token.expiresAt < new Date()) {
      return false;
    }

    return true;
  }

  private loadTokensFromDisk(): void {
    if (!this.storageFile) {
      return;
    }

    try {
      if (fs.existsSync(this.storageFile)) {
        const data = fs.readFileSync(this.storageFile, 'utf-8');
        const tokensArray: Token[] = JSON.parse(data);
        let mutated = false;

        tokensArray.forEach((token) => {
          token.createdAt = new Date(token.createdAt);
          if (token.expiresAt) {
            token.expiresAt = new Date(token.expiresAt);
          }

          const originalScopes = Array.isArray((token as any).scopes)
            ? [...((token as any).scopes as string[])]
            : undefined;
          const normalisedScopes = this.normaliseScopes(originalScopes as any);

          const changed =
            !originalScopes ||
            originalScopes.length !== normalisedScopes.length ||
            originalScopes.some((scope) => !normalisedScopes.includes(scope as TokenScope));

          (token as Token).scopes = normalisedScopes;
          if (changed) {
            mutated = true;
          }

          this.tokens.set(token.token, token);
        });

        if (mutated) {
          this.saveTokensToDisk();
        }

        console.log(`Loaded ${tokensArray.length} tokens from local storage`);
      }
    } catch (error) {
      console.error('Error loading tokens from disk:', error);
    }
  }

  private saveTokensToDisk(): void {
    if (!this.storageFile) {
      return;
    }

    try {
      const tokensArray = Array.from(this.tokens.values());
      fs.writeFileSync(this.storageFile, JSON.stringify(tokensArray, null, 2));
    } catch (error) {
      console.error('Error saving tokens to disk:', error);
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.useLocalFile || this.initialized) {
      return;
    }

    if (!this.initPromise) {
      this.initPromise = this.loadTokensFromS3()
        .catch((error) => {
          console.error('Error loading tokens from S3 metadata:', error);
          throw error;
        })
        .finally(() => {
          this.initialized = true;
        });
    }

    await this.initPromise;
  }

  private async loadTokensFromS3(): Promise<void> {
    if (!hasAwsCredentials) {
      this.tokens.clear();
      return;
    }

    try {
      const command = new GetObjectCommand({
        Bucket: s3BucketName,
        Key: this.metadataKey,
      });
      const response = await s3Client.send(command);
      const body = await streamToString(response.Body as any);
      const tokensArray: Token[] = JSON.parse(body);
      let mutated = false;

      tokensArray.forEach((token) => {
        token.createdAt = new Date(token.createdAt);
        if (token.expiresAt) {
          token.expiresAt = new Date(token.expiresAt);
        }

        const originalScopes = Array.isArray((token as any).scopes)
          ? [...((token as any).scopes as string[])]
          : undefined;
        const normalisedScopes = this.normaliseScopes(originalScopes as any);

        const changed =
          !originalScopes ||
          originalScopes.length !== normalisedScopes.length ||
          originalScopes.some((scope) => !normalisedScopes.includes(scope as TokenScope));

        (token as Token).scopes = normalisedScopes;
        if (changed) {
          mutated = true;
        }

        this.tokens.set(token.token, token);
      });

      if (mutated) {
        await this.persistTokens();
      }

      console.log(`Loaded ${tokensArray.length} tokens from S3 metadata`);
    } catch (error: any) {
      if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) {
        console.log('No existing token metadata found in S3. Starting fresh.');
        this.tokens.clear();
        return;
      }

      throw error;
    }
  }

  private async persistTokens(): Promise<void> {
    if (this.useLocalFile) {
      this.saveTokensToDisk();
      return;
    }

    if (!hasAwsCredentials) {
      return;
    }

    const tokensArray = Array.from(this.tokens.values());
    const payload = JSON.stringify(tokensArray, null, 2);

    const command = new PutObjectCommand({
      Bucket: s3BucketName,
      Key: this.metadataKey,
      Body: payload,
      ContentType: 'application/json',
    });

    await s3Client.send(command);
  }

  async generateToken(
    name: string,
    expiresInDays?: number,
    scopes?: (TokenScope | string)[]
  ): Promise<Token> {
    await this.ensureInitialized();

    const token = randomUUID();
    const normalisedScopes = this.normaliseScopes(scopes);

    const tokenData: Token = {
      id: randomUUID(),
      token,
      name,
      createdAt: new Date(),
      expiresAt: expiresInDays
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
        : undefined,
      isActive: true,
      scopes: normalisedScopes,
    };

    this.tokens.set(token, tokenData);
    await this.persistTokens();
    return tokenData;
  }

  async validateToken(token: string): Promise<boolean> {
    const tokenData = await this.getActiveToken(token);
    return Boolean(tokenData);
  }

  async revokeToken(token: string): Promise<boolean> {
    await this.ensureInitialized();

    const tokenData = this.tokens.get(token);
    if (tokenData) {
      tokenData.isActive = false;
      await this.persistTokens();
      return true;
    }
    return false;
  }

  async getAllTokens(): Promise<Token[]> {
    await this.ensureInitialized();
    return Array.from(this.tokens.values());
  }

  async getTokenByValue(token: string): Promise<Token | undefined> {
    await this.ensureInitialized();
    return this.tokens.get(token);
  }
}

export const tokenService = new TokenService();
