import { Injectable } from '@nestjs/common';
import { messagesPtBr } from './messages.pt-br';
import { messagesEnUs } from './messages.en-us';

type Lang = 'pt-BR' | 'en-US';

@Injectable()
export class I18nService {
  private readonly dictionaries: Record<Lang, Record<string, string>> = {
    'pt-BR': messagesPtBr,
    'en-US': messagesEnUs,
  };

  resolveLang(input?: string | null): Lang {
    const value = String(input ?? '').toLowerCase();
    if (value.startsWith('en')) return 'en-US';
    if (value.startsWith('pt')) return 'pt-BR';

    const envLang = String(process.env.APP_LANG ?? '').toLowerCase();
    if (envLang.startsWith('en')) return 'en-US';
    if (envLang.startsWith('pt')) return 'pt-BR';
    return 'pt-BR';
  }

  t(key: string, params?: Record<string, unknown>, langInput?: string | null): string {
    const lang = this.resolveLang(langInput);
    const template =
      this.dictionaries[lang][key] ??
      this.dictionaries['pt-BR'][key] ??
      key;

    if (!params) return template;

    return template.replace(/\{(\w+)\}/g, (_match, token: string) => {
      const value = params[token];
      return value === undefined || value === null ? '' : String(value);
    });
  }
}
