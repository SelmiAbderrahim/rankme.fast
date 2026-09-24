/**
 * Holders for the AI Assistant chat module.
 *
 * The composition roots (`server.ts`; tests) inject the configured
 * `AiChatProvider`. Loud
 * throws on read-before-set — the same pattern as the other module holders.
 */
import type { AiChatProvider } from '../../shared/providers/index.js';
let chatAiProvider: AiChatProvider | null = null;
export function setChatAiProvider(provider: AiChatProvider | null): void {
    chatAiProvider = provider;
}
export function getChatAiProvider(): AiChatProvider {
    if (!chatAiProvider) {
        throw new Error('Chat AI provider not initialized — call setChatAiProvider() at boot');
    }
    return chatAiProvider;
}
