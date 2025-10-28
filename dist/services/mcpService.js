"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCPService = void 0;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const zod_1 = require("zod");
const manualApiProvider_js_1 = require("./manualApiProvider.js");
const qaApiProvider_js_1 = require("./qaApiProvider.js");
const thinkingStore_js_1 = require("./thinkingStore.js");
class MCPService {
    constructor(options = {}) {
        this.serverName = options.name || 'waferlock-robot-mcp';
        this.serverVersion = options.version || '2.1.0';
        if (options.manualProvider && options.qaProvider) {
            this.manualProvider = options.manualProvider;
            this.qaProvider = options.qaProvider;
        }
        else {
            const apiUrl = process.env.API_URL || '';
            const apiToken = process.env.API_TOKEN || '';
            if (!apiUrl || !apiToken) {
                throw new Error('API_URL and API_TOKEN are required');
            }
            this.manualProvider = manualApiProvider_js_1.createManualApiProvider(apiUrl, apiToken);
            this.qaProvider = qaApiProvider_js_1.createQAApiProvider(apiUrl, apiToken);
        }
        this.server = new mcp_js_1.McpServer({
            name: this.serverName,
            version: this.serverVersion,
        });
        this.registerTools();
    }
    registerTools() {
        // Manual Management Tools (3) - 只提供基本資訊，禁止下載
        this.server.registerTool('list_manuals', {
            description: 'List all available manuals with basic metadata (no download)',
            inputSchema: {}
        }, async () => {
            const manuals = await this.manualProvider.listManuals();
            const sanitized = manuals.map((m) => ({
                id: m.id,
                originalName: m.originalName,
                uploadedAt: m.uploadedAt,
                size: m.size,
                indexStatus: m.indexStatus
            }));
            return { content: [{ type: 'text', text: JSON.stringify(sanitized, null, 2) }] };
        });
        this.server.registerTool('get_manual_info', {
            description: 'Get basic information about a specific manual (metadata only, no content/download)',
            inputSchema: { manualId: zod_1.z.string() },
        }, async (args) => {
            const manual = await this.manualProvider.getManualById(args.manualId);
            if (!manual) {
                return { content: [{ type: 'text', text: 'Manual not found' }] };
            }
            const info = {
                id: manual.id,
                originalName: manual.originalName,
                uploadedAt: manual.uploadedAt,
                size: manual.size,
                indexStatus: manual.indexStatus,
                numChunks: manual.numChunks,
                numVectors: manual.numVectors
            };
            return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
        });
        this.server.registerTool('search_manuals', {
            description: 'Search manuals by filename (returns basic info only, no download)',
            inputSchema: { query: zod_1.z.string() },
        }, async (args) => {
            const allManuals = await this.manualProvider.listManuals();
            const filtered = allManuals.filter((m) => m.originalName?.toLowerCase().includes(args.query.toLowerCase()) ||
                m.filename?.toLowerCase().includes(args.query.toLowerCase()));
            const sanitized = filtered.map((m) => ({
                id: m.id,
                originalName: m.originalName,
                uploadedAt: m.uploadedAt,
                size: m.size,
                indexStatus: m.indexStatus
            }));
            return { content: [{ type: 'text', text: JSON.stringify(sanitized, null, 2) }] };
        });
        // Vector Search (1)
        this.server.registerTool('search_manual_vector', {
            description: 'Search within a manual using vector similarity (semantic search)',
            inputSchema: {
                fileId: zod_1.z.string(),
                query: zod_1.z.string(),
                k: zod_1.z.number().optional(),
                minScore: zod_1.z.number().optional(),
            },
        }, async (args) => {
            try {
                const response = await fetch(`${process.env.API_URL || ''}/api/vector-index/search`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.API_TOKEN || ''}`
                    },
                    body: JSON.stringify({
                        fileId: args.fileId,
                        query: args.query,
                        k: args.k || 5,
                        minScore: args.minScore || 0.0
                    })
                });
                const data = await response.json();
                if (!response.ok) {
                    return { content: [{ type: 'text', text: `Error: ${data.error || 'Search failed'}` }] };
                }
                return { content: [{ type: 'text', text: JSON.stringify(data.results, null, 2) }] };
            }
            catch (error) {
                return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
            }
        });
        // Q&A Tools (3)
        this.server.registerTool('list_qa_entries', {
            description: 'List all Q&A entries',
            inputSchema: {
                category: zod_1.z.string().optional(),
                search: zod_1.z.string().optional(),
            },
        }, async (args) => {
            const entries = await this.qaProvider.listEntries(args);
            return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
        });
        this.server.registerTool('search_qa_entries', {
            description: 'Search Q&A entries intelligently',
            inputSchema: {
                query: zod_1.z.string(),
                limit: zod_1.z.number().optional(),
            },
        }, async (args) => {
            const entries = await this.qaProvider.intelligentSearch(args.query, args.limit);
            return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
        });
        this.server.registerTool('get_qa_entry', {
            description: 'Get a specific Q&A entry by ID',
            inputSchema: { entryId: zod_1.z.string() },
        }, async (args) => {
            const entry = await this.qaProvider.getEntryById(args.entryId);
            return { content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }] };
        });
        // Thinking Tools (6)
        this.server.registerTool('start_thinking', {
            description: 'Start a thinking process',
            inputSchema: { thought: zod_1.z.string() },
        }, async (args) => {
            const id = thinkingStore_js_1.thinkingStore.startThinking(args.thought);
            return { content: [{ type: 'text', text: `Started thinking process: ${id}` }] };
        });
        this.server.registerTool('continue_thinking', {
            description: 'Continue a thinking process',
            inputSchema: {
                thinkingId: zod_1.z.string(),
                thought: zod_1.z.string(),
            },
        }, async (args) => {
            thinkingStore_js_1.thinkingStore.continueThinking(args.thinkingId, args.thought);
            return { content: [{ type: 'text', text: 'Thinking continued' }] };
        });
        this.server.registerTool('finish_thinking', {
            description: 'Finish a thinking process',
            inputSchema: { thinkingId: zod_1.z.string() },
        }, async (args) => {
            const process = thinkingStore_js_1.thinkingStore.finishThinking(args.thinkingId);
            return { content: [{ type: 'text', text: JSON.stringify(process, null, 2) }] };
        });
        this.server.registerTool('think_about_collected_information', {
            description: 'Reflect on collected information',
            inputSchema: { reflection: zod_1.z.string() },
        }, async (args) => {
            return { content: [{ type: 'text', text: `Reflected: ${args.reflection}` }] };
        });
        this.server.registerTool('think_about_task_adherence', {
            description: 'Check if staying on task',
            inputSchema: { check: zod_1.z.string() },
        }, async (args) => {
            return { content: [{ type: 'text', text: `Task check: ${args.check}` }] };
        });
        this.server.registerTool('think_about_answer_quality', {
            description: 'Evaluate answer quality',
            inputSchema: { evaluation: zod_1.z.string() },
        }, async (args) => {
            return { content: [{ type: 'text', text: `Quality check: ${args.evaluation}` }] };
        });
    }
    async run() {
        const transport = new stdio_js_1.StdioServerTransport();
        await this.server.connect(transport);
        console.error('Waferlock Robot MCP server running on stdio');
    }
}
exports.MCPService = MCPService;
