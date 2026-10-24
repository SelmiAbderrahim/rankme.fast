import fontkit, { type Font } from '@pdf-lib/fontkit';

// Lines are shaped and reordered before drawing. The runtime's direction
// argument prevents fontkit from reversing their glyphs a second time;
// its bundled TypeScript declarations omit this supported argument.
type VisualLayout = (text: string, features: Parameters<Font['layout']>[1], script: undefined, language: undefined, direction: 'ltr') => ReturnType<Font['layout']>;

export const visualOrderFontkit = {
    create(bytes: Uint8Array, postscriptName?: string): Font {
        const font = fontkit.create(bytes, postscriptName);
        const layout = font.layout.bind(font) as VisualLayout;
        font.layout = (text, features) => layout(text, features, undefined, undefined, 'ltr');
        return font;
    },
};
