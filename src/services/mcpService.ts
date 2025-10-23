import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { UploadedFile } from '../types.js';
import { ManualProvider } from './manualProvider.js';

export interface MCPServiceOptions {
  manualProvider: ManualProvider;
  name?: string;
  version?: string;
}

function serialiseManual(manual: UploadedFile) {
  return {
    ...manual,
    uploadedAt: manual.uploadedAt instanceof Date
      ? manual.uploadedAt.toISOString()
      : manual.uploadedAt,
  };
}

function formatManual(manual: UploadedFile): string {
  return JSON.stringify(serialiseManual(manual), null, 2);
}

function formatManuals(manuals: UploadedFile[]): string {
  return JSON.stringify(manuals.map(serialiseManual), null, 2);
}

export class MCPService {
  private server: McpServer;
  private manualProvider: ManualProvider;

  constructor(options: MCPServiceOptions) {
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

  private registerTools() {
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

    this.server.registerTool(
      'list_manuals',
      {
        description: 'List all uploaded Waferlock product manuals',
        outputSchema: {
          manuals: manualListSchema,
        },
      },
      async () => {
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
      }
    );

    this.server.registerTool(
      'get_manual_info',
      {
        description: 'Get information about a specific manual by ID',
        inputSchema: {
          fileId: z.string().describe('The ID of the manual file'),
        },
        outputSchema: manualSchema,
      },
      async (args) => {
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
      }
    );

    this.server.registerTool(
      'search_manuals',
      {
        description: 'Search for manuals by filename',
        inputSchema: {
          query: z.string().describe('Search query for manual filenames'),
        },
        outputSchema: {
          manuals: manualListSchema,
        },
      },
      async (args) => {
        const query = args.query.toLowerCase();
        const manuals = await this.manualProvider.listManuals();
        const results = manuals.filter(
          (manual) =>
            manual.originalName.toLowerCase().includes(query) ||
            manual.filename.toLowerCase().includes(query)
        );

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
      }
    );

    this.server.registerTool(
      'get_manual_download_url',
      {
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
      },
      async (args) => {
        if (typeof this.manualProvider.getManualDownloadUrl !== 'function') {
          return {
            content: [
              {
                type: 'text',
                text: 'Manual download URLs are not supported by the configured provider.',
              },
            ],
          };
        }

        const expiresInSeconds = args.expiresInSeconds;

        try {
          const downloadUrl = await this.manualProvider.getManualDownloadUrl(args.fileId, {
            expiresInSeconds,
          });

          if (!downloadUrl) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Manual with ID ${args.fileId} not found`,
                },
              ],
            };
          }

          const effectiveExpiresInSeconds =
            typeof expiresInSeconds === 'number' ? expiresInSeconds : 900;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    downloadUrl,
                    expiresInSeconds: effectiveExpiresInSeconds,
                  },
                  null,
                  2
                ),
              },
            ],
            structuredContent: {
              downloadUrl,
              expiresInSeconds: effectiveExpiresInSeconds,
            },
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Failed to generate download URL: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    this.server.registerTool(
      'get_manual_content',
      {
        description:
          'Fetch the full manual content (base64-encoded) for AI processing. Intended for MCP agent use only.',
        inputSchema: {
          fileId: z.string().describe('The ID of the manual file'),
        },
        outputSchema: manualContentSchema,
      },
      async (args) => {
        if (typeof this.manualProvider.getManualContent !== 'function') {
          return {
            content: [
              {
                type: 'text',
                text: 'Manual content retrieval is not supported by the configured provider.',
              },
            ],
          };
        }

        try {
          const result = await this.manualProvider.getManualContent(args.fileId);
          if (!result) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Manual with ID ${args.fileId} not found`,
                },
              ],
            };
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
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Failed to fetch manual content: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );
  }

  async start(transport: StdioServerTransport = new StdioServerTransport()) {
    await this.server.connect(transport);
    console.error('Waferlock Robot MCP server running on stdio');

    const keepAlive = setInterval(() => {
      // Periodic no-op to keep the event loop active for the MCP session
    }, 60_000);

    if (typeof process !== 'undefined' && typeof process.stdin?.resume === 'function') {
      process.stdin.resume();
    }

    await new Promise<void>((resolve, reject) => {
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

      const rejectOnce = (error: unknown) => {
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
        } finally {
          resolveOnce();
        }
      };

      transport.onerror = (error) => {
        try {
          originalOnError?.(error as Error);
        } finally {
          rejectOnce(error);
        }
      };
    });
  }

  getServer() {
    return this.server;
  }
}
