import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { Response } from 'express';

export type AIProvider = 'anthropic' | 'gemini';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type ToolExecutor = (name: string, input: Record<string, unknown>) => Promise<string>;

const getAnthropicClient = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const getGeminiClient    = () => new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');

// ── Tool definitions ──────────────────────────────────────────────────

const TOOL_DESCRIPTION = `Fetch a filtered options chain for a stock ticker. Use this when the user asks about options trades, wants to find contracts, or when you need current option prices to make a recommendation.

Returns contracts with: strike, expiry, DTE, bid/ask/mid price, IV%, delta, volume, and open interest.

HOW TO GET THE RIGHT STRIKES — READ THIS CAREFULLY:

1. NARROW THE DTE WINDOW around your target expiry. The results are split equally across all expiries in the window. With dte_min=20 dte_max=90 you might have 12+ expiries, each getting only ~8 strikes. If you want the Jun 20 expiry (~54 DTE), use dte_min=50 dte_max=58 — all 100 results go to that one date.

2. ALWAYS USE delta_min/delta_max when you have a delta target. These filters apply BEFORE the max_results cap, so you never waste slots on strikes outside your zone. For a 0.15–0.30Δ covered call: delta_min=0.15 delta_max=0.30.

3. otm_only=true IS THE DEFAULT and is almost always correct. For covered calls, CSPs, and most selling strategies, every interesting strike is OTM. Only set otm_only=false if you explicitly need ITM or ATM contracts.

4. IF YOU DON'T GET THE STRIKE YOU NEED: call again with a narrower DTE window (±5 days around the target expiry) and/or add a delta_min/delta_max range. Never tell the user you can't find a strike without making at least one follow-up call with tighter parameters.

5. Use price_min/price_max to filter by option mid (premium budget). Use strike_min/strike_max when you know the exact price range you want.`;

const PRICE_TOOL_DESCRIPTION = `Look up the current price and Greeks for one specific option contract you already know (ticker + type + strike + expiration).

Use this when:
- You know the exact contract and want its current bid/ask/mid/IV/delta
- The user asks about a specific position they hold (e.g. "what is my MSFT $480 call worth?")
- You want to verify a contract's price after recommending it

Do NOT use this to browse or discover strikes — use get_option_chain for that.
Returns: bid, ask, mid, last, IV%, delta, volume, open interest, DTE, and underlying price.
Returns "not found" if the contract has no market or doesn't exist on CBOE.`;

const ANTHROPIC_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_option_chain',
    description: TOOL_DESCRIPTION,
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker:      { type: 'string',  description: 'Stock ticker e.g. AAPL, MSFT' },
        type:        { type: 'string',  description: 'Option type: "calls" or "puts". Always specify — never omit. Use "calls" for covered calls / bullish plays, "puts" for cash-secured puts / bearish plays.' },
        dte_min:     { type: 'number',  description: 'Min days to expiration. Default: 20' },
        dte_max:     { type: 'number',  description: 'Max days to expiration. Default: 90' },
        otm_only:    { type: 'boolean', description: 'Only return out-of-the-money options. Default: true' },
        max_results: { type: 'number',  description: 'Max contracts to return. Default: 100, max: 120.' },
        delta_min:   { type: 'number',  description: 'Min absolute delta (0–1). Applied before max_results cap. e.g. 0.10 to exclude near-zero delta contracts.' },
        delta_max:   { type: 'number',  description: 'Max absolute delta (0–1). Applied before max_results cap. e.g. 0.35 to exclude deep ITM contracts.' },
        strike_min:  { type: 'number',  description: 'Min strike price. Applied before max_results cap.' },
        strike_max:  { type: 'number',  description: 'Max strike price. Applied before max_results cap.' },
        price_min:   { type: 'number',  description: 'Min option mid price (premium). Applied before max_results cap. e.g. 0.50 to exclude illiquid contracts.' },
        price_max:   { type: 'number',  description: 'Max option mid price (premium). Applied before max_results cap. e.g. 5.00 for budget-constrained strategies.' },
      },
      required: ['ticker', 'type'],
    },
  },
  {
    name: 'get_option_price',
    description: PRICE_TOOL_DESCRIPTION,
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker:     { type: 'string', description: 'Stock ticker e.g. AAPL, MSFT' },
        type:       { type: 'string', description: '"call" or "put"' },
        strike:     { type: 'number', description: 'Strike price e.g. 480' },
        expiration: { type: 'string', description: 'Expiration date in YYYY-MM-DD format e.g. 2026-05-15' },
      },
      required: ['ticker', 'type', 'strike', 'expiration'],
    },
  },
];

