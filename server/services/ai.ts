import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Response } from 'express';

export type AIProvider = 'anthropic' | 'gemini';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? '',
});

const geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');

export async function streamChat(
  messages: ChatMessage[],
  systemPrompt: string,
  provider: AIProvider,
  res: Response
): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (provider === 'anthropic') {
    await streamAnthropic(messages, systemPrompt, res);
  } else {
    await streamGemini(messages, systemPrompt, res);
  }
}

async function streamAnthropic(
  messages: ChatMessage[],
  systemPrompt: string,
  res: Response
): Promise<void> {
  const stream = await anthropicClient.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });

  for await (const chunk of stream) {
    if (
      chunk.type === 'content_block_delta' &&
      chunk.delta.type === 'text_delta'
    ) {
      res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
    }
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

async function streamGemini(
  messages: ChatMessage[],
  systemPrompt: string,
  res: Response
): Promise<void> {
  const model = geminiClient.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
  });

  // Convert messages to Gemini history format
  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const chat = model.startChat({ history });
  const lastMessage = messages[messages.length - 1];

  const result = await chat.sendMessageStream(lastMessage.content);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }
  }

  res.write('data: [DONE]\n\n');
  res.end();
}
