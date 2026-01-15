import { Pipe, PipeTransform } from '@angular/core';
import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

// Wire highlight via plugin (correct for modern marked)
marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code: string, lang?: string) {
      const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  })
);

// Optional: other marked options
marked.setOptions({
  gfm: true,
  breaks: true,
});

@Pipe({ name: 'md', standalone: true })
export class MarkdownPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '';
    const html = marked.parse(value) as string;
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  }
}
