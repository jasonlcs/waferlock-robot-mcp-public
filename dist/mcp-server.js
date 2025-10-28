#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const mcpService_1 = require("./services/mcpService");
// Load environment variables without emitting stdout logs that can break MCP stdio
dotenv_1.default.config({ quiet: true });
// Verify MCP token if provided
const mcpToken = process.env.MCP_TOKEN;
if (!mcpToken) {
    console.error('Warning: MCP_TOKEN not set in environment variables');
    console.error('The MCP server will start but token authentication is recommended');
}
// Start MCP server
mcpService_1.mcpService.start().catch((error) => {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
});
