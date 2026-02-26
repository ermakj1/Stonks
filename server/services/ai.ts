import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { Response } from 'express';

export type AIProvider = 'anthropic' | 'gemini';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type ToolExecutor = (name: string, input: Record<string, unknown>) => Promise<string>;

const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' });
const geminiClient    = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');

// ── Tool definitions ──────────────────────────────────────────────────

const TOOL_DESCRIPTION = `Fetch a filtered options chain for a stock ticker. Use this when the user asks about options trades, wants to find contracts, or when you need current option prices to make a recommendation.

Returns contracts with: strike, expiry, DTE, bid/ask/mid price, IV%, delta, volume, and open interest.
Always filter to a sensible range — default OTM, 20-90 DTE — to keep results focused.`;

const ANTHROPIC_TOOLS: Anthropic.Tool[] = [{
  name: 'get_option_chain',
  description: TOOL_DESCRIPTION,
  input_schema: {
    type: 'object' as const,
    properties: {
      ticker:      { type: 'string',  description: 'Stock ticker e.g. AAPL, MSFT' },
      type:        { type: 'string',  description: 'Option type: "calls", "puts", or "both". Default: both' },
      dte_min:     { type: 'number',  description: 'Min days to expiration. Default: 20' },
      dte_max:     { type: 'number',  description: 'Max days to expiration. Default: 90' },
      otm_only:    { type: 'boolean', description: 'Only return out-of-the-money options. Default: true' },
      max_results: { type: 'number',  description: 'Max contracts to return. Default: 25, max: 50' },
    },
    required: ['ticker'],
  },
}];

const GEMINI_TOOLS = [{
  functionDeclarations: [{
    name: 'get_option_chain',
    description: TOOL_DESCRIPTION,
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        ticker:      { type: SchemaType.STRING,  description: 'Stock ticker e.g. AAPL, MSFT' },
        type:        { type: SchemaType.STRING,  description: 'Option type: "calls", "puts", or "both". Default: both' },
        dte_min:     { type: SchemaType.NUMBER,  description: 'Min days to expiration. Default: 20' },
        dte_max:     { type: SchemaType.NUMBER,  description: 'Max days to expiration. Default: 90' },
        otm_only:    { type: SchemaType.BOOLEAN, description: 'Only OTM options. Default: true' },
        max_results: { type: SchemaType.NUMBER,  description: 'Max contracts. Default: 25, max: 50' },
      },
      required: ['ticker'],
    },
  }],
}];

// ── SSE helper ────────────────────────────────────────────────────────

function sse(res: Response, data: object) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ── Main entry ────────────────────────────────────────────────────────

export async function streamChat(
  messages:     ChatMessage[],
  systemPrompt: string,
  provider:     AIProvider,
  res:          Response,
  toolExecutor?: ToolExecutor,
): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (provider === 'anthropic') {
    await streamAnthropic(messages, systemPrompt, res, toolExecutor);
  } else {
    await streamGemini(messages, systemPrompt, res, toolExecutor);
  }
}

// ── Anthropic ─────────────────────────────────────────────────────────

async function streamAnthropic(
  messages:     ChatMessage[],
  systemPrompt: string,
  res:          Response,
  toolExecutor?: ToolExecutor,
): Promise<void> {
  let anthropicMessages: Anthropic.MessageParam[] = messages.map(m => ({
    role:    m.role,
    content: m.content,
  }));

  // Tool call rounds — non-streaming so we can inspect stop_reason
  const MAX_ROUNDS = 5;
  for (let round = 0; round < MAX_ROUNDS && toolExecutor; round++) {
    const response = await anthropicClient.messages.create({
      model:    'claude-sonnet-4-6',
      max_tokens: 4096,
      system:   systemPrompt,
      messages: anthropicMessages,
      tools:    ANTHROPIC_TOOLS,
    });

    if (response.stop_reason !== 'tool_use') break;

    const toolBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of toolBlocks) {
      sse(res, { tool_call: { name: block.name, input: block.input } });
      const result = await toolExecutor(block.name, block.input as Record<string, unknown>);
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
    }

    anthropicMessages = [
      ...anthropicMessages,
      { role: 'assistant', content: response.content },
      { role: 'user',      content: toolResults },
    ];
  }

  // Final streaming response
  const stream = await anthropicClient.messages.stream({
    model:      'claude-sonnet-4-6',
    max_tokens: 4096,
    system:     systemPrompt,
    messages:   anthropicMessages,
    ...(toolExecutor ? { tools: ANTHROPIC_TOOLS } : {}),
  });

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      sse(res, { text: chunk.delta.text });
    }
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

// ── Gemini ────────────────────────────────────────────────────────────

async function streamGemini(
  messages:     ChatMessage[],
  systemPrompt: string,
  res:          Response,
  toolExecutor?: ToolExecutor,
): Promise<void> {
  const model = geminiClient.getGenerativeModel({
    model:             'gemini-2.0-flash',
    systemInstruction: systemPrompt,
    ...(toolExecutor ? { tools: GEMINI_TOOLS } : {}),
  });

  const history = messages.slice(0, -1).map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const chat        = model.startChat({ history });
  const lastMessage = messages[messages.length - 1];

  if (!toolExecutor) {
    // No tools — stream directly
    const result = await chat.sendMessageStream(lastMessage.content);
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) sse(res, { text });
    }
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  // Tool call loop — non-streaming
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sendable: any = lastMessage.content;

  for (let round = 0; round < 5; round++) {
    const result = await chat.sendMessage(sendable);
    const calls  = result.response.functionCalls() ?? [];

    if (calls.length === 0) {
      sse(res, { text: result.response.text() });
      break;
    }

    const responses = [];
    for (const call of calls) {
      sse(res, { tool_call: { name: call.name, input: call.args } });
      const toolResult = await toolExecutor(call.name, call.args as Record<string, unknown>);
      responses.push({ functionResponse: { name: call.name, response: { result: toolResult } } });
    }
    sendable = responses;
  }

  res.write('data: [DONE]\n\n');
  res.end();
}
