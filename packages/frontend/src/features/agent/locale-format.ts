export const formatAgentNumber = (locale: string, value: number, options?: Intl.NumberFormatOptions): string =>
  new Intl.NumberFormat(locale, options).format(value);

export const formatAgentDate = (locale: string, value: Date, options?: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat(locale, options).format(value);

export const formatAgentDateTime = (locale: string, value: Date): string =>
  formatAgentDate(locale, value, { dateStyle: 'medium', timeStyle: 'short' });

export const formatAgentTime = (locale: string, value: Date): string =>
  formatAgentDate(locale, value, { hour: '2-digit', minute: '2-digit' });
