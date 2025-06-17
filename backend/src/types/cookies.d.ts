// Create a new file: src/types/cookie.d.ts
// This will provide type definitions for the cookie module

declare module 'cookie' {
  export interface CookieParseOptions {
    decode?: (str: string) => string;
  }

  export interface CookieSerializeOptions {
    encode?: (str: string) => string;
    maxAge?: number;
    domain?: string;
    path?: string;
    expires?: Date;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: boolean | 'lax' | 'strict' | 'none';
  }

  export function parse(str: string, options?: CookieParseOptions): Record<string, string>;
  export function serialize(name: string, value: string, options?: CookieSerializeOptions): string;
}