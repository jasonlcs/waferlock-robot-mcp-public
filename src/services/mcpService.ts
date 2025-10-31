import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { QAEntry, UploadedFile } from '../types.js';
import { createManualApiProvider } from './manualApiProvider.js';
import { createQAApiProvider } from './qaApiProvider.js';
import { thinkingStore } from './thinkingStore.js';
import { registerThinkingTools } from './registerThinkingTools.js';

type HeaderRecord = Record<string, string>;

interface HeadersLike {
  forEach(callback: (value: string, key: string) => void): void;
}

type HeaderInitInput = HeaderRecord | string[][] | HeadersLike;

function isHeadersLike(value: unknown): value is HeadersLike {
  return typeof value === 'object' && value !== null && typeof (value as HeadersLike).forEach === 'function';
}

function serialiseManual(manual: UploadedFile) {
  return {
    ...manual,
    uploadedAt: manual.uploadedAt instanceof Date ? manual.uploadedAt.toISOString() : manual.uploadedAt,
    indexStartedAt: manual.indexStartedAt || null,
    indexCompletedAt: manual.indexCompletedAt || null,
  };
}

function formatManual(manual: UploadedFile): string {
  return JSON.stringify(serialiseManual(manual), null, 2);
}

function formatManualList(manuals: UploadedFile[]): string {
  return JSON.stringify(manuals.map(serialiseManual), null, 2);
}

function serialiseQA(entry: QAEntry) {
  return {
    ...entry,
    createdAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : entry.createdAt,
    updatedAt: entry.updatedAt instanceof Date ? entry.updatedAt.toISOString() : entry.updatedAt,
  };
}

function formatQA(entry: QAEntry): string {
  return JSON.stringify(serialiseQA(entry), null, 2);
}

function formatQAList(entries: QAEntry[]): string {
  return JSON.stringify(entries.map(serialiseQA), null, 2);
}

function normalizeApiBase(url: string): string {
  return url.replace(/\/+$/, '');
}

export class MCPService {
  private server: McpServer;
  private serverName: string;
  private serverVersion: string;
  private manualProvider: any;
  private qaProvider: any;
  private apiUrl: string | null = null;
  private apiToken: string | null = null;

  constructor(options: {
    name?: string;
    version?: string;
    manualProvider?: any;
    qaProvider?: any;
    apiUrl?: string;
    apiToken?: string;
  } = {}) {
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
    } else {
      if (!this.apiUrl || !this.apiToken) {
        throw new Error('API_URL and API_TOKEN are required');
      }
      this.manualProvider = createManualApiProvider(this.apiUrl, this.apiToken);
      this.qaProvider = createQAApiProvider(this.apiUrl, this.apiToken);
    }
    
    this.server = new McpServer({
      name: this.serverName,
      version: this.serverVersion,
    });

