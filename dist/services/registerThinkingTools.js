"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerThinkingTools = registerThinkingTools;
const zod_1 = require("zod");
const thinkingStore_js_1 = require("./thinkingStore.js");
const THOUGHT_TYPES = [
    'observation',
    'analysis',
    'comparison',
    'question',
    'conclusion',
];
const DEFAULT_RECOMMENDED_TOOLS = [
    'search_manual_content',
    'search_manual_vector',
    'semantic_search',
    'search_qa_entries',
];
function serializeThought(entry) {
    return {
        thought: entry.thought,
        type: entry.type,
        timestamp: entry.timestamp.toISOString(),
        metadata: entry.metadata,
    };
}
function serializeSession(session) {
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
function normaliseTopic(value) {
    return value.trim().toLowerCase();
}
function registerThinkingTools(server, config = {}) {
    const recommendedTools = config.recommendedTools || DEFAULT_RECOMMENDED_TOOLS;
    const thoughtSchema = zod_1.z.object({
        thought: zod_1.z.string(),
        type: zod_1.z.enum(THOUGHT_TYPES),
        timestamp: zod_1.z.string(),
        metadata: zod_1.z.record(zod_1.z.any()).optional(),
    });
    const sessionSchema = zod_1.z.object({
        id: zod_1.z.string(),
        topic: zod_1.z.string(),
        context: zod_1.z.string().nullable().optional(),
        startedAt: zod_1.z.string(),
        completedAt: zod_1.z.string().nullable().optional(),
        conclusion: zod_1.z.string().nullable().optional(),
        active: zod_1.z.boolean(),
        thoughtCount: zod_1.z.number().int().nonnegative(),
        thoughts: zod_1.z.array(thoughtSchema),
    });
    const decisionShape = {
        shouldStart: zod_1.z.boolean(),
        reason: zod_1.z.string(),
        started: zod_1.z.boolean(),
        session: sessionSchema.nullable(),
        recommendedTools: zod_1.z.array(zod_1.z.string()),
    };
    server.registerTool('ensure_thinking_session', {
        description: `Decide whether a structured thinking session should be started.
If no active session exists for the same topic/context this will automatically start one.`,
        inputSchema: {
            topic: zod_1.z.string().describe('Target problem to investigate'),
            context: zod_1.z.string().optional().describe('Additional requirements or constraints'),
            forceNew: zod_1.z.boolean().optional().describe('Force a new session even if one exists'),
        },
        outputSchema: decisionShape,
    }, async (args) => {
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
        const activeSessions = thinkingStore_js_1.thinkingStore.listActiveSessions();
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
        const session = thinkingStore_js_1.thinkingStore.createSession(topic, args.context);
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
    });
    server.registerTool('start_thinking', {
        description: 'Begin a structured thinking process for complex or multi-step tasks.',
        inputSchema: {
            topic: zod_1.z.string().describe('Topic or question to investigate'),
            context: zod_1.z.string().optional().describe('Additional requirements or guardrails'),
        },
        outputSchema: {
            session: sessionSchema,
            recommendedTools: zod_1.z.array(zod_1.z.string()),
        },
    }, async (args) => {
        const session = thinkingStore_js_1.thinkingStore.createSession(args.topic, args.context);
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
    });
    server.registerTool('continue_thinking', {
        description: 'Record an observation, analysis, or comparison during the thinking process.',
        inputSchema: {
            thinkingId: zod_1.z.string().describe('Thinking session ID returned by start_thinking'),
            thought: zod_1.z.string().describe('Observation, analysis, or note to add'),
            type: zod_1.z.enum(THOUGHT_TYPES).optional()
                .describe('Classification of the thought (default "observation")'),
            metadata: zod_1.z.record(zod_1.z.any()).optional()
                .describe('Optional metadata such as {"source":"manual","fileId":"..."}'),
        },
        outputSchema: {
            session: sessionSchema,
            entry: thoughtSchema,
            recommendedTools: zod_1.z.array(zod_1.z.string()),
        },
    }, async (args) => {
        try {
            const entry = thinkingStore_js_1.thinkingStore.addThought(args.thinkingId, args.thought, args.type, args.metadata);
            const session = thinkingStore_js_1.thinkingStore.getSession(args.thinkingId);
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
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Failed to record thought: ${error instanceof Error ? error.message : String(error)}`,
                    }],
            };
        }
    });
    server.registerTool('finish_thinking', {
        description: 'Complete the thinking process and provide a final conclusion.',
        inputSchema: {
            thinkingId: zod_1.z.string().describe('Thinking session ID returned by start_thinking'),
            conclusion: zod_1.z.string().describe('Final recommendation, answer, or summary'),
        },
        outputSchema: {
            session: sessionSchema,
            summary: zod_1.z.object({
                topic: zod_1.z.string(),
                thoughtCount: zod_1.z.number(),
                durationSeconds: zod_1.z.number(),
                conclusion: zod_1.z.string(),
            }),
        },
    }, async (args) => {
        try {
            const session = thinkingStore_js_1.thinkingStore.completeSession(args.thinkingId, args.conclusion);
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
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Failed to finish thinking session: ${error instanceof Error ? error.message : String(error)}`,
                    }],
            };
        }
    });
}
