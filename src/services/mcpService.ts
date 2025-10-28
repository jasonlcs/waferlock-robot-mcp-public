import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { QAEntry, UploadedFile } from '../types.js';
import { createManualApiProvider } from './manualApiProvider.js';
import { createQAApiProvider } from './qaApiProvider.js';
import { thinkingStore } from './thinkingStore.js';

export class MCPService {
  private server: McpServer;
  private serverName: string;
  private serverVersion: string;
  private manualProvider: any;
  private qaProvider: any;

  constructor(options: { 
    name?: string; 
    version?: string;
    manualProvider?: any;
    qaProvider?: any;
  } = {}) {
    this.serverName = options.name || 'waferlock-robot-mcp';
    this.serverVersion = options.version || '2.1.0';
    
    if (options.manualProvider && options.qaProvider) {
      this.manualProvider = options.manualProvider;
      this.qaProvider = options.qaProvider;
    } else {
      const apiUrl = process.env.API_URL || '';
      const apiToken = process.env.API_TOKEN || '';

      if (!apiUrl || !apiToken) {
        throw new Error('API_URL and API_TOKEN are required');
      }

      this.manualProvider = createManualApiProvider(apiUrl, apiToken);
      this.qaProvider = createQAApiProvider(apiUrl, apiToken);
    }
    
    this.server = new McpServer({
      name: this.serverName,
      version: this.serverVersion,
    });

    this.registerTools();
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
        const sanitized = manuals.map((m: any) => ({
          id: m.id,
          originalName: m.originalName,
          uploadedAt: m.uploadedAt,
          size: m.size,
          indexStatus: m.indexStatus
        }));
        return { content: [{ type: 'text', text: JSON.stringify(sanitized, null, 2) }] };
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
        const sanitized = filtered.map((m: any) => ({
          id: m.id,
          originalName: m.originalName,
          uploadedAt: m.uploadedAt,
          size: m.size,
          indexStatus: m.indexStatus
        }));
        return { content: [{ type: 'text', text: JSON.stringify(sanitized, null, 2) }] };
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
        return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
      }
    );

    this.server.registerTool(
      'search_qa_entries',
      {
        description: 'Search Q&A entries intelligently',
        inputSchema: {
          query: z.string(),
          limit: z.number().optional(),
        },
      },
      async (args) => {
        const entries = await this.qaProvider.intelligentSearch(args.query, args.limit);
        return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
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
        return { content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }] };
      }
    );

    // Thinking Tools (6)
    this.server.registerTool(
      'start_thinking',
      {
        description: 'Start a thinking process',
        inputSchema: { thought: z.string() },
      },
      async (args) => {
        const id = thinkingStore.startThinking(args.thought);
        return { content: [{ type: 'text', text: `Started thinking process: ${id}` }] };
      }
    );

    this.server.registerTool(
      'continue_thinking',
      {
        description: 'Continue a thinking process',
        inputSchema: {
          thinkingId: z.string(),
          thought: z.string(),
        },
      },
      async (args) => {
        thinkingStore.continueThinking(args.thinkingId, args.thought);
        return { content: [{ type: 'text', text: 'Thinking continued' }] };
      }
    );

    this.server.registerTool(
      'finish_thinking',
      {
        description: 'Finish a thinking process',
        inputSchema: { thinkingId: z.string() },
      },
      async (args) => {
        const process = thinkingStore.finishThinking(args.thinkingId);
        return { content: [{ type: 'text', text: JSON.stringify(process, null, 2) }] };
      }
    );

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
