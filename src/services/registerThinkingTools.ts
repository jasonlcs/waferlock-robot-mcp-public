import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ThinkingSession, ThoughtEntry } from './thinkingStore.js';
import { thinkingStore } from './thinkingStore.js';

export interface ThinkingToolConfig {
  recommendedTools?: string[];
}

interface SerializedThought {
  thought: string;
  type: ThoughtEntry['type'];
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface SerializedSession {
  id: string;
  topic: string;
  context?: string;
  startedAt: string;
  completedAt?: string | null;
  conclusion?: string;
  thoughts: SerializedThought[];
  active: boolean;
  thoughtCount: number;
}

const THOUGHT_TYPES = [
  'observation',
  'analysis',
  'comparison',
  'question',
  'conclusion',
] as const;

const DEFAULT_RECOMMENDED_TOOLS = [
  'search_manual_content',
  'search_manual_vector',
  'semantic_search',
  'search_qa_entries',
];

function serializeThought(entry: ThoughtEntry): SerializedThought {
  return {
    thought: entry.thought,
    type: entry.type,
    timestamp: entry.timestamp.toISOString(),
    metadata: entry.metadata,
  };
}

function serializeSession(session: ThinkingSession): SerializedSession {
  return {
    id: session.id,
    topic: session.topic,
    context: session.context,
    startedAt: session.startedAt.toISOString(),
    completedAt: session.completedAt ? session.completedAt.toISOString() : null,
    conclusion: session.conclusion,
    thoughts: session.thoughts.map(serializeThought),
    active: !session.completedAt,
    thoughtCount: session.thoughts.length,
  };
}

function normaliseTopic(value: string): string {
  return value.trim().toLowerCase();
}

export function registerThinkingTools(
  server: McpServer,
  config: ThinkingToolConfig = {},
) {
  const recommendedTools = config.recommendedTools || DEFAULT_RECOMMENDED_TOOLS;

  const thoughtSchema = z.object({
    thought: z.string(),
    type: z.enum(THOUGHT_TYPES),
    timestamp: z.string(),
    metadata: z.record(z.any()).optional(),
  });

  const sessionSchema = z.object({
    id: z.string(),
    topic: z.string(),
    context: z.string().nullable().optional(),
    startedAt: z.string(),
    completedAt: z.string().nullable().optional(),
    conclusion: z.string().nullable().optional(),
    active: z.boolean(),
    thoughtCount: z.number().int().nonnegative(),
    thoughts: z.array(thoughtSchema),
  });

  const decisionShape = {
    shouldStart: z.boolean(),
    reason: z.string(),
    started: z.boolean(),
    session: sessionSchema.nullable(),
    recommendedTools: z.array(z.string()),
  };

  server.registerTool(
    'ensure_thinking_session',
    {
      description: `Decide whether a structured thinking session should be started.
If no active session exists for the same topic/context this will automatically start one.`,
      inputSchema: {
        topic: z.string().describe('Target problem to investigate'),
        context: z.string().optional().describe('Additional requirements or constraints'),
        forceNew: z.boolean().optional().describe('Force a new session even if one exists'),
      },
      outputSchema: decisionShape,
    },
    async (args) => {
      const topic = args.topic.trim();
      if (!topic) {
        return {
          content: [{
            type: 'text',
            text: 'Topic is required to decide on thinking session.',
          }],
          structuredContent: {
            shouldStart: false,
            reason: 'Empty topic provided.',
            started: false,
            session: null,
            recommendedTools,
          },
        };
      }

      const activeSessions = thinkingStore.listActiveSessions();
      const matched = activeSessions.find((session) => {
        if (normaliseTopic(session.topic) === normaliseTopic(topic)) {
          return true;
        }
        if (args.context && session.context) {
          return normaliseTopic(session.context) === normaliseTopic(args.context);
        }
        return false;
      });

      if (matched && !args.forceNew) {
        return {
          content: [{
            type: 'text',
            text: `Reusing active thinking session ${matched.id} for topic "${matched.topic}".`,
          }],
          structuredContent: {
            shouldStart: false,
            reason: 'Existing active session matches the topic/context.',
            started: false,
            session: serializeSession(matched),
            recommendedTools,
          },
        };
      }

      const session = thinkingStore.createSession(topic, args.context);
      return {
        content: [{
          type: 'text',
          text: `Started thinking session ${session.id} for "${topic}".`,
        }],
        structuredContent: {
          shouldStart: true,
          reason: matched && args.forceNew
            ? 'forceNew set to true, created a new session.'
            : 'No active session matched the topic/context.',
          started: true,
          session: serializeSession(session),
          recommendedTools,
        },
      };
    },
  );

  server.registerTool(
    'start_thinking',
    {
      description: 'Begin a structured thinking process for complex or multi-step tasks.',
      inputSchema: {
        topic: z.string().describe('Topic or question to investigate'),
        context: z.string().optional().describe('Additional requirements or guardrails'),
      },
      outputSchema: {
        session: sessionSchema,
        recommendedTools: z.array(z.string()),
      },
    },
    async (args) => {
      const session = thinkingStore.createSession(args.topic, args.context);
      return {
        content: [{
          type: 'text',
          text: `Thinking session ${session.id} started for "${session.topic}".\n` +
            'Next steps:\n' +
            '1. Use continue_thinking after each observation.\n' +
            '2. Call retrieval tools to gather evidence.\n' +
            '3. Finish with finish_thinking once you have a conclusion.',
        }],
        structuredContent: {
          session: serializeSession(session),
          recommendedTools,
        },
      };
    },
  );

  server.registerTool(
    'continue_thinking',
    {
      description: 'Record an observation, analysis, or comparison during the thinking process.',
      inputSchema: {
        thinkingId: z.string().describe('Thinking session ID returned by start_thinking'),
        thought: z.string().describe('Observation, analysis, or note to add'),
        type: z.enum(THOUGHT_TYPES).optional()
          .describe('Classification of the thought (default "observation")'),
        metadata: z.record(z.any()).optional()
          .describe('Optional metadata such as {"source":"manual","fileId":"..."}'),
      },
      outputSchema: {
        session: sessionSchema,
        entry: thoughtSchema,
        recommendedTools: z.array(z.string()),
      },
    },
    async (args) => {
      try {
        const entry = thinkingStore.addThought(
          args.thinkingId,
          args.thought,
          args.type,
          args.metadata,
        );
        const session = thinkingStore.getSession(args.thinkingId);
        if (!session) {
          throw new Error(`Thinking session ${args.thinkingId} not found`);
        }

        return {
          content: [{
            type: 'text',
            text: `Recorded ${entry.type} in session ${session.id}. Total thoughts: ${session.thoughts.length}.`,
          }],
          structuredContent: {
            session: serializeSession(session),
            entry: serializeThought(entry),
            recommendedTools,
          },
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to record thought: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    },
  );

  server.registerTool(
    'finish_thinking',
    {
      description: 'Complete the thinking process and provide a final conclusion.',
      inputSchema: {
        thinkingId: z.string().describe('Thinking session ID returned by start_thinking'),
        conclusion: z.string().describe('Final recommendation, answer, or summary'),
      },
      outputSchema: {
        session: sessionSchema,
        summary: z.object({
          topic: z.string(),
          thoughtCount: z.number(),
          durationSeconds: z.number(),
          conclusion: z.string(),
        }),
      },
    },
    async (args) => {
      try {
        const session = thinkingStore.completeSession(args.thinkingId, args.conclusion);
        const durationSeconds = session.completedAt && session.startedAt
          ? (session.completedAt.getTime() - session.startedAt.getTime()) / 1000
          : 0;

        const summary = {
          topic: session.topic,
          thoughtCount: session.thoughts.length,
          durationSeconds,
          conclusion: args.conclusion,
        };

        return {
          content: [{
            type: 'text',
            text: `Thinking session ${session.id} completed.\n` +
              `Topic: ${summary.topic}\nThoughts recorded: ${summary.thoughtCount}\n` +
              `Duration: ${summary.durationSeconds.toFixed(1)}s\n\nConclusion:\n${summary.conclusion}`,
          }],
          structuredContent: {
            session: serializeSession(session),
            summary,
          },
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to finish thinking session: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    },
  );
}
