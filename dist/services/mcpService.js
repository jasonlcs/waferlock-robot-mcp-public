import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
function serialiseManual(manual) {
    return {
        ...manual,
        uploadedAt: manual.uploadedAt instanceof Date
            ? manual.uploadedAt.toISOString()
            : manual.uploadedAt,
    };
}
function formatManual(manual) {
    return JSON.stringify(serialiseManual(manual), null, 2);
}
function formatManuals(manuals) {
    return JSON.stringify(manuals.map(serialiseManual), null, 2);
}
export class MCPService {
    constructor(options) {
        if (!options?.manualProvider) {
            throw new Error('A manual provider must be supplied when creating MCPService');
        }
        this.manualProvider = options.manualProvider;
        this.server = new Server({
            name: options.name || process.env.MCP_SERVER_NAME || 'waferlock-robot-mcp',
            version: options.version || process.env.MCP_SERVER_VERSION || '1.0.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupHandlers();
    }
    setupHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'list_manuals',
                    description: 'List all uploaded Waferlock product manuals',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                    },
                },
                {
                    name: 'get_manual_info',
                    description: 'Get information about a specific manual by ID',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            fileId: {
                                type: 'string',
                                description: 'The ID of the manual file',
                            },
                        },
                        required: ['fileId'],
                    },
                },
                {
                    name: 'search_manuals',
                    description: 'Search for manuals by filename',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description: 'Search query for manual filenames',
                            },
                        },
                        required: ['query'],
                    },
                },
            ],
        }));
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            switch (name) {
                case 'list_manuals': {
                    const manuals = await this.manualProvider.listManuals();
                    return {
                        content: [
                            {
                                type: 'text',
                                text: formatManuals(manuals),
                            },
                        ],
                    };
                }
                case 'get_manual_info': {
                    const fileId = args?.fileId;
                    if (!fileId) {
                        throw new Error('fileId is required');
                    }
                    const manual = await this.manualProvider.getManualById(fileId);
                    if (!manual) {
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: `Manual with ID ${fileId} not found`,
                                },
                            ],
                        };
                    }
                    return {
                        content: [
                            {
                                type: 'text',
                                text: formatManual(manual),
                            },
                        ],
                    };
                }
                case 'search_manuals': {
                    const query = (args?.query || '').toLowerCase();
                    const manuals = await this.manualProvider.listManuals();
                    const results = manuals.filter((manual) => manual.originalName.toLowerCase().includes(query) ||
                        manual.filename.toLowerCase().includes(query));
                    return {
                        content: [
                            {
                                type: 'text',
                                text: formatManuals(results),
                            },
                        ],
                    };
                }
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        });
    }
    async start(transport = new StdioServerTransport()) {
        await this.server.connect(transport);
        console.error('Waferlock Robot MCP server running on stdio');
    }
    getServer() {
        return this.server;
    }
}
