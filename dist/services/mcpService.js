import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
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
        this.server = new McpServer({
            name: options.name || process.env.MCP_SERVER_NAME || 'waferlock-robot-mcp',
            version: options.version || process.env.MCP_SERVER_VERSION || '1.0.0',
        });
        this.registerTools();
    }
    registerTools() {
        const manualSchema = {
            id: z.string(),
            filename: z.string(),
            originalName: z.string(),
            s3Key: z.string(),
            uploadedAt: z.string(),
            size: z.number().optional(),
            contentType: z.string().optional(),
        };
        const manualListSchema = z.array(z.object(manualSchema));
        this.server.registerTool('list_manuals', {
            description: 'List all uploaded Waferlock product manuals',
            outputSchema: {
                manuals: manualListSchema,
            },
        }, async () => {
            const manuals = await this.manualProvider.listManuals();
            const serialised = manuals.map(serialiseManual);
            return {
                content: [
                    {
                        type: 'text',
                        text: formatManuals(manuals),
                    },
                ],
                structuredContent: {
                    manuals: serialised,
                },
            };
        });
        this.server.registerTool('get_manual_info', {
            description: 'Get information about a specific manual by ID',
            inputSchema: {
                fileId: z.string().describe('The ID of the manual file'),
            },
            outputSchema: manualSchema,
        }, async (args) => {
            const fileId = args.fileId;
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
                structuredContent: serialiseManual(manual),
            };
        });
        this.server.registerTool('search_manuals', {
            description: 'Search for manuals by filename',
            inputSchema: {
                query: z.string().describe('Search query for manual filenames'),
            },
            outputSchema: {
                manuals: manualListSchema,
            },
        }, async (args) => {
            const query = args.query.toLowerCase();
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
                structuredContent: {
                    manuals: results.map(serialiseManual),
                },
            };
        });
    }
    async start(transport = new StdioServerTransport()) {
        await this.server.connect(transport);
        console.error('Waferlock Robot MCP server running on stdio');
        const keepAlive = setInterval(() => {
            // Periodic no-op to keep the event loop active for the MCP session
        }, 60000);
        if (typeof process !== 'undefined' && typeof process.stdin?.resume === 'function') {
            process.stdin.resume();
        }
        await new Promise((resolve, reject) => {
            let settled = false;
            const originalOnClose = transport.onclose;
            const originalOnError = transport.onerror;
            const cleanup = () => {
                clearInterval(keepAlive);
                transport.onclose = originalOnClose;
                transport.onerror = originalOnError;
            };
            const resolveOnce = () => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                resolve();
            };
            const rejectOnce = (error) => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                reject(error instanceof Error ? error : new Error(String(error)));
            };
            transport.onclose = () => {
                try {
                    originalOnClose?.();
                }
                finally {
                    resolveOnce();
                }
            };
            transport.onerror = (error) => {
                try {
                    originalOnError?.(error);
                }
                finally {
                    rejectOnce(error);
                }
            };
        });
    }
    getServer() {
        return this.server;
    }
}
