/**
 * Deterministic conversation titles (no model call).
 */
import { describe, expect, it } from 'vitest';
import {
  buildConversationTitle,
  condenseTitleSubject,
  CHAT_TITLE_SUBJECT_CHARS,
} from './chat.title.js';

const build = (
  text: string,
  extra: Partial<Parameters<typeof buildConversationTitle>[0]> = {},
) =>
  buildConversationTitle({
    text,
    locale: 'en',
    siteDomain: null,
    existingTitles: [],
    ...extra,
  });

describe('condenseTitleSubject', () => {
  it('strips politeness, markdown, urls and tool directives; sentence-cases the lead clause', () => {
    expect(
      condenseTitleSubject(
        'Hi! Could you please summarize the **most important** issues. Then fix them.',
        'en',
      ),
    ).toBe('Summarize the most important issues');
    expect(condenseTitleSubject('> - `rank` drops [see](https://x.test/a) https://y.test/b now?', 'en')).toBe(
      'Rank drops see now?',
    );
    expect(condenseTitleSubject('[tool:list_sites {"locale":"de"}] show my sites', 'en')).toBe(
      'Show my sites',
    );
    expect(condenseTitleSubject('```js\nconst a = 1;\n``` explain this', 'en')).toBe('Explain this');
  });

  it('removes lead-ins in every supported language', () => {
    expect(condenseTitleSubject("s'il vous plaît analyse mes pages", 'fr')).toBe('Analyse mes pages');
    expect(condenseTitleSubject('Bitte zeig mir die Rankings', 'de')).toBe('Zeig mir die Rankings');
    expect(condenseTitleSubject('Por favor revisa mis enlaces', 'es')).toBe('Revisa mis enlaces');
    expect(condenseTitleSubject('Пожалуйста покажи клики', 'ru')).toBe('Покажи клики');
    expect(condenseTitleSubject('مرحبا ما هي النقرات', 'ar')).toBe('ما هي النقرات');
    expect(condenseTitleSubject('请问最近28天的点击量是多少', 'zh')).toBe('最近28天的点击量是多少');
    expect(condenseTitleSubject("I'd like you to check my backlinks", 'en')).toBe('Check my backlinks');
    expect(condenseTitleSubject('Thanks, help me to plan fixes', 'en')).toBe('Plan fixes');
  });

  it('returns an empty subject when nothing readable remains', () => {
    expect(condenseTitleSubject('', 'en')).toBe('');
    expect(condenseTitleSubject('\u{1F680}\u{1F389}', 'en')).toBe('');
    expect(condenseTitleSubject('https://only.example.com/path', 'en')).toBe('');
    expect(condenseTitleSubject('   \n  ', 'en')).toBe('');
  });

  it('falls back to the whole cleaned text when the lead clause has no letters', () => {
    expect(condenseTitleSubject('?? what happened to rankings', 'en')).toBe('?? what happened to rankings');
  });

  it('cuts long text on a word boundary with an ellipsis, never mid-word', () => {
    const subject = condenseTitleSubject(
      'compare the performance of every single landing page across the entire website and report problems',
      'en',
    );
    expect(subject.endsWith('…')).toBe(true);
    expect(Array.from(subject).length).toBeLessThanOrEqual(CHAT_TITLE_SUBJECT_CHARS + 1);
    expect(subject.slice(0, -1).endsWith(' ')).toBe(false);
    expect('Compare the performance of every single landing page across the entire website and report problems'.startsWith(subject.slice(0, -1))).toBe(true);
    expect('Compare the performance of every single landing page across the entire website and report problems'.charAt(subject.length - 1)).toBe(' ');
  });

  it('segments CJK text without spaces and hard-cuts one unbroken token', () => {
    const chinese = condenseTitleSubject('总结网站最近二十八天的点击量展示次数点击率平均排名以及上一周期的变化情况并给出建议和下一步行动方案说明'.repeat(2), 'zh');
    expect(chinese.endsWith('…')).toBe(true);
    expect(Array.from(chinese).length).toBeLessThanOrEqual(CHAT_TITLE_SUBJECT_CHARS + 1);
    expect(condenseTitleSubject('x'.repeat(200), 'en')).toBe(`X${'x'.repeat(59)}…`);
  });
});

describe('buildConversationTitle', () => {
  it('uses the localized untitled title when there is no subject', () => {
    expect(build('\u{1F680}', { locale: 'de' })).toBe('Neues Gespräch');
    expect(build('', { locale: 'en', existingTitles: ['New conversation'] })).toBe(
      'New conversation · 2',
    );
  });

  it('appends the site domain unless the message already names it', () => {
    expect(build('Summarize the important issues', { siteDomain: 'Example.com' })).toBe(
      'Summarize the important issues · example.com',
    );
    expect(build('How is example.com doing in search?', { siteDomain: 'example.com' })).toBe(
      'How is example.com doing in search?',
    );
    expect(build('Check https://example.com/pricing for me', { siteDomain: 'example.com' })).toBe(
      'Check for me',
    );
    expect(build('Check https://example.com/pricing for me', { siteDomain: ' ' })).toBe('Check for me');
  });

  it('bounds the appended domain and keeps the title under the model limit', () => {
    const title = build('Summarize the most important issues for me right now', {
      siteDomain: `${'a'.repeat(80)}.example.com`,
    });
    expect(Array.from(title).length).toBeLessThanOrEqual(120);
    expect(title).toContain(' · ');
  });

  it('de-duplicates case-insensitively with an incrementing counter', () => {
    const existing = ['summarize my pages', 'Summarize my pages · 2'];
    expect(build('Summarize my pages', { existingTitles: existing })).toBe('Summarize my pages · 3');
    expect(build('Summarize my pages', { existingTitles: ['x'] })).toBe('Summarize my pages');
  });
});
