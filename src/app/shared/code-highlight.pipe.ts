import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import hljs from 'highlight.js';

@Pipe({ name: 'code', standalone: true })
export class CodeHighlightPipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer);

  transform(source: string | null | undefined, lang?: string): SafeHtml {
    const code = (source ?? '').toString();
    let html = '';

    try {
      if (lang && hljs.getLanguage(lang)) {
        html = hljs.highlight(code, { language: lang }).value;
      } else {
        html = hljs.highlightAuto(code).value;
      }
    } catch {
      html = this.escapeHTML(code);
    }
    // highlight.js output is safe, mark as trusted so Angular can render it
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  private escapeHTML(str: string): string {
    return str.replace(/[&<>"'`=\/]/g, function (s) {
      return ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '`': '&#96;',
        '=': '&#61;',
        '/': '&#47;'
      } as { [key: string]: string })[s];
    });
  }
}
