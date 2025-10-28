import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import OpenAI from 'openai';
import { createS3ManualProvider } from './manualProvider';
import { createS3QAProvider } from './qaProvider';
import { caseService } from './caseService';
import { fileContentStore } from './fileContentStore';
import { contentExtractionService } from './contentExtractionService';
import { vectorIndexService } from './vectorIndex/VectorIndexService';
import { thinkingStore } from './thinkingStore';
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
function serialiseQA(entry) {
    return {
        ...entry,
        createdAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : entry.createdAt,
        updatedAt: entry.updatedAt instanceof Date ? entry.updatedAt.toISOString() : entry.updatedAt,
    };
}
function formatQA(entry) {
    return JSON.stringify(serialiseQA(entry), null, 2);
}
function formatQAList(entries) {
    return JSON.stringify(entries.map(serialiseQA), null, 2);
}
export class MCPService {
    constructor(options = {}) {
        this.manualProvider = options.manualProvider || createS3ManualProvider();
        this.qaProvider = options.qaProvider || createS3QAProvider();
        this.server = new McpServer({
            name: options.name || process.env.MCP_SERVER_NAME || 'waferlock-robot-mcp',
            version: options.version || process.env.MCP_SERVER_VERSION || '1.0.0',
        });
        this.registerTools();
        this.registerResources();
        this.registerPrompts();
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
        const downloadSchema = {
            downloadUrl: z.string().url(),
            expiresInSeconds: z.number(),
        };
        const manualContentSchema = {
            file: z.object(manualSchema),
            contentBase64: z.string(),
        };
        const qaSchema = {
            id: z.string(),
            category: z.string(),
            question: z.string(),
            answer: z.string(),
            createdAt: z.string(),
            updatedAt: z.string(),
        };
        const qaListSchema = z.array(z.object(qaSchema));
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
                throw new Error(`Manual with ID ${fileId} not found`);
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
        this.server.registerTool('get_manual_download_url', {
            description: 'Generate a temporary download URL for a manual by ID',
            inputSchema: {
                fileId: z.string().describe('The ID of the manual file'),
                expiresInSeconds: z
                    .number()
                    .int()
                    .min(1)
                    .max(60 * 60)
                    .optional()
                    .describe('Optional expiry in seconds (default 900, max 3600)'),
            },
            outputSchema: downloadSchema,
        }, async (args) => {
            if (typeof this.manualProvider.getManualDownloadUrl !== 'function') {
                throw new Error('Manual download URLs are not supported by the configured provider.');
            }
            const expiresInSeconds = args.expiresInSeconds;
            const downloadUrl = await this.manualProvider.getManualDownloadUrl(args.fileId, {
                expiresInSeconds,
            });
            if (!downloadUrl) {
                throw new Error(`Manual with ID ${args.fileId} not found`);
            }
            const effectiveExpiresInSeconds = typeof expiresInSeconds === 'number' ? expiresInSeconds : 900;
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            downloadUrl,
                            expiresInSeconds: effectiveExpiresInSeconds,
                        }, null, 2),
                    },
                ],
                structuredContent: {
                    downloadUrl,
                    expiresInSeconds: effectiveExpiresInSeconds,
                },
            };
        });
        this.server.registerTool('get_manual_content', {
            description: 'Fetch the full manual content (base64-encoded) for AI processing. Intended for MCP agent use only.',
            inputSchema: {
                fileId: z.string().describe('The ID of the manual file'),
            },
            outputSchema: manualContentSchema,
        }, async (args) => {
            if (typeof this.manualProvider.getManualContent !== 'function') {
                throw new Error('Manual content retrieval is not supported by the configured provider.');
            }
            const result = await this.manualProvider.getManualContent(args.fileId);
            if (!result) {
                throw new Error(`Manual with ID ${args.fileId} not found`);
            }
            const responsePayload = {
                file: serialiseManual(result.file),
                contentBase64: result.contentBase64,
            };
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(responsePayload, null, 2),
                    },
                ],
                structuredContent: responsePayload,
            };
        });
        this.server.registerTool('list_qa_entries', {
            description: 'List maintained troubleshooting Q&A entries',
            inputSchema: {
                category: z.string().optional().describe('Optional category filter'),
                search: z.string().optional().describe('Optional keyword search across category, question, and answer'),
            },
            outputSchema: {
                entries: qaListSchema,
            },
        }, async (args) => {
            const entries = await this.qaProvider.listEntries({
                category: args.category,
                search: args.search,
            });
            const serialised = entries.map(serialiseQA);
            return {
                content: [
                    {
                        type: 'text',
                        text: formatQAList(entries),
                    },
                ],
                structuredContent: {
                    entries: serialised,
                },
            };
        });
        this.server.registerTool('search_qa_entries', {
            description: `Search Q&A entries by keyword using intelligent relevance ranking.
Returns Q&A entries sorted by relevance to the query.
Matches across question, answer, and category fields.`,
            inputSchema: {
                query: z.string().describe('What to search for (e.g., "how to install", "error 502")'),
                limit: z.number().int().min(1).max(10).optional().describe('Number of results (default 5, max 10)'),
                intelligent: z.boolean().optional().describe('Use intelligent ranking (default true)'),
            },
            outputSchema: {
                entries: qaListSchema,
            },
        }, async (args) => {
            let entries;
            if (args.intelligent !== false) {
                // 使用智能搜尋 (預設)
                entries = await this.qaProvider.intelligentSearch(args.query, args.limit || 5);
            }
            else {
                // 使用基本搜尋
                entries = await this.qaProvider.searchEntries(args.query);
                entries = entries.slice(0, args.limit || 5);
            }
            const serialised = entries.map(serialiseQA);
            return {
                content: [
                    {
                        type: 'text',
                        text: entries.length > 0
                            ? `Found ${entries.length} relevant Q&A entries:\n\n${entries.map((e, i) => `[${i + 1}] Q: ${e.question}\nA: ${e.answer}`).join('\n\n')}`
                            : `No Q&A entries found for "${args.query}".`,
                    },
                ],
                structuredContent: {
                    entries: serialised,
                },
            };
        });
        this.server.registerTool('get_qa_entry', {
            description: 'Get a specific Q&A entry by ID',
            inputSchema: {
                id: z.string().describe('The ID of the Q&A entry'),
            },
            outputSchema: qaSchema,
        }, async (args) => {
            const entry = await this.qaProvider.getEntryById(args.id);
            if (!entry) {
                throw new Error(`QA entry with ID ${args.id} not found`);
            }
            const serialised = serialiseQA(entry);
            return {
                content: [
                    {
                        type: 'text',
                        text: formatQA(entry),
                    },
                ],
                structuredContent: serialised,
            };
        });
        // 新增工具：在手冊中搜尋內容
        this.server.registerTool('search_manual_content', {
            description: `Search within a manual for relevant content snippets.
Searches the extracted text content of a manual and returns the most relevant passages.
Use this when you need to find specific information from a manual without downloading the entire file.`,
            inputSchema: {
                fileId: z.string().describe('The ID of the manual to search in'),
                query: z.string().describe('What to search for (e.g., "installation steps", "troubleshooting")'),
                limit: z.number().int().min(1).max(10).optional().describe('Number of results to return (default 5, max 10)'),
            },
            outputSchema: {
                fileId: z.string(),
                query: z.string(),
                resultCount: z.number(),
                results: z.array(z.object({
                    id: z.string(),
                    content: z.string(),
                    chunkOrder: z.number(),
                })),
            },
        }, async (args) => {
            const fileContent = fileContentStore.get(args.fileId);
            if (!fileContent) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Manual content for file ${args.fileId} is not yet indexed. Please try again after the file is processed.`,
                        },
                    ],
                    structuredContent: {
                        fileId: args.fileId,
                        query: args.query,
                        resultCount: 0,
                        results: [],
                    },
                };
            }
            // 使用搜尋服務找相關段落
            const results = contentExtractionService.searchChunks(fileContent.chunks, args.query, args.limit || 5);
            const responseData = {
                fileId: args.fileId,
                query: args.query,
                resultCount: results.length,
                results: results.map(r => ({
                    id: r.id,
                    content: r.content,
                    chunkOrder: r.chunkOrder,
                })),
            };
            return {
                content: [
                    {
                        type: 'text',
                        text: results.length > 0
                            ? `Found ${results.length} relevant passages:\n\n${results.map((r, i) => `[${i + 1}] ${r.content}`).join('\n\n')}`
                            : `No relevant content found for "${args.query}" in this manual.`,
                    },
                ],
                structuredContent: responseData,
            };
        });
        // 新增工具：在所有手冊中搜尋
        this.server.registerTool('search_all_manuals', {
            description: `Search across all manuals for relevant content.
Searches the extracted text content of all available manuals and returns matching passages.
Useful when you don't know which manual contains the information.`,
            inputSchema: {
                query: z.string().describe('What to search for'),
                limit: z.number().int().min(1).max(20).optional().describe('Total results to return (default 10, max 20)'),
            },
            outputSchema: {
                query: z.string(),
                totalResults: z.number(),
                results: z.array(z.object({
                    fileId: z.string(),
                    fileName: z.string(),
                    snippet: z.string(),
                    chunkOrder: z.number(),
                })),
            },
        }, async (args) => {
            const allResults = fileContentStore.searchAllChunks(args.query);
            if (allResults.size === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `No results found for "${args.query}" across all manuals.`,
                        },
                    ],
                    structuredContent: {
                        query: args.query,
                        totalResults: 0,
                        results: [],
                    },
                };
            }
            // 聚合所有結果
            const aggregatedResults = [];
            for (const [fileId, chunks] of allResults) {
                const file = (await this.manualProvider.listManuals()).find(f => f.id === fileId);
                const fileName = file?.originalName || 'Unknown';
                for (const chunk of chunks.slice(0, 3)) { // 每個檔案最多 3 個結果
                    aggregatedResults.push({
                        fileId,
                        fileName,
                        snippet: chunk.content.substring(0, 200) + (chunk.content.length > 200 ? '...' : ''),
                        chunkOrder: chunk.chunkOrder,
                    });
                    if (aggregatedResults.length >= (args.limit || 10)) {
                        break;
                    }
                }
                if (aggregatedResults.length >= (args.limit || 10)) {
                    break;
                }
            }
            const responseData = {
                query: args.query,
                totalResults: aggregatedResults.length,
                results: aggregatedResults,
            };
            return {
                content: [
                    {
                        type: 'text',
                        text: `Found ${aggregatedResults.length} results:\n\n${aggregatedResults.map((r, i) => `[${i + 1}] From "${r.fileName}":\n${r.snippet}`).join('\n\n')}`,
                    },
                ],
                structuredContent: responseData,
            };
        });
        // 新增工具：取得檔案索引統計
        this.server.registerTool('get_manual_index_stats', {
            description: `Get indexing statistics for a manual.
Returns information about the extracted content and chunks for a specific manual.`,
            inputSchema: {
                fileId: z.string().describe('The ID of the manual'),
            },
            outputSchema: {
                fileId: z.string(),
                fileName: z.string(),
                isIndexed: z.boolean(),
                totalChunks: z.number().optional(),
                totalCharacters: z.number().optional(),
                extractedAt: z.string().optional(),
            },
        }, async (args) => {
            const fileContent = fileContentStore.get(args.fileId);
            const file = (await this.manualProvider.listManuals()).find(f => f.id === args.fileId);
            if (!file) {
                throw new Error(`Manual ${args.fileId} not found.`);
            }
            const totalCharacters = fileContent
                ? fileContent.chunks.reduce((sum, c) => sum + c.content.length, 0)
                : 0;
            const responseData = {
                fileId: args.fileId,
                fileName: file.originalName,
                isIndexed: !!fileContent,
                totalChunks: fileContent?.totalChunks,
                totalCharacters,
                extractedAt: fileContent?.extractedAt.toISOString(),
            };
            return {
                content: [
                    {
                        type: 'text',
                        text: fileContent
                            ? `Manual "${file.originalName}" is indexed:\n- Chunks: ${fileContent.totalChunks}\n- Characters: ${totalCharacters}\n- Extracted: ${fileContent.extractedAt.toISOString()}`
                            : `Manual "${file.originalName}" is not yet indexed. It will be indexed automatically after upload completes.`,
                    },
                ],
                structuredContent: responseData,
            };
        });
        this.server.registerTool('search_manual_vector', {
            description: `Search manual content using vector similarity search.
This is much faster than get_manual_content as it only returns relevant chunks without downloading the entire file.
Use this to find specific information in manuals based on semantic similarity.`,
            inputSchema: {
                fileId: z.string().describe('The ID of the manual to search'),
                query: z.string().describe('The search query (e.g., "L600 特點", "如何安裝")'),
                k: z.number().int().min(1).max(10).optional().describe('Number of results to return (default 5, max 10)'),
                minScore: z.number().min(0).max(1).optional().describe('Minimum similarity score (0-1, default 0.0)'),
            },
            outputSchema: {
                results: z.array(z.object({
                    chunkId: z.string(),
                    fileId: z.string(),
                    content: z.string(),
                    score: z.number(),
                    metadata: z.object({
                        chunkId: z.string(),
                        fileId: z.string(),
                        vectorId: z.number(),
                        content: z.string(),
                        startIndex: z.number(),
                        endIndex: z.number(),
                        chunkOrder: z.number(),
                        createdAt: z.string(),
                    }),
                })),
            },
        }, async (args) => {
            try {
                const results = await vectorIndexService.searchVector({
                    fileId: args.fileId,
                    query: args.query,
                    k: args.k,
                    minScore: args.minScore,
                });
                const serializedResults = results.map((r) => ({
                    ...r,
                    metadata: {
                        ...r.metadata,
                        createdAt: r.metadata.createdAt instanceof Date
                            ? r.metadata.createdAt.toISOString()
                            : r.metadata.createdAt,
                    },
                }));
                return {
                    content: [
                        {
                            type: 'text',
                            text: results.length > 0
                                ? `Found ${results.length} relevant chunks:\n\n` +
                                    results.map((r, i) => `${i + 1}. (Score: ${r.score.toFixed(3)})\n${r.content.substring(0, 200)}...`).join('\n\n')
                                : 'No relevant content found for the query.',
                        },
                    ],
                    structuredContent: {
                        results: serializedResults,
                    },
                };
            }
            catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to search manual: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    structuredContent: {
                        results: [],
                    },
                };
            }
        });
        // Semantic search across all manuals
        this.server.registerTool('semantic_search', {
            description: `Perform semantic search across ALL manuals simultaneously.
Use this when you don't know which manual contains the information or want to search across multiple manuals.
This searches the entire manual database using AI-powered semantic understanding.`,
            inputSchema: {
                query: z.string().describe('The search query (e.g., "連線問題", "L600安裝步驟", "維護週期")'),
                k: z.number().int().min(1).max(20).optional().describe('Number of results to return (default 5, max 20)'),
                minScore: z.number().min(0).max(1).optional().describe('Minimum similarity score (0-1, default 0.5)'),
            },
            outputSchema: {
                results: z.array(z.object({
                    chunkId: z.string(),
                    fileId: z.string(),
                    fileName: z.string(),
                    content: z.string(),
                    score: z.number(),
                    metadata: z.object({
                        chunkId: z.string(),
                        fileId: z.string(),
                        vectorId: z.number(),
                        content: z.string(),
                        startIndex: z.number(),
                        endIndex: z.number(),
                        chunkOrder: z.number(),
                        createdAt: z.string(),
                    }),
                })),
            },
        }, async (args) => {
            try {
                // Use the new searchAllManuals method
                const results = await vectorIndexService.searchAllManuals(args.query, args.k || 5, args.minScore || 0.5);
                // Get file info for each result
                const manuals = await this.manualProvider.listManuals();
                const fileMap = new Map(manuals.map(m => [m.id, m.originalName]));
                const enrichedResults = results.map((r) => ({
                    ...r,
                    fileName: fileMap.get(r.fileId) || 'Unknown',
                    metadata: {
                        ...r.metadata,
                        createdAt: r.metadata.createdAt instanceof Date
                            ? r.metadata.createdAt.toISOString()
                            : r.metadata.createdAt,
                    },
                }));
                return {
                    content: [
                        {
                            type: 'text',
                            text: results.length > 0
                                ? `Found ${results.length} relevant passages across ${new Set(results.map(r => r.fileId)).size} manuals:\n\n` +
                                    enrichedResults.map((r, i) => `${i + 1}. [${r.fileName}] (Score: ${r.score.toFixed(3)})\n${r.content.substring(0, 250)}${r.content.length > 250 ? '...' : ''}`).join('\n\n')
                                : 'No relevant content found for the query. Try different keywords or lower the minScore.',
                        },
                    ],
                    structuredContent: {
                        results: enrichedResults,
                    },
                };
            }
            catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to perform semantic search: ${error instanceof Error ? error.message : String(error)}\n\nNote: Semantic search requires vector indexes to be built. Upload manuals and wait for indexing to complete.`,
                        },
                    ],
                    structuredContent: {
                        results: [],
                    },
                };
            }
        });
        // ============================================================
        // Customer Case Management Tools
        // ============================================================
        this.server.registerTool('create_case', {
            description: 'Create a new customer support case',
            inputSchema: {
                customerId: z.string().describe('Customer ID or identifier'),
                customerName: z.string().optional().describe('Customer name'),
                customerEmail: z.string().email().optional().describe('Customer email'),
                customerPhone: z.string().optional().describe('Customer phone number'),
                deviceModel: z.string().optional().describe('Device model'),
                deviceSerial: z.string().optional().describe('Device serial number'),
                issueCategory: z.string().describe('Issue category (e.g., connection, power, configuration)'),
                subject: z.string().describe('Brief subject/title of the issue'),
                description: z.string().describe('Detailed description of the problem'),
                priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('Case priority (default: medium)'),
                assignedTo: z.string().optional().describe('Assign to specific agent'),
                tags: z.array(z.string()).optional().describe('Tags for categorization'),
            },
        }, async (args) => {
            try {
                const customerCase = await caseService.createCase(args);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Case created successfully!\n\nCase ID: ${customerCase.id}\nSubject: ${customerCase.subject}\nStatus: ${customerCase.status}\nPriority: ${customerCase.priority}\n\nNext steps:\n1. Review case details\n2. Search for similar cases or related Q&A\n3. Assign to appropriate team member\n4. Update case as you make progress`,
                        },
                    ],
                    structuredContent: {
                        case: {
                            ...customerCase,
                            createdAt: customerCase.createdAt.toISOString(),
                            updatedAt: customerCase.updatedAt.toISOString(),
                        },
                    },
                };
            }
            catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to create case: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                };
            }
        });
        this.server.registerTool('get_case', {
            description: 'Get details of a specific case',
            inputSchema: {
                caseId: z.string().describe('Case ID'),
            },
        }, async (args) => {
            try {
                const customerCase = await caseService.getCase(args.caseId);
                if (!customerCase) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Case ${args.caseId} not found`,
                            },
                        ],
                    };
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Case: ${customerCase.subject}\n\nStatus: ${customerCase.status}\nPriority: ${customerCase.priority}\nAssigned to: ${customerCase.assignedTo || 'Unassigned'}\n\nDescription:\n${customerCase.description}\n\n${customerCase.resolution ? `Resolution:\n${customerCase.resolution}\n\n` : ''}Timeline:\n${customerCase.timeline.map(e => `- ${e.timestamp.toISOString()}: ${e.description}`).join('\n')}`,
                        },
                    ],
                    structuredContent: {
                        case: {
                            ...customerCase,
                            createdAt: customerCase.createdAt.toISOString(),
                            updatedAt: customerCase.updatedAt.toISOString(),
                            closedAt: customerCase.closedAt?.toISOString(),
                            timeline: customerCase.timeline.map(e => ({
                                ...e,
                                timestamp: e.timestamp.toISOString(),
                            })),
                        },
                    },
                };
            }
            catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to get case: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                };
            }
        });
        this.server.registerTool('update_case', {
            description: 'Update a case with new information',
            inputSchema: {
                caseId: z.string().describe('Case ID'),
                status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional().describe('Update case status'),
                priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('Update priority'),
                assignedTo: z.string().optional().describe('Reassign case'),
                resolution: z.string().optional().describe('Resolution details (when resolving)'),
                comment: z.string().optional().describe('Add a comment/note'),
                relatedManuals: z.array(z.string()).optional().describe('Link related manual IDs'),
                relatedQA: z.array(z.string()).optional().describe('Link related Q&A IDs'),
                tags: z.array(z.string()).optional().describe('Update tags'),
                actor: z.string().optional().describe('Who is making this update (default: system)'),
            },
        }, async (args) => {
            try {
                const { caseId, actor, ...update } = args;
                const customerCase = await caseService.updateCase(caseId, update, actor || 'system');
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Case ${caseId} updated successfully!\n\nCurrent status: ${customerCase.status}\nPriority: ${customerCase.priority}\n\nLatest update:\n${customerCase.timeline[customerCase.timeline.length - 1].description}`,
                        },
                    ],
                    structuredContent: {
                        case: {
                            ...customerCase,
                            createdAt: customerCase.createdAt.toISOString(),
                            updatedAt: customerCase.updatedAt.toISOString(),
                            closedAt: customerCase.closedAt?.toISOString(),
                            timeline: customerCase.timeline.map(e => ({
                                ...e,
                                timestamp: e.timestamp.toISOString(),
                            })),
                        },
                    },
                };
            }
            catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to update case: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                };
            }
        });
        this.server.registerTool('search_cases', {
            description: 'Search customer support cases with filters',
            inputSchema: {
                customerId: z.string().optional().describe('Filter by customer ID'),
                deviceModel: z.string().optional().describe('Filter by device model'),
                status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional().describe('Filter by status'),
                priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('Filter by priority'),
                issueCategory: z.string().optional().describe('Filter by issue category'),
                assignedTo: z.string().optional().describe('Filter by assigned agent'),
                keyword: z.string().optional().describe('Search in subject, description, resolution'),
                limit: z.number().int().min(1).max(100).optional().describe('Max results (default 50)'),
            },
        }, async (args) => {
            try {
                const cases = await caseService.searchCases(args);
                return {
                    content: [
                        {
                            type: 'text',
                            text: cases.length > 0
                                ? `Found ${cases.length} cases:\n\n` +
                                    cases.map((c, i) => `${i + 1}. [${c.status.toUpperCase()}] ${c.subject}\n   ID: ${c.id}\n   Priority: ${c.priority} | Category: ${c.issueCategory}\n   Created: ${c.createdAt.toISOString()}`).join('\n\n')
                                : 'No cases found matching the criteria',
                        },
                    ],
                    structuredContent: {
                        cases: cases.map(c => ({
                            ...c,
                            createdAt: c.createdAt.toISOString(),
                            updatedAt: c.updatedAt.toISOString(),
                            closedAt: c.closedAt?.toISOString(),
                            timeline: c.timeline.map(e => ({
                                ...e,
                                timestamp: e.timestamp.toISOString(),
                            })),
                        })),
                    },
                };
            }
            catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to search cases: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                };
            }
        });
        this.server.registerTool('close_case', {
            description: 'Close a case with resolution',
            inputSchema: {
                caseId: z.string().describe('Case ID'),
                resolution: z.string().describe('Final resolution description'),
                actor: z.string().optional().describe('Who is closing the case'),
            },
        }, async (args) => {
            try {
                const customerCase = await caseService.updateCase(args.caseId, {
                    status: 'closed',
                    resolution: args.resolution,
                }, args.actor || 'system');
                const resolutionTimeHours = customerCase.resolutionTime
                    ? (customerCase.resolutionTime / (1000 * 60 * 60)).toFixed(1)
                    : 'N/A';
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Case ${args.caseId} closed successfully!\n\nResolution time: ${resolutionTimeHours} hours\n\nResolution:\n${args.resolution}`,
                        },
                    ],
                    structuredContent: {
                        case: {
                            ...customerCase,
                            createdAt: customerCase.createdAt.toISOString(),
                            updatedAt: customerCase.updatedAt.toISOString(),
                            closedAt: customerCase.closedAt?.toISOString(),
                            timeline: customerCase.timeline.map(e => ({
                                ...e,
                                timestamp: e.timestamp.toISOString(),
                            })),
                        },
                    },
                };
            }
            catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to close case: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                };
            }
        });
        this.server.registerTool('get_case_statistics', {
            description: 'Get statistics about all customer support cases',
        }, async () => {
            try {
                const stats = await caseService.getStatistics();
                const avgHours = (stats.avgResolutionTime / (1000 * 60 * 60)).toFixed(1);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Case Statistics:\n\nTotal cases: ${stats.total}\n\nBy Status:\n${Object.entries(stats.byStatus).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\nBy Priority:\n${Object.entries(stats.byPriority).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\nAvg Resolution Time: ${avgHours} hours`,
                        },
                    ],
                    structuredContent: {
                        statistics: {
                            ...stats,
                            avgResolutionTimeHours: parseFloat(avgHours),
                        },
                    },
                };
            }
            catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to get statistics: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                };
            }
        });
        // ============================================================
        // Phase 5: 智能推薦工具
        // ============================================================
        this.server.registerTool('recommend_solutions', {
            description: 'Recommend relevant Q&A solutions based on semantic similarity to the query. Uses AI embeddings to find the most helpful solutions.',
            inputSchema: {
                query: z.string().describe('The problem or question to find solutions for'),
                k: z.number().optional().describe('Number of recommendations to return (default: 5)'),
                minScore: z.number().optional().describe('Minimum similarity score (0-1, default: 0.6)'),
            },
        }, async (args) => {
            try {
                const k = args.k || 5;
                const minScore = args.minScore || 0.6;
                // 取得所有 Q&A
                const allQA = await this.qaProvider.listQA({});
                if (allQA.length === 0) {
                    return {
                        content: [{
                                type: 'text',
                                text: 'No Q&A entries available for recommendations.',
                            }],
                    };
                }
                // 使用 OpenAI Embeddings 計算相似度
                const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                const queryEmbedding = await openai.embeddings.create({
                    model: 'text-embedding-3-small',
                    input: args.query,
                });
                // 計算每個 Q&A 的相似度
                const recommendations = [];
                for (const qa of allQA) {
                    const qaText = `${qa.question}\n${qa.answer}`;
                    const qaEmbedding = await openai.embeddings.create({
                        model: 'text-embedding-3-small',
                        input: qaText,
                    });
                    // 計算 cosine similarity
                    const score = this.cosineSimilarity(queryEmbedding.data[0].embedding, qaEmbedding.data[0].embedding);
                    if (score >= minScore) {
                        recommendations.push({ qa, score });
                    }
                }
                // 排序並取前 k 個
                recommendations.sort((a, b) => b.score - a.score);
                const topRecommendations = recommendations.slice(0, k);
                if (topRecommendations.length === 0) {
                    return {
                        content: [{
                                type: 'text',
                                text: `No Q&A solutions found with similarity score >= ${minScore}. Try lowering minScore or rephrasing the query.`,
                            }],
                    };
                }
                const text = `Found ${topRecommendations.length} recommended solutions:\n\n` +
                    topRecommendations.map((rec, idx) => `${idx + 1}. [Score: ${rec.score.toFixed(3)}] ${rec.qa.question}\n` +
                        `   Category: ${rec.qa.category}\n` +
                        `   Answer: ${rec.qa.answer.substring(0, 200)}${rec.qa.answer.length > 200 ? '...' : ''}\n`).join('\n');
                return {
                    content: [{ type: 'text', text }],
                    structuredContent: {
                        recommendations: topRecommendations.map(r => ({
                            id: r.qa.id,
                            question: r.qa.question,
                            answer: r.qa.answer,
                            category: r.qa.category,
                            score: r.score,
                        })),
                    },
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: 'text',
                            text: `Failed to recommend solutions: ${error instanceof Error ? error.message : String(error)}`,
                        }],
                };
            }
        });
        this.server.registerTool('suggest_manuals', {
            description: 'Suggest relevant manuals based on device model, keywords, or problem description. Helps users find the right documentation.',
            inputSchema: {
                query: z.string().describe('Device model, keywords, or problem description'),
                maxResults: z.number().optional().describe('Maximum number of manuals to suggest (default: 3)'),
            },
        }, async (args) => {
            try {
                const maxResults = args.maxResults || 3;
                // 列出所有手冊並過濾
                const allManuals = await this.manualProvider.listManuals();
                if (allManuals.length === 0) {
                    return {
                        content: [{
                                type: 'text',
                                text: 'No manuals available.',
                            }],
                    };
                }
                // 簡單的關鍵字匹配過濾
                const query = args.query.toLowerCase();
                const matchedManuals = allManuals.filter(m => m.originalName.toLowerCase().includes(query) ||
                    m.id.toLowerCase().includes(query));
                if (matchedManuals.length === 0) {
                    return {
                        content: [{
                                type: 'text',
                                text: `No manuals found matching "${args.query}". Try different keywords or check available manuals with list_manuals.`,
                            }],
                    };
                }
                const suggestions = matchedManuals.slice(0, maxResults);
                const text = `Suggested ${suggestions.length} manual(s) for "${args.query}":\n\n` +
                    suggestions.map((m, idx) => `${idx + 1}. ${m.originalName}\n` +
                        `   File ID: ${m.id}\n` +
                        `   Type: ${m.contentType}\n` +
                        `   Size: ${(m.size / 1024).toFixed(1)} KB\n` +
                        `   ${m.indexed ? '✓ Vector search available' : '⚠ Vector index not built yet'}\n`).join('\n');
                return {
                    content: [{ type: 'text', text }],
                    structuredContent: {
                        suggestions: suggestions.map(m => ({
                            id: m.id,
                            name: m.originalName,
                            contentType: m.contentType,
                            size: m.size,
                            indexed: m.indexed || false,
                        })),
                    },
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: 'text',
                            text: `Failed to suggest manuals: ${error instanceof Error ? error.message : String(error)}`,
                        }],
                };
            }
        });
        this.server.registerTool('find_similar_cases', {
            description: 'Find similar historical cases based on problem description. Learn from past solutions to similar issues.',
            inputSchema: {
                description: z.string().describe('Description of the current problem or case'),
                deviceModel: z.string().optional().describe('Filter by device model'),
                k: z.number().optional().describe('Number of similar cases to return (default: 5)'),
                statusFilter: z.enum(['open', 'in_progress', 'resolved', 'closed', 'all']).optional().describe('Filter by case status (default: resolved)'),
            },
        }, async (args) => {
            try {
                const k = args.k || 5;
                const statusFilter = args.statusFilter || 'resolved';
                // 搜尋案例
                const searchParams = {
                    limit: 100, // 取更多案例來計算相似度
                };
                if (args.deviceModel) {
                    searchParams.deviceModel = args.deviceModel;
                }
                if (statusFilter !== 'all') {
                    searchParams.status = statusFilter;
                }
                const cases = await caseService.searchCases(searchParams);
                if (cases.length === 0) {
                    return {
                        content: [{
                                type: 'text',
                                text: `No ${statusFilter !== 'all' ? statusFilter + ' ' : ''}cases found${args.deviceModel ? ` for device ${args.deviceModel}` : ''}.`,
                            }],
                    };
                }
                // 使用 OpenAI Embeddings 計算相似度
                const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                const queryEmbedding = await openai.embeddings.create({
                    model: 'text-embedding-3-small',
                    input: args.description,
                });
                const similarities = [];
                for (const c of cases) {
                    const caseText = `${c.subject}\n${c.description}${c.resolution ? '\n' + c.resolution : ''}`;
                    const caseEmbedding = await openai.embeddings.create({
                        model: 'text-embedding-3-small',
                        input: caseText,
                    });
                    const score = this.cosineSimilarity(queryEmbedding.data[0].embedding, caseEmbedding.data[0].embedding);
                    similarities.push({ case: c, score });
                }
                // 排序並取前 k 個
                similarities.sort((a, b) => b.score - a.score);
                const topCases = similarities.slice(0, k);
                const text = `Found ${topCases.length} similar case(s):\n\n` +
                    topCases.map((item, idx) => {
                        const c = item.case;
                        const resTime = c.resolutionTime ? ` (resolved in ${(c.resolutionTime / (1000 * 60 * 60)).toFixed(1)}h)` : '';
                        return `${idx + 1}. [Similarity: ${item.score.toFixed(3)}] ${c.subject}\n` +
                            `   Case ID: ${c.id}\n` +
                            `   Device: ${c.deviceModel || 'N/A'}\n` +
                            `   Status: ${c.status}${resTime}\n` +
                            `   Description: ${c.description.substring(0, 150)}${c.description.length > 150 ? '...' : ''}\n` +
                            (c.resolution ? `   Resolution: ${c.resolution.substring(0, 150)}${c.resolution.length > 150 ? '...' : ''}\n` : '');
                    }).join('\n');
                return {
                    content: [{ type: 'text', text }],
                    structuredContent: {
                        similarCases: topCases.map(item => ({
                            id: item.case.id,
                            subject: item.case.subject,
                            description: item.case.description,
                            deviceModel: item.case.deviceModel,
                            status: item.case.status,
                            resolution: item.case.resolution,
                            resolutionTime: item.case.resolutionTime,
                            score: item.score,
                        })),
                    },
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: 'text',
                            text: `Failed to find similar cases: ${error instanceof Error ? error.message : String(error)}`,
                        }],
                };
            }
        });
        // ============================================================
        // Phase 6: 統計分析工具
        // ============================================================
        this.server.registerTool('get_qa_statistics', {
            description: 'Get statistics about Q&A knowledge base - most viewed, by category, recent updates, etc.',
        }, async () => {
            try {
                const allQA = await this.qaProvider.listQA({});
                if (allQA.length === 0) {
                    return {
                        content: [{
                                type: 'text',
                                text: 'No Q&A entries available.',
                            }],
                    };
                }
                // 統計分類
                const byCategory = {};
                for (const qa of allQA) {
                    byCategory[qa.category] = (byCategory[qa.category] || 0) + 1;
                }
                // 最近更新 (過去 7 天)
                const sevenDaysAgo = new Date();
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
                const recentlyUpdated = allQA.filter(qa => {
                    const updated = new Date(qa.updatedAt);
                    return updated >= sevenDaysAgo;
                });
                const text = `Q&A Knowledge Base Statistics:\n\n` +
                    `Total Q&A entries: ${allQA.length}\n\n` +
                    `By Category:\n${Object.entries(byCategory)
                        .sort((a, b) => b[1] - a[1])
                        .map(([cat, count]) => `- ${cat}: ${count} entries`)
                        .join('\n')}\n\n` +
                    `Recently Updated (last 7 days): ${recentlyUpdated.length} entries`;
                return {
                    content: [{ type: 'text', text }],
                    structuredContent: {
                        total: allQA.length,
                        byCategory,
                        recentlyUpdated: recentlyUpdated.length,
                        categories: Object.keys(byCategory).length,
                    },
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: 'text',
                            text: `Failed to get Q&A statistics: ${error instanceof Error ? error.message : String(error)}`,
                        }],
                };
            }
        });
        this.server.registerTool('get_common_issues', {
            description: 'Get the most common issues based on case frequency, trend analysis, and device distribution. Helps identify recurring problems.',
            inputSchema: {
                period: z.enum(['week', 'month', 'quarter', 'all']).optional().describe('Time period for analysis (default: month)'),
                topN: z.number().optional().describe('Number of top issues to return (default: 10)'),
            },
        }, async (args) => {
            try {
                const period = args.period || 'month';
                const topN = args.topN || 10;
                // 計算時間範圍
                let dateFrom;
                if (period !== 'all') {
                    dateFrom = new Date();
                    switch (period) {
                        case 'week':
                            dateFrom.setDate(dateFrom.getDate() - 7);
                            break;
                        case 'month':
                            dateFrom.setMonth(dateFrom.getMonth() - 1);
                            break;
                        case 'quarter':
                            dateFrom.setMonth(dateFrom.getMonth() - 3);
                            break;
                    }
                }
                // 搜尋案例
                const cases = await caseService.searchCases({
                    limit: 1000,
                });
                // 過濾時間範圍
                const filteredCases = dateFrom
                    ? cases.filter(c => new Date(c.createdAt) >= dateFrom)
                    : cases;
                if (filteredCases.length === 0) {
                    return {
                        content: [{
                                type: 'text',
                                text: `No cases found in the specified period (${period}).`,
                            }],
                    };
                }
                // 統計問題類別
                const issueCounts = {};
                const deviceCounts = {};
                for (const c of filteredCases) {
                    // 統計問題類別
                    if (c.issueCategory) {
                        issueCounts[c.issueCategory] = (issueCounts[c.issueCategory] || 0) + 1;
                    }
                    // 統計設備型號
                    if (c.deviceModel) {
                        deviceCounts[c.deviceModel] = (deviceCounts[c.deviceModel] || 0) + 1;
                    }
                }
                // 排序取前 N
                const topIssues = Object.entries(issueCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, topN);
                const topDevices = Object.entries(deviceCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5);
                const text = `Common Issues Analysis (${period}):\n\n` +
                    `Total cases in period: ${filteredCases.length}\n\n` +
                    `Top ${topIssues.length} Issue Categories:\n` +
                    topIssues.map(([issue, count], idx) => `${idx + 1}. ${issue}: ${count} cases (${(count / filteredCases.length * 100).toFixed(1)}%)`).join('\n') +
                    `\n\nTop Device Models:\n` +
                    topDevices.map(([device, count], idx) => `${idx + 1}. ${device}: ${count} cases`).join('\n');
                return {
                    content: [{ type: 'text', text }],
                    structuredContent: {
                        period,
                        totalCases: filteredCases.length,
                        topIssues: topIssues.map(([issue, count]) => ({
                            category: issue,
                            count,
                            percentage: (count / filteredCases.length * 100).toFixed(1),
                        })),
                        topDevices: topDevices.map(([device, count]) => ({
                            model: device,
                            count,
                        })),
                    },
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: 'text',
                            text: `Failed to get common issues: ${error instanceof Error ? error.message : String(error)}`,
                        }],
                };
            }
        });
        this.server.registerTool('analyze_resolution_trends', {
            description: 'Analyze case resolution time trends and efficiency metrics. Helps identify bottlenecks and improvement opportunities.',
            inputSchema: {
                period: z.enum(['week', 'month', 'quarter', 'all']).optional().describe('Time period for analysis (default: month)'),
            },
        }, async (args) => {
            try {
                const period = args.period || 'month';
                // 計算時間範圍
                let dateFrom;
                if (period !== 'all') {
                    dateFrom = new Date();
                    switch (period) {
                        case 'week':
                            dateFrom.setDate(dateFrom.getDate() - 7);
                            break;
                        case 'month':
                            dateFrom.setMonth(dateFrom.getMonth() - 1);
                            break;
                        case 'quarter':
                            dateFrom.setMonth(dateFrom.getMonth() - 3);
                            break;
                    }
                }
                const cases = await caseService.searchCases({
                    status: 'closed',
                    limit: 1000,
                });
                const filteredCases = dateFrom
                    ? cases.filter(c => new Date(c.closedAt) >= dateFrom)
                    : cases;
                if (filteredCases.length === 0) {
                    return {
                        content: [{
                                type: 'text',
                                text: `No closed cases found in the specified period (${period}).`,
                            }],
                    };
                }
                // 計算解決時間統計
                const resolutionTimes = filteredCases
                    .filter(c => c.resolutionTime)
                    .map(c => c.resolutionTime);
                if (resolutionTimes.length === 0) {
                    return {
                        content: [{
                                type: 'text',
                                text: 'No resolution time data available.',
                            }],
                    };
                }
                const avgTime = resolutionTimes.reduce((sum, t) => sum + t, 0) / resolutionTimes.length;
                const minTime = Math.min(...resolutionTimes);
                const maxTime = Math.max(...resolutionTimes);
                // 按優先級分組統計
                const byPriority = {};
                for (const c of filteredCases.filter(c => c.resolutionTime)) {
                    if (!byPriority[c.priority]) {
                        byPriority[c.priority] = { count: 0, avgTime: 0 };
                    }
                    byPriority[c.priority].count++;
                    byPriority[c.priority].avgTime += c.resolutionTime;
                }
                // 計算平均值
                for (const priority in byPriority) {
                    byPriority[priority].avgTime /= byPriority[priority].count;
                }
                const toHours = (ms) => (ms / (1000 * 60 * 60)).toFixed(1);
                const text = `Resolution Trends Analysis (${period}):\n\n` +
                    `Closed cases: ${filteredCases.length}\n` +
                    `Cases with resolution time: ${resolutionTimes.length}\n\n` +
                    `Resolution Time Statistics:\n` +
                    `- Average: ${toHours(avgTime)} hours\n` +
                    `- Fastest: ${toHours(minTime)} hours\n` +
                    `- Slowest: ${toHours(maxTime)} hours\n\n` +
                    `By Priority:\n` +
                    Object.entries(byPriority)
                        .sort((a, b) => a[1].avgTime - b[1].avgTime)
                        .map(([priority, stats]) => `- ${priority}: ${toHours(stats.avgTime)}h avg (${stats.count} cases)`).join('\n');
                return {
                    content: [{ type: 'text', text }],
                    structuredContent: {
                        period,
                        closedCases: filteredCases.length,
                        avgResolutionHours: parseFloat(toHours(avgTime)),
                        minResolutionHours: parseFloat(toHours(minTime)),
                        maxResolutionHours: parseFloat(toHours(maxTime)),
                        byPriority: Object.entries(byPriority).map(([priority, stats]) => ({
                            priority,
                            avgHours: parseFloat(toHours(stats.avgTime)),
                            count: stats.count,
                        })),
                    },
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: 'text',
                            text: `Failed to analyze resolution trends: ${error instanceof Error ? error.message : String(error)}`,
                        }],
                };
            }
        });
        // ============================================================
        // Thinking Tools (參考 Serena)
        // ============================================================
        this.server.registerTool('start_thinking', {
            description: `Begin a structured thinking process for complex queries.
Use this when you need to analyze multiple sources, compare products, or solve complex problems.
This helps you organize your thoughts and ensure thorough analysis.`,
            inputSchema: {
                topic: z.string().describe('What you are thinking about (e.g., "Compare L396 vs L600")'),
                context: z.string().optional().describe('Additional context or user requirements'),
            },
            outputSchema: {
                thinkingId: z.string(),
                topic: z.string(),
                startedAt: z.string(),
            },
        }, async (args) => {
            const session = thinkingStore.createSession(args.topic, args.context);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Started thinking about: ${args.topic}\n\nNow you can:\n1. Use continue_thinking to record observations and analysis\n2. Call various search tools to gather information\n3. Use finish_thinking when you have a conclusion`,
                    },
                ],
                structuredContent: {
                    thinkingId: session.id,
                    topic: session.topic,
                    startedAt: session.startedAt.toISOString(),
                },
            };
        });
        this.server.registerTool('continue_thinking', {
            description: `Add thoughts during the thinking process.
Call this after each piece of information you gather or analysis you make.
This ensures structured reasoning and prevents jumping to conclusions.`,
            inputSchema: {
                thinkingId: z.string().describe('The thinking session ID from start_thinking'),
                thought: z.string().describe('Your current thought, observation, or analysis'),
                type: z.enum(['observation', 'analysis', 'comparison', 'question', 'conclusion']).optional()
                    .describe('Type of thought (default: observation)'),
                metadata: z.record(z.any()).optional().describe('Optional metadata (e.g., source fileId, scores)'),
            },
        }, async (args) => {
            const entry = thinkingStore.addThought(args.thinkingId, args.thought, args.type, args.metadata);
            const session = thinkingStore.getSession(args.thinkingId);
            const thoughtCount = session?.thoughts.length || 0;
            return {
                content: [
                    {
                        type: 'text',
                        text: `Thought recorded (${thoughtCount} total):\n[${args.type || 'observation'}] ${args.thought}`,
                    },
                ],
            };
        });
        this.server.registerTool('finish_thinking', {
            description: `Complete the thinking process and provide your conclusion.
Always call this after you have gathered enough information and analyzed it.
This ensures you provide a well-reasoned answer.`,
            inputSchema: {
                thinkingId: z.string().describe('The thinking session ID'),
                conclusion: z.string().describe('Your final conclusion or answer'),
            },
            outputSchema: {
                summary: z.object({
                    topic: z.string(),
                    thoughtCount: z.number(),
                    duration: z.string(),
                    conclusion: z.string(),
                }),
            },
        }, async (args) => {
            const session = thinkingStore.completeSession(args.thinkingId, args.conclusion);
            const duration = session.completedAt && session.startedAt
                ? ((session.completedAt.getTime() - session.startedAt.getTime()) / 1000).toFixed(2)
                : '0';
            const summary = {
                topic: session.topic,
                thoughtCount: session.thoughts.length,
                duration: `${duration}s`,
                conclusion: args.conclusion,
                thoughts: session.thoughts.map(t => `[${t.type}] ${t.thought}`).join('\n'),
            };
            return {
                content: [
                    {
                        type: 'text',
                        text: `Thinking completed!\n\nTopic: ${summary.topic}\nThoughts: ${summary.thoughtCount}\nDuration: ${summary.duration}\n\nConclusion:\n${summary.conclusion}`,
                    },
                ],
                structuredContent: { summary },
            };
        });
        this.server.registerTool('think_about_collected_information', {
            description: `Reflect on whether you have collected enough relevant information.
ALWAYS call this after searching multiple sources or gathering data.
This prevents incomplete analysis and ensures you have what you need.`,
            inputSchema: {
                thinkingId: z.string().optional().describe('Optional thinking session ID to associate'),
            },
        }, async (args) => {
            const prompt = `Take a moment to reflect:

1. **Information Completeness**
   - Have you searched all relevant manuals?
   - Did you check both product specs and Q&A entries?
   - Are there any gaps in the information?

2. **Relevance Check**
   - Is the information you found relevant to the user's question?
   - Do you have specific data (numbers, features, etc.) or just general info?
   - Can you answer with confidence?

3. **Next Steps**
   - If information is sufficient → proceed to formulate answer
   - If information is incomplete → search more sources
   - If information is unclear → ask clarifying questions

What's your assessment?`;
            if (args.thinkingId) {
                thinkingStore.addThought(args.thinkingId, 'Reflecting on collected information', 'analysis');
            }
            return {
                content: [{ type: 'text', text: prompt }],
            };
        });
        this.server.registerTool('think_about_task_adherence', {
            description: `Check if you're still on track with the user's original question.
Call this before providing your final answer, especially in long conversations.
Prevents scope creep and ensures you answer what was actually asked.`,
            inputSchema: {
                thinkingId: z.string().optional(),
                originalQuestion: z.string().optional().describe('The user\'s original question'),
            },
        }, async (args) => {
            const prompt = `Verify you're answering the right question:

1. **Original Request**
   ${args.originalQuestion ? `User asked: "${args.originalQuestion}"` : 'Review the user\'s original question'}

2. **Current Focus**
   - Are you still addressing this question?
   - Have you drifted into related but irrelevant topics?
   - Is your answer directly useful to the user?

3. **Scope Check**
   - Are you providing too much information?
   - Are you missing the key point?
   - Is your answer actionable?

Adjust your approach if needed before finalizing your answer.`;
            if (args.thinkingId) {
                thinkingStore.addThought(args.thinkingId, 'Checking task adherence', 'analysis');
            }
            return {
                content: [{ type: 'text', text: prompt }],
            };
        });
        this.server.registerTool('think_about_answer_quality', {
            description: `Evaluate if your answer is complete and high-quality before responding.
Always call this before giving your final answer to the user.
Ensures you provide accurate, helpful, and well-structured responses.`,
            inputSchema: {
                thinkingId: z.string().optional(),
            },
        }, async (args) => {
            const prompt = `Before answering, verify quality:

1. **Accuracy**
   - Is your answer based on actual search results?
   - Did you cite specific sources (manual names, Q&A entries)?
   - Are numbers and specs exact (not estimated)?

2. **Completeness**
   - Did you answer all parts of the user's question?
   - Are there important caveats or limitations?
   - Should you mention related information?

3. **Clarity**
   - Is your answer easy to understand?
   - Did you use specific examples?
   - Is the format user-friendly?

4. **Citations**
   - Did you mention which manual/Q&A the info came from?
   - Can the user verify your answer?
   - Are page numbers or sections included?

If any aspect is lacking, improve before responding.`;
            if (args.thinkingId) {
                thinkingStore.addThought(args.thinkingId, 'Evaluating answer quality', 'analysis');
            }
            return {
                content: [{ type: 'text', text: prompt }],
            };
        });
    }
    registerResources() {
        // Register resource template for manuals
        const manualsTemplate = new ResourceTemplate('waferlock://manuals/{id}', {
            list: async () => {
                const manuals = await this.manualProvider.listManuals();
                return {
                    resources: [
                        {
                            uri: 'waferlock://manuals/all',
                            name: 'All Manuals',
                            description: 'Complete list of all uploaded manuals',
                            mimeType: 'application/json',
                        },
                        ...manuals.map(m => ({
                            uri: `waferlock://manuals/${m.id}`,
                            name: m.originalName,
                            description: `${m.size} bytes, ${m.contentType}`,
                            mimeType: 'application/json',
                        })),
                    ],
                };
            },
        });
        this.server.registerResource('manuals', manualsTemplate, {
            description: 'Access Waferlock product manuals',
            mimeType: 'application/json',
        }, async (uri, variables) => {
            const fileId = variables.id;
            // Special case: all manuals
            if (fileId === 'all') {
                const manuals = await this.manualProvider.listManuals();
                return {
                    contents: [{
                            uri: uri.toString(),
                            mimeType: 'application/json',
                            text: formatManuals(manuals),
                        }],
                };
            }
            // Single manual
            const manual = await this.manualProvider.getManualById(fileId);
            if (!manual) {
                throw new Error(`Manual ${fileId} not found`);
            }
            return {
                contents: [{
                        uri: uri.toString(),
                        mimeType: 'application/json',
                        text: formatManual(manual),
                    }],
            };
        });
        // Register resource template for Q&A
        const qaTemplate = new ResourceTemplate('waferlock://qa/{categoryOrId}', {
            list: async () => {
                const entries = await this.qaProvider.listQA({});
                const categories = new Set(entries.map(e => e.category));
                return {
                    resources: [
                        {
                            uri: 'waferlock://qa/all',
                            name: 'All Q&A',
                            description: `${entries.length} Q&A entries`,
                            mimeType: 'application/json',
                        },
                        ...Array.from(categories).map(cat => ({
                            uri: `waferlock://qa/${encodeURIComponent(cat)}`,
                            name: `Category: ${cat}`,
                            description: `Q&A entries in ${cat} category`,
                            mimeType: 'application/json',
                        })),
                    ],
                };
            },
        });
        this.server.registerResource('qa', qaTemplate, {
            description: 'Access Q&A knowledge base',
            mimeType: 'application/json',
        }, async (uri, variables) => {
            const categoryOrId = decodeURIComponent(variables.categoryOrId);
            // Special case: all Q&A
            if (categoryOrId === 'all') {
                const entries = await this.qaProvider.listQA({});
                return {
                    contents: [{
                            uri: uri.toString(),
                            mimeType: 'application/json',
                            text: formatQAList(entries),
                        }],
                };
            }
            // Try as ID first
            try {
                const entry = await this.qaProvider.getQAById(categoryOrId);
                if (entry) {
                    return {
                        contents: [{
                                uri: uri.toString(),
                                mimeType: 'application/json',
                                text: formatQA(entry),
                            }],
                    };
                }
            }
            catch (err) {
                // Not an ID, continue to category search
            }
            // Try as category
            const entries = await this.qaProvider.listQA({ category: categoryOrId });
            if (entries.length === 0) {
                throw new Error(`No Q&A found for category: ${categoryOrId}`);
            }
            return {
                contents: [{
                        uri: uri.toString(),
                        mimeType: 'application/json',
                        text: formatQAList(entries),
                    }],
            };
        });
    }
    registerPrompts() {
        // Troubleshooting device issues
        this.server.registerPrompt('troubleshoot_device', {
            description: 'Guide user through systematic device troubleshooting',
            argsSchema: {
                device_model: z.string().describe('Device model number (e.g., WL-100, WL-200)'),
                error_code: z.string().optional().describe('Error code or symptom description'),
                customer_description: z.string().optional().describe('Customer description of the problem'),
            },
        }, async (args) => {
            const model = args.device_model;
            const errorCode = args.error_code || 'N/A';
            const description = args.customer_description || 'Not provided';
            const prompt = `You are a technical support specialist for Waferlock devices.

**Current Issue:**
- Device Model: ${model}
- Error Code: ${errorCode}
- Customer Description: ${description}

**Your Task:**
1. Search the manual database for ${model} specific troubleshooting steps
2. Check Q&A knowledge base for similar issues
3. Follow this systematic approach:

**Step 1: Information Gathering**
- Verify device model and firmware version
- Confirm symptoms and error messages
- Check when the issue started
- Ask about recent changes (updates, configuration)

**Step 2: Basic Diagnostics**
- Power cycle test
- Connection verification (network, cables)
- LED status check
- Physical inspection

**Step 3: Advanced Troubleshooting**
- Review manual for error code: ${errorCode}
- Check relevant Q&A entries
- Test specific components based on symptoms
- Review logs if available

**Step 4: Resolution**
- Provide step-by-step solution
- Include preventive measures
- Document case for future reference

**Remember:**
- Cite specific manual sections and Q&A entries
- Use clear, non-technical language for customers
- Escalate to engineering if hardware failure suspected
- Always verify solution before closing case

Please begin the troubleshooting process.`;
            return {
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: prompt,
                        },
                    },
                ],
            };
        });
        // Installation guide assistant
        this.server.registerPrompt('installation_guide', {
            description: 'Provide step-by-step installation guidance',
            argsSchema: {
                device_model: z.string().describe('Device model to install'),
                installation_type: z.string().optional().describe('Installation type: new_installation, replacement, upgrade'),
                environment: z.string().optional().describe('Installation environment details'),
            },
        }, async (args) => {
            const model = args.device_model;
            const type = args.installation_type || 'new_installation';
            const env = args.environment || 'Standard environment';
            const prompt = `You are an installation specialist for Waferlock ${model}.

**Installation Details:**
- Model: ${model}
- Type: ${type}
- Environment: ${env}

**Your Task:**
Provide complete installation guidance following this structure:

**1. Pre-Installation Checklist**
- Required tools and materials
- Environmental requirements (power, network, space)
- Safety precautions
- Compatibility verification

**2. Unboxing and Inspection**
- Package contents verification
- Physical damage inspection
- Serial number recording

**3. Hardware Installation**
- Mounting/placement instructions
- Cable connections (with diagrams if available)
- Power supply setup
- Antenna/sensor placement (if applicable)

**4. Initial Configuration**
- Power-on sequence
- Network setup
- Basic configuration wizard
- Account/authentication setup

**5. Testing and Verification**
- Connectivity tests
- Functional tests
- Status indicator verification
- Performance baseline

**6. Common Installation Issues**
- Troubleshooting connection problems
- Configuration errors
- Compatibility issues

**Resources:**
- Search for ${model} installation manual
- Check Q&A for common installation questions
- Provide relevant manual page numbers

Begin with the pre-installation checklist.`;
            return {
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: prompt,
                        },
                    },
                ],
            };
        });
        // Maintenance checklist generator
        this.server.registerPrompt('maintenance_checklist', {
            description: 'Generate periodic maintenance checklist',
            argsSchema: {
                device_model: z.string().describe('Device model for maintenance'),
                maintenance_type: z.string().describe('Maintenance type: daily, weekly, monthly, quarterly, annual'),
                operating_hours: z.string().optional().describe('Device operating hours or usage level'),
            },
        }, async (args) => {
            const model = args.device_model;
            const type = args.maintenance_type;
            const hours = args.operating_hours || 'Normal usage';
            const prompt = `Generate a ${type} maintenance checklist for Waferlock ${model}.

**Device Information:**
- Model: ${model}
- Maintenance Cycle: ${type}
- Operating Hours: ${hours}

**Checklist Structure:**

**Visual Inspection**
□ Physical condition check (casing, connectors)
□ LED status indicators
□ Mounting/installation stability
□ Cable condition and connections

**Functional Tests**
□ Power supply verification
□ Network connectivity
□ Sensor/detector operation (if applicable)
□ Response time check

**Cleaning and Maintenance**
□ Exterior cleaning
□ Ventilation/cooling system check
□ Connector cleaning
□ Firmware version verification

**Data and Logs**
□ Error log review
□ Performance metrics check
□ Configuration backup
□ Event history review

**Preventive Actions**
□ Loose connection tightening
□ Firmware updates (if available)
□ Configuration optimization
□ Wear parts replacement schedule

**Documentation**
□ Record maintenance date and findings
□ Update maintenance log
□ Note any abnormalities
□ Schedule next maintenance

**Instructions:**
1. Search ${model} maintenance manual for model-specific requirements
2. Check Q&A for common maintenance issues
3. Customize checklist based on manual recommendations
4. Include safety warnings and precautions
5. Add estimated time for each section

Present the checklist in an easy-to-follow format.`;
            return {
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: prompt,
                        },
                    },
                ],
            };
        });
        // Common issues quick answer
        this.server.registerPrompt('common_issues', {
            description: 'Quick answers for frequently asked questions',
            argsSchema: {
                device_model: z.string().optional().describe('Device model (optional, for model-specific issues)'),
                issue_category: z.string().optional().describe('Issue category: connection, power, configuration, performance, error_codes'),
            },
        }, async (args) => {
            const model = args.device_model || 'All models';
            const category = args.issue_category || 'all categories';
            const prompt = `Provide quick answers for common ${category} issues on ${model}.

**Your Task:**
1. Search Q&A knowledge base for ${category} issues
2. Prioritize by frequency (most common first)
3. Format each issue as:
   - **Issue**: Brief description
   - **Quick Fix**: Immediate action (< 2 minutes)
   - **If not resolved**: Next steps
   - **Reference**: Manual section or Q&A ID

**Categories to cover:**
${category === 'all categories' ? `
- Connection issues (network, Bluetooth, WiFi)
- Power problems (won't turn on, unexpected shutdown)
- Configuration errors (settings, pairing)
- Performance issues (slow response, errors)
- Error codes (with explanations)
` : `Focus on ${category} issues`}

**Format Guidelines:**
- Use bullet points for clarity
- Include estimated resolution time
- Add prevention tips
- Cite specific Q&A entries
- Mention when to escalate

**Example:**
**Issue**: Device won't connect to network
**Quick Fix**: 
1. Verify network cable is plugged in
2. Check router/switch lights
3. Power cycle device
**If not resolved**: Check firewall settings, verify DHCP
**Reference**: Q&A #123, Manual Section 4.2

Generate the common issues list now.`;
            return {
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: prompt,
                        },
                    },
                ],
            };
        });
        // Warranty check assistant
        this.server.registerPrompt('warranty_check', {
            description: 'Guide warranty status verification and claim process',
            argsSchema: {
                serial_number: z.string().optional().describe('Device serial number'),
                purchase_date: z.string().optional().describe('Purchase date (YYYY-MM-DD)'),
                issue_type: z.string().optional().describe('Type of issue: hardware_failure, software_bug, physical_damage, other'),
            },
        }, async (args) => {
            const serial = args.serial_number || 'Not provided';
            const purchaseDate = args.purchase_date || 'Not provided';
            const issueType = args.issue_type || 'Not specified';
            const prompt = `Guide customer through warranty verification and claim process.

**Customer Information:**
- Serial Number: ${serial}
- Purchase Date: ${purchaseDate}
- Issue Type: ${issueType}

**Warranty Check Process:**

**Step 1: Information Collection**
□ Verify serial number format
□ Confirm purchase date (receipt, invoice)
□ Identify issue category
□ Check for physical damage

**Step 2: Warranty Coverage Verification**
Search warranty terms in documentation for:
- Standard warranty period (typically 1-2 years)
- Extended warranty (if purchased)
- Coverage exceptions and exclusions
- Regional variations

**Step 3: Eligibility Assessment**
Based on issue type, verify:

**Hardware Failure**: 
- ✓ Manufacturing defects: Covered
- ✓ Component failure: Covered
- ✗ Physical damage: Not covered
- ✗ Liquid damage: Not covered

**Software Issues**:
- ✓ Factory software bugs: Covered
- ✓ Firmware issues: Covered
- ✗ User configuration errors: Not covered

**Step 4: Claim Documentation**
Required documents:
□ Proof of purchase (receipt/invoice)
□ Serial number photo
□ Issue description and photos
□ Error codes/logs (if available)
□ Troubleshooting steps already attempted

**Step 5: Claim Process**
1. Submit claim form (link to support portal)
2. Await approval (typical: 2-3 business days)
3. If approved:
   - Repair: Send device to service center
   - Replace: Receive replacement device
   - Refund: Process initiated
4. Track claim status

**Special Cases:**
- Out of warranty: Paid repair options
- Extended warranty: Different terms apply
- DOA (Dead on Arrival): Immediate replacement

**Next Steps:**
Based on the information provided, determine warranty status and guide customer through appropriate process.

**Important:**
- Search Q&A for warranty-related questions
- Cite specific warranty terms from manual
- Be clear about what is/isn't covered
- Provide realistic timelines
- Escalate complex cases to warranty team

Proceed with the warranty check.`;
            return {
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: prompt,
                        },
                    },
                ],
            };
        });
    }
    async start(transport = new StdioServerTransport()) {
        await this.server.connect(transport);
        console.error('Waferlock Robot MCP server running on stdio');
        const keepAlive = setInterval(() => {
            // Periodic no-op keeps the event loop alive until the client disconnects
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
    /**
     * Calculate cosine similarity between two embedding vectors
     */
    cosineSimilarity(a, b) {
        if (a.length !== b.length) {
            throw new Error('Vectors must have the same length');
        }
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        normA = Math.sqrt(normA);
        normB = Math.sqrt(normB);
        if (normA === 0 || normB === 0) {
            return 0;
        }
        return dotProduct / (normA * normB);
    }
    getServer() {
        return this.server;
    }
}
export const mcpService = new MCPService();
export function createMcpService(options) {
    return new MCPService(options);
}