const GEMINI_TOOLS = [{
  functionDeclarations: [
    {
      name: 'get_option_chain',
      description: TOOL_DESCRIPTION,
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          ticker:      { type: SchemaType.STRING,  description: 'Stock ticker e.g. AAPL, MSFT' },
          type:        { type: SchemaType.STRING,  description: 'Option type: "calls" or "puts". Always specify — never omit.' },
          dte_min:     { type: SchemaType.NUMBER,  description: 'Min days to expiration. Default: 20' },
          dte_max:     { type: SchemaType.NUMBER,  description: 'Max days to expiration. Default: 90' },
          otm_only:    { type: SchemaType.BOOLEAN, description: 'Only OTM options. Default: true' },
          max_results: { type: SchemaType.NUMBER,  description: 'Max contracts. Default: 100, max: 120.' },
          delta_min:   { type: SchemaType.NUMBER,  description: 'Min absolute delta (0–1), applied before cap.' },
          delta_max:   { type: SchemaType.NUMBER,  description: 'Max absolute delta (0–1), applied before cap.' },
          strike_min:  { type: SchemaType.NUMBER,  description: 'Min strike price, applied before cap.' },
          strike_max:  { type: SchemaType.NUMBER,  description: 'Max strike price, applied before cap.' },
          price_min:   { type: SchemaType.NUMBER,  description: 'Min option mid price, applied before cap.' },
          price_max:   { type: SchemaType.NUMBER,  description: 'Max option mid price, applied before cap.' },
        },
        required: ['ticker', 'type'],
      },
    },
    {
      name: 'get_option_price',
      description: PRICE_TOOL_DESCRIPTION,
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          ticker:     { type: SchemaType.STRING, description: 'Stock ticker' },
          type:       { type: SchemaType.STRING, description: '"call" or "put"' },
          strike:     { type: SchemaType.NUMBER, description: 'Strike price' },
          expiration: { type: SchemaType.STRING, description: 'Expiration date YYYY-MM-DD' },
        },
        required: ['ticker', 'type', 'strike', 'expiration'],
      },
    },
  ],
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
  model?:        string,
): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (provider === 'anthropic') {
    await streamAnthropic(messages, systemPrompt, res, toolExecutor, model ?? 'claude-sonnet-4-6');
  } else {
    await streamGemini(messages, systemPrompt, res, toolExecutor, model ?? 'gemini-2.0-flash');
  }
}

// ── Anthropic ─────────────────────────────────────────────────────────

async function streamAnthropic(
  messages:     ChatMessage[],
  systemPrompt: string,
  res:          Response,
  toolExecutor?: ToolExecutor,
  model = 'claude-sonnet-4-6',
): Promise<void> {
  let anthropicMessages: Anthropic.MessageParam[] = messages.map(m => ({
    role:    m.role,
    content: m.content,
  }));

  // Tool call rounds — non-streaming so we can inspect stop_reason
  const MAX_ROUNDS = 5;
  for (let round = 0; round < MAX_ROUNDS && toolExecutor; round++) {
    const response = await getAnthropicClient().messages.create({
      model,
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
  const stream = await getAnthropicClient().messages.stream({
    model,
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
  modelId = 'gemini-2.0-flash',
): Promise<void> {
  const model = getGeminiClient().getGenerativeModel({
    model:             modelId,
    systemInstruction: systemPrompt,
    ...(toolExecutor ? { tools: GEMINI_TOOLS } : {}),
  });

  // Gemini requires history to start with a 'user' turn — drop any leading assistant messages
  const allHistory = messages.slice(0, -1).map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const firstUser = allHistory.findIndex(m => m.role === 'user');
  const history = firstUser >= 0 ? allHistory.slice(firstUser) : [];

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
