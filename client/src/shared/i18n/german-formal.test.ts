/**
 * German speaks to the reader as "Sie", everywhere: the
 * app strings, the server messages, and the German docs. An informal pronoun
 * ("du", "dich", "dir", "dein…") or a second-person-singular verb ("kannst",
 * "hast", …) in a German value is a register slip, not a style choice.
 *
 * No exemptions are needed today. Example prompts the reader sends to the AI
 * assistant ("Fasse … zusammen", "Zeige mir …") are the reader's own voice and
 * contain no informal pronoun, so the rule holds for them as written.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');

const INFORMAL =
  /(?<![\p{L}\p{N}_-])(?:du|dich|dir|dein\w*|euch|euer|eure\w*|kannst|hast|bist|willst|musst|möchtest|solltest|wirst|darfst|brauchst|findest|erhältst)(?![\p{L}\p{N}_-])/iu;

const leaves = (node: unknown, path: string[] = []): Array<[string, string]> =>
  typeof node === 'string'
    ? [[path.join('.'), node]]
    : Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => leaves(value, [...path, key]));

/** Code is not prose: inline code spans and URLs never carry the register. */
const prose = (text: string): string => text.replace(/`[^`]*`/g, ' ').replace(/https?:\/\/\S+/g, ' ');

const informal = (text: string): string | null => {
  const value = prose(text);
  const pronoun = value.match(INFORMAL)?.[0];
  if (pronoun) return pronoun;
  const typo = value.match(/\b(?:Sien|Sieen)\b/u)?.[0];
  if (typo) return typo;
  if (/\b(?:Sie|Ihr\w*)\b/u.test(value)) {
    return value.match(/\b(?:oder|und)\s+(trenne|wechsle|ergänze|füge|wähle|gib|prüfe|kopiere|erstelle|öffne|nutze|verwende|starte|speichere|bestätige|lade|versuche|vergleiche)\b/u)?.[1] ?? null;
  }
  return null;
};

describe('German formal address', () => {
  it('flags informal pronouns and verb forms and accepts the formal ones', () => {
    expect(informal('Du hast deine Änderungen gespeichert.')).toBe('Du');
    expect(informal('Gib die Adresse deines Webhooks ein.')).toBe('deines');
    expect(informal('Wähle eine Website, wenn du bereit bist.')).toBe('du');
    expect(informal('Im Exportcenter kannst ihn weiterhin widerrufen.')).toBe('kannst');
    expect(informal('Dir gehört diese Website.')).toBe('Dir');
    expect(informal('Sie haben Ihre Änderungen gespeichert.')).toBeNull();
    expect(informal('Geben Sie die Adresse Ihres Webhooks ein.')).toBeNull();
    expect(informal('Führen Sie `npm run dev` aus; die Datei liegt unter `/tmp/du`.')).toBeNull();
    expect(informal('Siehe https://example.com/du/dir für Details.')).toBeNull();
    expect(informal('Das Durchschnittsrating, die Dirigentin, der Dienst')).toBeNull();
    expect(informal('Geben Sie ein Keyword ein oder trenne sie durch Kommas.')).toBe('trenne');
    expect(informal('Prüfen Sie Ihre Auswahl oder wechsle die Ansicht.')).toBe('wechsle');
    expect(informal('Speichern Sie die Liste und ergänze die Beschreibung.')).toBe('ergänze');
    expect(informal('Erstellen Sien Sie eine Datei.')).toBe('Sien');
    expect(informal('Geben Sie ein Keyword ein oder trennen Sie sie durch Kommas.')).toBeNull();
    expect(informal('Ihre Analysen und Vergleiche sind gespeichert.')).toBeNull();

  });

  it('uses "Sie" in every German app string', () => {
    const dir = join(HERE, 'locales', 'de');
    const files = readdirSync(dir).filter((file) => file.endsWith('.json'));
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      for (const [key, value] of leaves(JSON.parse(readFileSync(join(dir, file), 'utf8')))) {
        expect(informal(value), `de/${file}:${key} → ${value}`).toBeNull();
      }
    }
  });

  it('preserves the warning noun and formal documentation instructions', () => {
    const dictionary = JSON.parse(readFileSync(join(HERE, 'locales/de/contentIntelligence.json'), 'utf8'));
    expect(dictionary.warnings.keywordUnavailable).toBe('Keyword-Daten waren nicht verfügbar; deshalb fehlen Keyword-spezifische Vergleiche.');
    const docs = readFileSync(join(REPO, 'docs/looker-studio.de.md'), 'utf8');
    expect(docs).toContain('Erstellen Sie unter **Konto → API-Schlüssel** einen Schlüssel');
  });

  it('uses "Sie" in server messages and the German docs', () => {
    const server = readFileSync(join(REPO, 'server/src/shared/i18n/dictionaries/de.ts'), 'utf8');
    const source = ts.createSourceFile('de.ts', server, ts.ScriptTarget.Latest, true);
    const literals: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteral(node) && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node) && !ts.isImportDeclaration(node.parent)) literals.push(node.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(literals.length).toBeGreaterThan(100);
    for (const value of literals) expect(informal(value), value).toBeNull();

    const docs = readdirSync(join(REPO, 'docs')).filter((file) => file.endsWith('.de.md'));
    expect(docs.length).toBeGreaterThan(20);
    for (const file of docs) {
      let fenced = false;
      readFileSync(join(REPO, 'docs', file), 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (line.trimStart().startsWith('```')) fenced = !fenced;
          if (!fenced) expect(informal(line), `docs/${file}:${index + 1}`).toBeNull();
        });
    }
  });
});
