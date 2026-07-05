import type { ModelMessage as ModelMessageV7, UIMessage as UIMessageV7 } from '@internal/ai-v7';
import { describe, expect, it } from 'vitest';

import { convertMessages } from '../..';
import { MessageList } from '../../index';
import type { MessageInput, MessageListInput } from '../types';

describe('MessageList AI SDK v7 input support', () => {
  // Regression for #18956: the MessageInput union never gained the @internal/ai-v7
  // branch, so an ai@7 ModelMessage / UIMessage was not assignable to
  // Agent#generate / stream / MessageList.add and failed to type-check. These plain
  // typed assignments mirror the real generate(messages) call site — reverting the
  // v7 branch makes the package fail to type-check here.
  it('accepts ai@7 ModelMessage and UIMessage at the type level', () => {
    const modelMessages: ModelMessageV7[] = [{ role: 'user', content: 'hi' }];
    const uiMessages: UIMessageV7[] = [{ id: 'm', role: 'user', parts: [{ type: 'text', text: 'hi' }] }];

    const modelInput: MessageInput = modelMessages[0]!;
    const uiInput: MessageInput = uiMessages[0]!;
    const listModel: MessageListInput = modelMessages;
    const listUi: MessageListInput = uiMessages;

    expect([modelInput, uiInput, listModel, listUi]).toBeDefined();
  });

  it('adds a v7 model message with string content', () => {
    const messages: ModelMessageV7[] = [{ role: 'user', content: 'hi from v7' }];

    const db = new MessageList().add(messages, 'input').get.all.db();

    expect(db).toHaveLength(1);
    expect(db[0]?.role).toBe('user');
    expect(db[0]?.content.parts).toMatchObject([{ type: 'text', text: 'hi from v7' }]);
  });

  it('adds a v7 model message with a tool call', () => {
    const messages: ModelMessageV7[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'search',
            input: { query: 'weather' },
          },
        ],
      },
    ];

    const db = new MessageList().add(messages, 'response').get.all.db();

    expect(db[0]?.content.parts).toMatchObject([
      {
        type: 'tool-invocation',
        toolInvocation: {
          toolName: 'search',
          toolCallId: 'call-1',
          state: 'call',
          args: { query: 'weather' },
        },
      },
    ]);
  });

  it('supports v7 UI messages through convertMessages()', () => {
    const messages: UIMessageV7[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'hello from v7' }],
      },
    ];

    const result = convertMessages(messages).to('AIV6.UI');

    expect(result[0]).toMatchObject({
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hello from v7' }],
    });
  });
});