    this.registerTools();
  }

  private buildApiUrl(path: string): string {
    if (!this.apiUrl) {
      throw new Error('API_URL is not configured');
    }
    return `${this.apiUrl}/${path.replace(/^\//, '')}`;
  }

  private mergeHeaders(extra?: HeaderInitInput): HeaderRecord {
    if (!this.apiToken) {
      throw new Error('API_TOKEN is not configured');
    }

    const base: HeaderRecord = {
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
      ...(extra as HeaderRecord),
    };
  }

  private async requestJson(path: string, init: RequestInit = {}) {
    const response = await fetch(this.buildApiUrl(path), {
      ...init,
      headers: this.mergeHeaders(init.headers as HeaderInitInput | undefined),
    });

    const text = await response.text();
    let parsed: any = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!response.ok) {
      const message =
        parsed && typeof parsed === 'object' && parsed.error
          ? parsed.error
          : `${response.status} ${response.statusText}`;
      throw new Error(`API request failed: ${message}`);
    }

    return parsed;
  }

  private registerTools() {
    // Manual Management Tools (3) - 只提供基本資訊，禁止下載
    this.server.registerTool(
      'list_manuals',
      { 
        description: 'List all available manuals with basic metadata (no download)',
        inputSchema: {}
      },
      async () => {
        const manuals = await this.manualProvider.listManuals();
        const serialised = manuals.map(serialiseManual);

        return {
          content: [
            {
              type: 'text',
              text:
                serialised.length > 0
                  ? `Found ${serialised.length} manuals:\n\n${formatManualList(manuals)}`
                  : 'No manuals found.',
            },
          ],
          structuredContent: {
            manuals: serialised,
          },
        };
      }
    );

    this.server.registerTool(
      'get_manual_info',
      {
        description: 'Get basic information about a specific manual (metadata only, no content/download)',
        inputSchema: { manualId: z.string() },
      },
      async (args) => {
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
      }
    );

    this.server.registerTool(
      'search_manuals',
      {
        description: 'Search manuals by filename (returns basic info only, no download)',
        inputSchema: { query: z.string() },
      },
      async (args) => {
        const allManuals = await this.manualProvider.listManuals();
        const filtered = allManuals.filter((m: any) => 
          m.originalName?.toLowerCase().includes(args.query.toLowerCase()) ||
          m.filename?.toLowerCase().includes(args.query.toLowerCase())
        );
        const serialised = filtered.map(serialiseManual);

        return {
          content: [
            {
              type: 'text',
              text:
                serialised.length > 0
                  ? `Found ${serialised.length} manuals matching "${args.query}":\n\n${formatManualList(filtered)}`
                  : `No manuals found matching "${args.query}".`,
            },
          ],
          structuredContent: {
            manuals: serialised,
          },
        };
      }
    );

    this.server.registerTool(
      'get_manual_index_stats',
      {
        description:
          'Retrieve indexing statistics for a manual to confirm whether content chunks are available.',
        inputSchema: {
          fileId: z.string().describe('The ID of the manual to inspect'),
        },
        outputSchema: {
          fileId: z.string(),
          fileName: z.string(),
          isIndexed: z.boolean(),
          totalChunks: z.number().optional(),
          totalCharacters: z.number().optional(),
          extractedAt: z.string().optional(),
        },
      },
      async (args) => {
        const manual = await this.manualProvider.getManualById(args.fileId);
        if (!manual) {
          throw new Error(`Manual ${args.fileId} not found.`);
        }

        const stats = await this.requestJson(
          `/api/search/manual/${encodeURIComponent(args.fileId)}/stats`
        );

        const fileName = manual.originalName || manual.filename || args.fileId;
        const isIndexed = !!stats?.isIndexed;
        const totalChunks = typeof stats?.totalChunks === 'number' ? stats.totalChunks : undefined;
        const totalCharacters =
          typeof stats?.totalCharacters === 'number' ? stats.totalCharacters : undefined;
        const extractedAt = typeof stats?.extractedAt === 'string' ? stats.extractedAt : undefined;

        const structured = {
          fileId: args.fileId,
          fileName,
          isIndexed,
          totalChunks,
          totalCharacters,
          extractedAt,
        };

        const summary = isIndexed
          ? `Manual "${fileName}" is indexed.\n- Chunks: ${
              totalChunks ?? 'unknown'
            }\n- Characters: ${totalCharacters ?? 'unknown'}${
              extractedAt ? `\n- Extracted: ${extractedAt}` : ''
            }`
          : `Manual "${fileName}" is not yet indexed. It will become searchable once indexing completes.`;

        return {
          content: [
            {
              type: 'text',
              text: summary,
            },
          ],
          structuredContent: structured,
        };
      }
    );

    // Vector Search (1)
    this.server.registerTool(
      'search_manual_vector',
      {
        description: 'Search within a manual using vector similarity (semantic search)',
        inputSchema: {
          fileId: z.string(),
          query: z.string(),
          k: z.number().optional(),
          minScore: z.number().optional(),
        },
      },
      async (args) => {
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
          const summary =
            results.length > 0
              ? `Found ${results.length} relevant passages in ${args.fileId}:\n\n${results
                  .map(
                    (entry: any, index: number) =>
                      `${index + 1}. Score: ${typeof entry.score === 'number' ? entry.score.toFixed(3) : 'n/a'}\n${
                        entry.content?.slice(0, 250) ?? ''
                      }${entry.content && entry.content.length > 250 ? '...' : ''}`
                  )
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
        } catch (error: any) {
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
      }
    );

    this.server.registerTool(
      'search_manual_content',
      {
        description:
          'Search within an extracted manual for relevant text snippets without downloading the full file.',
        inputSchema: {
          fileId: z.string(),
          query: z.string(),
          limit: z.number().int().min(1).max(10).optional(),
        },
      },
      async (args) => {
        try {
          const params = new URLSearchParams({ query: args.query });
          if (typeof args.limit === 'number') {
            params.set('limit', String(Math.max(1, Math.min(args.limit, 10))));
          }

          const queryString = params.toString();
          const data = await this.requestJson(
            `/api/search/manual/${encodeURIComponent(args.fileId)}${queryString ? `?${queryString}` : ''}`
          );

          const results = Array.isArray(data?.results) ? data.results : [];
          const summary =
            results.length > 0
              ? `Found ${results.length} snippets in ${args.fileId}:\n\n${results
                  .map(
                    (entry: any, index: number) =>
                      `${index + 1}. Chunk ${entry.chunkOrder ?? 'n/a'}\n${entry.content}`
                  )
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
        } catch (error: any) {
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
      }
    );

    this.server.registerTool(
      'search_all_manuals',
      {
        description:
          'Search across all indexed manuals for relevant snippets based on extracted text (non-semantic).',
        inputSchema: {
          query: z.string(),
          limit: z.number().int().min(1).max(20).optional(),
        },
      },
      async (args) => {
        try {
          const params = new URLSearchParams({ query: args.query });
          if (typeof args.limit === 'number') {
            params.set('limit', String(Math.max(1, Math.min(args.limit, 20))));
          }

          const data = await this.requestJson(
            `/api/search/all-manuals?${params.toString()}`
          );
          const results = Array.isArray(data?.results) ? data.results : [];

          const manuals = await this.manualProvider.listManuals();
          const fileNameMap = new Map<string, string>();
          for (const manual of manuals) {
            fileNameMap.set(manual.id, manual.originalName || manual.filename);
          }

          const enriched = results.map((entry: any) => ({
            ...entry,
            fileName: entry.fileName || fileNameMap.get(entry.fileId) || entry.fileId,
          }));

          const summary =
            enriched.length > 0
              ? `Found ${enriched.length} snippets across ${new Set(enriched.map((e: any) => e.fileId)).size} manuals:\n\n${enriched
                  .map(
                    (entry: any, index: number) =>
                      `${index + 1}. [${entry.fileName}] Chunk ${entry.chunkOrder ?? 'n/a'}\n${entry.content}`
                  )
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
        } catch (error: any) {
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
      }
    );

    this.server.registerTool(
      'semantic_search',
      {
        description:
          'Perform semantic vector search across all manuals without specifying a file. Uses existing vector indexes.',
        inputSchema: {
          query: z.string(),
          k: z.number().int().min(1).max(20).optional(),
          minScore: z.number().min(0).max(1).optional(),
        },
      },
      async (args) => {
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
          const fileNameMap = new Map<string, string>();
          for (const manual of manuals) {
            fileNameMap.set(manual.id, manual.originalName || manual.filename);
          }

          const enriched = results.map((entry: any) => ({
            ...entry,
            fileName: entry.fileName || fileNameMap.get(entry.fileId) || entry.fileId,
          }));

          const summary =
            enriched.length > 0
              ? `Semantic search matched ${enriched.length} passages across ${new Set(enriched.map((e: any) => e.fileId)).size} manuals:\n\n${enriched
                  .map(
                    (entry: any, index: number) =>
                      `${index + 1}. [${entry.fileName}] Score: ${typeof entry.score === 'number' ? entry.score.toFixed(3) : 'n/a'}\n${
                        entry.content?.slice(0, 250) ?? ''
                      }${entry.content && entry.content.length > 250 ? '...' : ''}`
                  )
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
        } catch (error: any) {
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
      }
    );

    // Q&A Tools (3)
    this.server.registerTool(
      'list_qa_entries',
      {
        description: 'List all Q&A entries',
        inputSchema: {
          category: z.string().optional(),
          search: z.string().optional(),
        },
      },
      async (args) => {
        const entries = await this.qaProvider.listEntries(args);
        const serialised = entries.map(serialiseQA);
        return {
          content: [
            {
              type: 'text',
              text:
                serialised.length > 0
                  ? `Found ${serialised.length} Q&A entries:\n\n${formatQAList(entries)}`
                  : 'No Q&A entries found.',
            },
          ],
          structuredContent: {
            entries: serialised,
          },
        };
      }
    );

    this.server.registerTool(
      'search_qa_entries',
      {
        description: 'Search Q&A entries intelligently',
        inputSchema: {
          query: z.string(),
          limit: z.number().optional(),
          intelligent: z.boolean().optional(),
        },
      },
      async (args) => {
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
              text:
                serialised.length > 0
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
      }
    );

    this.server.registerTool(
      'get_qa_entry',
      {
        description: 'Get a specific Q&A entry by ID',
        inputSchema: { entryId: z.string() },
      },
      async (args) => {
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
      }
    );

    // Thinking Tools
    registerThinkingTools(this.server, {
      recommendedTools: [
        'search_manual_content',
        'search_manual_vector',
        'semantic_search',
        'search_qa_entries',
      ],
    });

    this.server.registerTool(
      'think_about_collected_information',
      {
        description: 'Reflect on collected information',
        inputSchema: { reflection: z.string() },
      },
      async (args) => {
        return { content: [{ type: 'text', text: `Reflected: ${args.reflection}` }] };
      }
    );

    this.server.registerTool(
      'think_about_task_adherence',
      {
        description: 'Check if staying on task',
        inputSchema: { check: z.string() },
      },
      async (args) => {
        return { content: [{ type: 'text', text: `Task check: ${args.check}` }] };
      }
    );

    this.server.registerTool(
      'think_about_answer_quality',
      {
        description: 'Evaluate answer quality',
        inputSchema: { evaluation: z.string() },
      },
      async (args) => {
        return { content: [{ type: 'text', text: `Quality check: ${args.evaluation}` }] };
      }
    );
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Waferlock Robot MCP server running on stdio');
  }
}
