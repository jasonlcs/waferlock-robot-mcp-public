#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const manualApiProvider_js_1 = require("./services/manualApiProvider.js");
const qaApiProvider_js_1 = require("./services/qaApiProvider.js");
const mcpService_js_1 = require("./services/mcpService.js");
dotenv_1.default.config({ quiet: true });
const HELP_TEXT = `Waferlock Robot MCP CLI

Usage:
  waferlock-mcp --api-url <url> --api-token <token> [options]

Options:
  --api-url <url>         Base URL for the Waferlock API (e.g. https://your-app.herokuapp.com)
  --api-token <token>     Bearer token with permission to call the Waferlock API
  --server-name <name>    Override the MCP server name reported to the client
  --server-version <ver>  Override the MCP server version
  --mcp-token <token>     Optional token that MCP clients must provide
  -h, --help              Show this help message
`;
function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const current = argv[i];
        if (!current.startsWith('-')) {
            continue;
        }
        if (current === '--help' || current === '-h') {
            args.help = 'true';
            continue;
        }
        if (!current.startsWith('--')) {
            continue;
        }
        const withoutPrefix = current.slice(2);
        const [key, inlineValue] = withoutPrefix.split('=', 2);
        if (inlineValue !== undefined) {
            args[key] = inlineValue;
            continue;
        }
        const next = argv[i + 1];
        if (next && !next.startsWith('-')) {
            args[key] = next;
            i += 1;
        }
        else {
            args[key] = 'true';
        }
    }
    return args;
}
function resolveOption(optionValue, ...fallBackEnvs) {
    if (optionValue && optionValue.length > 0) {
        return optionValue;
    }
    for (const envValue of fallBackEnvs) {
        if (envValue && envValue.length > 0) {
            return envValue;
        }
    }
    return undefined;
}
async function main() {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help === 'true') {
        console.log(HELP_TEXT);
        process.exit(0);
    }
    const apiUrl = resolveOption(parsed['api-url'], process.env.API_URL, process.env.WAFERLOCK_API_URL);
    const apiToken = resolveOption(parsed['api-token'], process.env.API_TOKEN, process.env.WAFERLOCK_API_TOKEN);
    if (!apiUrl) {
        console.error('Error: API URL is required. Provide via --api-url or API_URL/WAFERLOCK_API_URL environment variable.');
        process.exit(1);
    }
    if (!apiToken) {
        console.error('Error: API token is required. Provide via --api-token or API_TOKEN/WAFERLOCK_API_TOKEN environment variable.');
        process.exit(1);
    }
    let resolvedApiUrl;
    let manualProvider;
    let qaProvider;
    try {
        const url = manualApiProvider_js_1.resolveApiUrl(apiUrl);
        resolvedApiUrl = url.toString();
        manualProvider = manualApiProvider_js_1.createManualApiProvider(resolvedApiUrl, apiToken);
        qaProvider = qaApiProvider_js_1.createQAApiProvider(resolvedApiUrl, apiToken);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to initialise manual provider: ${message}`);
        process.exit(1);
    }
    const serverName = resolveOption(parsed['server-name'], process.env.MCP_SERVER_NAME);
    const serverVersion = resolveOption(parsed['server-version'], process.env.MCP_SERVER_VERSION);
    const mcpToken = resolveOption(parsed['mcp-token'], process.env.MCP_TOKEN);
    if (mcpToken) {
        process.env.MCP_TOKEN = mcpToken;
    }
    const service = new mcpService_js_1.MCPService({
        manualProvider,
        qaProvider,
        name: serverName,
        version: serverVersion,
    });
    try {
        console.error(`Connecting Waferlock MCP to API at ${resolvedApiUrl}`);
        await service.start();
    }
    catch (error) {
        console.error('Failed to start Waferlock MCP server:', error);
        process.exit(1);
    }
}
main();
