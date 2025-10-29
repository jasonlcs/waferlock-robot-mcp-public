"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCPService = void 0;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const zod_1 = require("zod");
const manualApiProvider_js_1 = require("./manualApiProvider.js");
const qaApiProvider_js_1 = require("./qaApiProvider.js");
const thinkingStore_js_1 = require("./thinkingStore.js");
function isHeadersLike(value) {
    return typeof value === 'object' && value !== null && typeof value.forEach === 'function';
}
function serialiseThinkingEntry(entry) {
    return {
        ...entry,
        timestamp: entry.timestamp.toISOString(),
    };
}
function serialiseThinkingSession(session) {
    return {
        ...session,
        startedAt: session.startedAt.toISOString(),
        completedAt: session.completedAt ? session.completedAt.toISOString() : null,
        thoughts: session.thoughts.map(serialiseThinkingEntry),
    };
}
function serialiseManual(manual) {
    return {
        ...manual,
        uploadedAt: manual.uploadedAt instanceof Date ? manual.uploadedAt.toISOString() : manual.uploadedAt,
        indexStartedAt: manual.indexStartedAt || null,
        indexCompletedAt: manual.indexCompletedAt || null,
    };
}
function formatManual(manual) {
    return JSON.stringify(serialiseManual(manual), null, 2);
}
function formatManualList(manuals) {
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
function normalizeApiBase(url) {
    return url.replace(/\/+$/, '');
}
class MCPService {
    constructor(options = {}) {
        this.apiUrl = null;
        this.apiToken = null;
        this.serverName = options.name || 'waferlock-robot-mcp';
        this.serverVersion = options.version || '2.1.0';
        const resolvedApiUrl = options.apiUrl ?? process.env.API_URL ?? '';
        const resolvedApiToken = options.apiToken ?? process.env.API_TOKEN ?? '';
        if (!(options.manualProvider && options.qaProvider)) {
            if (!resolvedApiUrl || !resolvedApiToken) {
                throw new Error('API_URL and API_TOKEN are required');
            }
        }
        if (resolvedApiUrl && resolvedApiUrl.length > 0) {
            this.apiUrl = normalizeApiBase(resolvedApiUrl);
        }
        if (resolvedApiToken && resolvedApiToken.length > 0) {
            this.apiToken = resolvedApiToken;
        }
        if (options.manualProvider && options.qaProvider) {
            this.manualProvider = options.manualProvider;
            this.qaProvider = options.qaProvider;
        }
        else {
            if (!this.apiUrl || !this.apiToken) {
                throw new Error('API_URL and API_TOKEN are required');
            }
            this.manualProvider = (0, manualApiProvider_js_1.createManualApiProvider)(this.apiUrl, this.apiToken);
            this.qaProvider = (0, qaApiProvider_js_1.createQAApiProvider)(this.apiUrl, this.apiToken);
        }
        this.server = new mcp_js_1.McpServer({
            name: this.serverName,
            version: this.serverVersion,
        });
        this.registerTools();
    }
    buildApiUrl(path) {
        if (!this.apiUrl) {
            throw new Error('API_URL is not configured');
        }
        return `${this.apiUrl}/${path.replace(/^\//, '')}`;
    }
    mergeHeaders(extra) {
        if (!this.apiToken) {
            throw new Error('API_TOKEN is not configured');
        }
        const base = {
            Accept: 'application/json',
            Authorization: `Bearer ${this.apiToken}`,
        };
        if (!extra) {
            return base;
        }
        if (Array.isArray(extra)) {
            for (const [key, value] of extra) {
                if (typeof key === 'string' && typeof value === 'string') {
                    base[key] = value;
                }
            }
            return base;
        }
        if (isHeadersLike(extra)) {
            extra.forEach((value, key) => {
                base[key] = value;
            });
            return base;
        }
        return {
            ...base,
            ...extra,
        };
    }
    async requestJson(path, init = {}) {
        const response = await fetch(this.buildApiUrl(path), {
            ...init,
            headers: this.mergeHeaders(init.headers),
        });
        const text = await response.text();
        let parsed = null;
        if (text) {
            try {
                parsed = JSON.parse(text);
            }
            catch {
                parsed = text;
            }
        }
        if (!response.ok) {
            const message = parsed && typeof parsed === 'object' && parsed.error
                ? parsed.error
                : `${response.status} ${response.statusText}`;
            throw new Error(`API request failed: ${message}`);
        }
        return parsed;
    }
    registerTools() {
        // Manual Management Tools (3) - 只提供基本資訊，禁止下載
        this.server.registerTool('list_manuals', {
            description: 'List all available manuals with basic metadata (no download)',
            inputSchema: {}
        }, async () => {
            const manuals = await this.manualProvider.listManuals();
            const serialised = manuals.map(serialiseManual);
            return {
                content: [
                    {
                        type: 'text',
                        text: serialised.length > 0
                            ? `Found ${serialised.length} manuals:\n\n${formatManualList(manuals)}`
                            : 'No manuals found.',
                    },
                ],
                structuredContent: {
                    manuals: serialised,
                },
            };
        });
        this.server.registerTool('get_manual_info', {
            description: 'Get basic information about a specific manual (metadata only, no content/download)',
            inputSchema: { manualId: zod_1.z.string() },
        }, async (args) => {
            const manual = await this.manualProvider.getManualById(args.manualId);
            if (!manual) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Manual ${args.manualId} not found.`,
                        },
                    ],
                };
            }
            const serialised = serialiseManual(manual);
            return {
                content: [
                    {
                        type: 'text',
                        text: formatManual(manual),
                    },
                ],
                structuredContent: serialised,
            };
        });
        this.server.registerTool('search_manuals', {
            description: 'Search manuals by filename (returns basic info only, no download)',
            inputSchema: { query: zod_1.z.string() },
        }, async (args) => {
            const allManuals = await this.manualProvider.listManuals();
            const filtered = allManuals.filter((m) => m.originalName?.toLowerCase().includes(args.query.toLowerCase()) ||
                m.filename?.toLowerCase().includes(args.query.toLowerCase()));
            const serialised = filtered.map(serialiseManual);
            return {
                content: [
                    {
                        type: 'text',
                        text: serialised.length > 0
                            ? `Found ${serialised.length} manuals matching "${args.query}":\n\n${formatManualList(filtered)}`
                            : `No manuals found matching "${args.query}".`,
                    },
                ],
                structuredContent: {
                    manuals: serialised,
                },
            };
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
                const data = await this.requestJson('/api/vector-index/search', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        fileId: args.fileId,
                        query: args.query,
                        k: args.k ?? 5,
                        minScore: args.minScore ?? 0.0,
                    }),
                });
                const results = Array.isArray(data?.results) ? data.results : [];
                const summary = results.length > 0
                    ? `Found ${results.length} relevant passages in ${args.fileId}:\n\n${results
                        .map((entry, index) => `${index + 1}. Score: ${typeof entry.score === 'number' ? entry.score.toFixed(3) : 'n/a'}\n${entry.content?.slice(0, 250) ?? ''}${entry.content && entry.content.length > 250 ? '...' : ''}`)
                        .join('\n\n')}`
                    : `No relevant passages found for "${args.query}" in manual ${args.fileId}.`;
                return {
                    content: [
                        {
                            type: 'text',
                            text: summary,
                        },
                    ],
                    structuredContent: {
                        fileId: args.fileId,
                        query: args.query,
                        total: results.length,
                        results,
                    },
                };
            }
            catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error performing vector search: ${error.message}`,
                        },
                    ],
                    structuredContent: {
                        fileId: args.fileId,
                        query: args.query,
                        total: 0,
                        results: [],
                    },
                };
            }
        });
        this.server.registerTool('search_manual_content', {
            description: 'Search within an extracted manual for relevant text snippets without downloading the full file.',
            inputSchema: {
                fileId: zod_1.z.string(),
                query: zod_1.z.string(),
                limit: zod_1.z.number().int().min(1).max(10).optional(),
            },
        }, async (args) => {
            try {
                const params = new URLSearchParams({ query: args.query });
                if (typeof args.limit === 'number') {
                    params.set('limit', String(Math.max(1, Math.min(args.limit, 10))));
                }
                const queryString = params.toString();
                const data = await this.requestJson(`/api/search/manual/${encodeURIComponent(args.fileId)}${queryString ? `?${queryString}` : ''}`);
                const results = Array.isArray(data?.results) ? data.results : [];
                const summary = results.length > 0
                    ? `Found ${results.length} snippets in ${args.fileId}:\n\n${results
                        .map((entry, index) => `${index + 1}. Chunk ${entry.chunkOrder ?? 'n/a'}\n${entry.content}`)
                        .join('\n\n')}`
                    : `No relevant snippets found for "${args.query}" in manual ${args.fileId}.`;
                return {
                    content: [
                        {
                            type: 'text',
                            text: summary,
                        },
                    ],
                    structuredContent: {
                        fileId: data?.fileId ?? args.fileId,
                        query: data?.query ?? args.query,
                        resultCount: data?.resultCount ?? results.length,
                        results,
                    },
                };
            }
            catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Manual content search failed: ${error.message}`,
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
        });
        this.server.registerTool('search_all_manuals', {
            description: 'Search across all indexed manuals for relevant snippets based on extracted text (non-semantic).',
            inputSchema: {
                query: zod_1.z.string(),
                limit: zod_1.z.number().int().min(1).max(20).optional(),
            },
        }, async (args) => {
            try {
                const params = new URLSearchParams({ query: args.query });
                if (typeof args.limit === 'number') {
                    params.set('limit', String(Math.max(1, Math.min(args.limit, 20))));
                }
                const data = await this.requestJson(`/api/search/all-manuals?${params.toString()}`);
                const results = Array.isArray(data?.results) ? data.results : [];
                const manuals = await this.manualProvider.listManuals();
                const fileNameMap = new Map();
                for (const manual of manuals) {
                    fileNameMap.set(manual.id, manual.originalName || manual.filename);
                }
                const enriched = results.map((entry) => ({
                    ...entry,
                    fileName: entry.fileName || fileNameMap.get(entry.fileId) || entry.fileId,
                }));
                const summary = enriched.length > 0
                    ? `Found ${enriched.length} snippets across ${new Set(enriched.map((e) => e.fileId)).size} manuals:\n\n${enriched
                        .map((entry, index) => `${index + 1}. [${entry.fileName}] Chunk ${entry.chunkOrder ?? 'n/a'}\n${entry.content}`)
                        .join('\n\n')}`
                    : `No manuals contained "${args.query}".`;
                return {
                    content: [
                        {
                            type: 'text',
                            text: summary,
                        },
                    ],
                    structuredContent: {
                        query: data?.query ?? args.query,
                        resultCount: data?.resultCount ?? enriched.length,
                        results: enriched,
                    },
                };
            }
            catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Global manual search failed: ${error.message}`,
                        },
                    ],
                    structuredContent: {
                        query: args.query,
                        resultCount: 0,
                        results: [],
                    },
                };
            }
        });
        this.server.registerTool('semantic_search', {
            description: 'Perform semantic vector search across all manuals without specifying a file. Uses existing vector indexes.',
            inputSchema: {
                query: zod_1.z.string(),
                k: zod_1.z.number().int().min(1).max(20).optional(),
                minScore: zod_1.z.number().min(0).max(1).optional(),
            },
        }, async (args) => {
            try {
                const data = await this.requestJson('/api/vector-index/search-all', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        query: args.query,
                        k: args.k ?? 5,
                        minScore: args.minScore ?? 0.5,
                    }),
                });
                const results = Array.isArray(data?.results) ? data.results : [];
                const manuals = await this.manualProvider.listManuals();
                const fileNameMap = new Map();
                for (const manual of manuals) {
                    fileNameMap.set(manual.id, manual.originalName || manual.filename);
                }
                const enriched = results.map((entry) => ({
                    ...entry,
                    fileName: entry.fileName || fileNameMap.get(entry.fileId) || entry.fileId,
                }));
                const summary = enriched.length > 0
                    ? `Semantic search matched ${enriched.length} passages across ${new Set(enriched.map((e) => e.fileId)).size} manuals:\n\n${enriched
                        .map((entry, index) => `${index + 1}. [${entry.fileName}] Score: ${typeof entry.score === 'number' ? entry.score.toFixed(3) : 'n/a'}\n${entry.content?.slice(0, 250) ?? ''}${entry.content && entry.content.length > 250 ? '...' : ''}`)
                        .join('\n\n')}`
                    : `Semantic search returned no matches for "${args.query}".`;
                return {
                    content: [
                        {
                            type: 'text',
                            text: summary,
                        },
                    ],
                    structuredContent: {
                        query: args.query,
                        total: enriched.length,
                        results: enriched,
                    },
                };
            }
            catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Semantic search failed: ${error.message}`,
                        },
                    ],
                    structuredContent: {
                        query: args.query,
                        total: 0,
                        results: [],
                    },
                };
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
            const serialised = entries.map(serialiseQA);
            return {
                content: [
                    {
                        type: 'text',
                        text: serialised.length > 0
                            ? `Found ${serialised.length} Q&A entries:\n\n${formatQAList(entries)}`
                            : 'No Q&A entries found.',
                    },
                ],
                structuredContent: {
                    entries: serialised,
                },
            };
        });
        this.server.registerTool('search_qa_entries', {
            description: 'Search Q&A entries intelligently',
            inputSchema: {
                query: zod_1.z.string(),
                limit: zod_1.z.number().optional(),
                intelligent: zod_1.z.boolean().optional(),
            },
        }, async (args) => {
            const limit = Math.max(1, Math.min(args.limit ?? 5, 10));
            const useIntelligent = args.intelligent !== false;
            const entries = useIntelligent
                ? await this.qaProvider.intelligentSearch(args.query, limit)
                : (await this.qaProvider.searchEntries(args.query)).slice(0, limit);
            const serialised = entries.map(serialiseQA);
            return {
                content: [
                    {
                        type: 'text',
                        text: serialised.length > 0
                            ? `Found ${serialised.length} Q&A entries for "${args.query}":\n\n${formatQAList(entries)}`
                            : `No Q&A entries found for "${args.query}".`,
                    },
                ],
                structuredContent: {
                    query: args.query,
                    intelligent: useIntelligent,
                    limit,
                    entries: serialised,
                },
            };
        });
        this.server.registerTool('get_qa_entry', {
            description: 'Get a specific Q&A entry by ID',
            inputSchema: { entryId: zod_1.z.string() },
        }, async (args) => {
            const entry = await this.qaProvider.getEntryById(args.entryId);
            if (!entry) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Q&A entry ${args.entryId} not found.`,
                        },
                    ],
                };
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: formatQA(entry),
                    },
                ],
                structuredContent: serialiseQA(entry),
            };
        });
        // Thinking Tools (6)
        this.server.registerTool('start_thinking', {
            description: 'Start a thinking process',
            inputSchema: { thought: zod_1.z.string() },
        }, async (args) => {
            const session = thinkingStore_js_1.thinkingStore.createSession(args.thought);
            thinkingStore_js_1.thinkingStore.addThought(session.id, args.thought, 'observation');
            return {
                content: [
                    {
                        type: 'text',
                        text: `Started thinking process: ${session.id}`,
                    },
                ],
                structuredContent: serialiseThinkingSession(session),
            };
        });
        this.server.registerTool('continue_thinking', {
            description: 'Continue a thinking process',
            inputSchema: {
                thinkingId: zod_1.z.string(),
                thought: zod_1.z.string(),
            },
        }, async (args) => {
            const entry = thinkingStore_js_1.thinkingStore.addThought(args.thinkingId, args.thought, 'analysis');
            return {
                content: [
                    {
                        type: 'text',
                        text: 'Thinking continued',
                    },
                ],
                structuredContent: serialiseThinkingEntry(entry),
            };
        });
        this.server.registerTool('finish_thinking', {
            description: 'Finish a thinking process',
            inputSchema: { thinkingId: zod_1.z.string() },
        }, async (args) => {
            const session = thinkingStore_js_1.thinkingStore.completeSession(args.thinkingId, 'Completed via MCP');
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(session, null, 2),
                    },
                ],
                structuredContent: serialiseThinkingSession(session),
            };
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
