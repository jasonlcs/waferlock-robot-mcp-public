"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenService = void 0;
const crypto_1 = require("crypto");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const client_s3_1 = require("@aws-sdk/client-s3");
const types_1 = require("../types");
const awsConfig_1 = require("./awsConfig");
const streamHelpers_1 = require("../utils/streamHelpers");
const VALID_SCOPE_STRINGS = new Set(types_1.ALL_TOKEN_SCOPES);
const IMPLIED_SCOPE_MAP = {
    [types_1.TokenScope.FilesWrite]: [types_1.TokenScope.FilesRead],
    [types_1.TokenScope.QaManage]: [types_1.TokenScope.QaRead],
    [types_1.TokenScope.McpAccess]: [types_1.TokenScope.FilesRead, types_1.TokenScope.QaRead],
};
class TokenService {
    constructor() {
        this.tokens = new Map();
        this.initialized = false;
        this.initPromise = null;
        this.metadataKey = `${awsConfig_1.s3MetadataPrefix}/tokens.json`;
        this.useLocalFile = !awsConfig_1.hasAwsCredentials;
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
    resolveScopes(scopes) {
        return this.normaliseScopes(scopes);
    }
    getAvailableScopes() {
        return [...types_1.ALL_TOKEN_SCOPES];
    }
    tokenHasAllScopes(token, scopes) {
        if (!scopes.length) {
            return true;
        }
        const expanded = this.expandScopes(token.scopes);
        return scopes.every((scope) => expanded.has(scope));
    }
    tokenHasAnyScope(token, scopes) {
        if (!scopes.length) {
            return true;
        }
        const expanded = this.expandScopes(token.scopes);
        return scopes.some((scope) => expanded.has(scope));
    }
    async getActiveToken(tokenValue) {
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
    normaliseScopes(scopes) {
        if (!scopes || scopes.length === 0) {
            return [...types_1.ALL_TOKEN_SCOPES];
        }
        if (scopes.some((scope) => scope === 'ALL')) {
            return [...types_1.ALL_TOKEN_SCOPES];
        }
        const explicitScopes = scopes
            .map((scope) => this.parseScope(scope))
            .filter((scope) => scope !== undefined);
        if (explicitScopes.length === 0) {
            return [...types_1.ALL_TOKEN_SCOPES];
        }
        const expanded = this.expandScopes(explicitScopes);
        return Array.from(expanded).sort();
    }
    parseScope(value) {
        if (!value) {
            return undefined;
        }
        const scopeValue = value;
        if (!VALID_SCOPE_STRINGS.has(scopeValue)) {
            return undefined;
        }
        return scopeValue;
    }
    expandScopes(scopes) {
        const result = new Set();
        const visit = (scope) => {
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
    isTokenActive(token) {
        if (!token.isActive) {
            return false;
        }
        if (token.expiresAt && token.expiresAt < new Date()) {
            return false;
        }
        return true;
    }
    loadTokensFromDisk() {
        if (!this.storageFile) {
            return;
        }
        try {
            if (fs.existsSync(this.storageFile)) {
                const data = fs.readFileSync(this.storageFile, 'utf-8');
                const tokensArray = JSON.parse(data);
                let mutated = false;
                tokensArray.forEach((token) => {
                    token.createdAt = new Date(token.createdAt);
                    if (token.expiresAt) {
                        token.expiresAt = new Date(token.expiresAt);
                    }
                    const originalScopes = Array.isArray(token.scopes)
                        ? [...token.scopes]
                        : undefined;
                    const normalisedScopes = this.normaliseScopes(originalScopes);
                    const changed = !originalScopes ||
                        originalScopes.length !== normalisedScopes.length ||
                        originalScopes.some((scope) => !normalisedScopes.includes(scope));
                    token.scopes = normalisedScopes;
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
        }
        catch (error) {
            console.error('Error loading tokens from disk:', error);
        }
    }
    saveTokensToDisk() {
        if (!this.storageFile) {
            return;
        }
        try {
            const tokensArray = Array.from(this.tokens.values());
            fs.writeFileSync(this.storageFile, JSON.stringify(tokensArray, null, 2));
        }
        catch (error) {
            console.error('Error saving tokens to disk:', error);
        }
    }
    async ensureInitialized() {
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
    async loadTokensFromS3() {
        if (!awsConfig_1.hasAwsCredentials) {
            this.tokens.clear();
            return;
        }
        try {
            const command = new client_s3_1.GetObjectCommand({
                Bucket: awsConfig_1.s3BucketName,
                Key: this.metadataKey,
            });
            const response = await awsConfig_1.s3Client.send(command);
            const body = await streamHelpers_1.streamToString(response.Body);
            const tokensArray = JSON.parse(body);
            let mutated = false;
            tokensArray.forEach((token) => {
                token.createdAt = new Date(token.createdAt);
                if (token.expiresAt) {
                    token.expiresAt = new Date(token.expiresAt);
                }
                const originalScopes = Array.isArray(token.scopes)
                    ? [...token.scopes]
                    : undefined;
                const normalisedScopes = this.normaliseScopes(originalScopes);
                const changed = !originalScopes ||
                    originalScopes.length !== normalisedScopes.length ||
                    originalScopes.some((scope) => !normalisedScopes.includes(scope));
                token.scopes = normalisedScopes;
                if (changed) {
                    mutated = true;
                }
                this.tokens.set(token.token, token);
            });
            if (mutated) {
                await this.persistTokens();
            }
            console.log(`Loaded ${tokensArray.length} tokens from S3 metadata`);
        }
        catch (error) {
            if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) {
                console.log('No existing token metadata found in S3. Starting fresh.');
                this.tokens.clear();
                return;
            }
            throw error;
        }
    }
    async persistTokens() {
        if (this.useLocalFile) {
            this.saveTokensToDisk();
            return;
        }
        if (!awsConfig_1.hasAwsCredentials) {
            return;
        }
        const tokensArray = Array.from(this.tokens.values());
        const payload = JSON.stringify(tokensArray, null, 2);
        const command = new client_s3_1.PutObjectCommand({
            Bucket: awsConfig_1.s3BucketName,
            Key: this.metadataKey,
            Body: payload,
            ContentType: 'application/json',
        });
        await awsConfig_1.s3Client.send(command);
    }
    async generateToken(name, expiresInDays, scopes) {
        await this.ensureInitialized();
        const token = crypto_1.randomUUID();
        const normalisedScopes = this.normaliseScopes(scopes);
        const tokenData = {
            id: crypto_1.randomUUID(),
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
    async validateToken(token) {
        const tokenData = await this.getActiveToken(token);
        return Boolean(tokenData);
    }
    async revokeToken(token) {
        await this.ensureInitialized();
        const tokenData = this.tokens.get(token);
        if (tokenData) {
            tokenData.isActive = false;
            await this.persistTokens();
            return true;
        }
        return false;
    }
    async getAllTokens() {
        await this.ensureInitialized();
        return Array.from(this.tokens.values());
    }
    async getTokenByValue(token) {
        await this.ensureInitialized();
        return this.tokens.get(token);
    }
}
exports.tokenService = new TokenService();
