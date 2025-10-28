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
        // Use provided providers or create from env vars
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
        // Manual Management Tools (5)
        this.server.registerTool('list_manuals', { description: 'List all available manuals', inputSchema: {}, outputSchema: {} }, async () => {
            const manuals = await this.manualProvider.listManuals();
            return { content: [{ type: 'text', text: JSON.stringify(manuals, null, 2) }] };
        });
        this.server.registerTool('get_manual_info', {
            description: 'Get information about a specific manual',
            inputSchema: { manualId: zod_1.z.string() },
        }, async (args) => {
            const manual = await this.manualProvider.getManualById(args.manualId);
            return { content: [{ type: 'text', text: JSON.stringify(manual, null, 2) }] };
        });
        this.server.registerTool('search_manuals', {
            description: 'Search manuals by filename',
            inputSchema: { query: zod_1.z.string() },
        }, async (args) => {
            const allManuals = await this.manualProvider.listManuals();
            const filtered = allManuals.filter((m) => m.originalName?.toLowerCase().includes(args.query.toLowerCase()) ||
                m.filename?.toLowerCase().includes(args.query.toLowerCase()));
            return { content: [{ type: 'text', text: JSON.stringify(filtered, null, 2) }] };
        });
        this.server.registerTool('get_manual_download_url', {
            description: 'Get download URL for a manual',
            inputSchema: { manualId: zod_1.z.string() },
        }, async (args) => {
            const url = await this.manualProvider.getManualDownloadUrl(args.manualId);
            return { content: [{ type: 'text', text: url }] };
        });
        this.server.registerTool('get_manual_content', {
            description: 'Get the content of a manual (base64 encoded)',
            inputSchema: { manualId: zod_1.z.string() },
        }, async (args) => {
            const content = await this.manualProvider.getManualContent(args.manualId);
            return { content: [{ type: 'text', text: JSON.stringify(content, null, 2) }] };
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
        // Add 3 more thinking helper tools to reach 15 total
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
