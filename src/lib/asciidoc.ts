import Asciidoctor from '@asciidoctor/core';

const asciidoctor = Asciidoctor();

export function renderAsciidoc(content: string): string {
  return asciidoctor.convert(content, {
    safe: 'safe',
    attributes: { showtitle: true },
  }) as string;
}
