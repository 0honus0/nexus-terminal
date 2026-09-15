export interface FormControlClassOptions {
  highlight?: boolean;
  invalid?: boolean;
}

export const getFormControlClass = (options: FormControlClassOptions = {}): string => {
  const { highlight = false, invalid = false } = options;
  return [
    'w-full rounded-md border text-foreground shadow-xs outline-none transition-colors duration-150',
    invalid
      ? 'border-error'
      : highlight
        ? 'border-border focus:border-input-focus-border focus:ring-1 focus:ring-[var(--input-focus-glow)]'
        : 'border-border focus:border-foreground/30 focus:ring-0 focus:outline-none focus:shadow-none',
    'disabled:cursor-not-allowed disabled:bg-[var(--input-disabled-bg-color)]',
    'disabled:text-[var(--input-disabled-text-color)]',
  ].join(' ');
};

export const formControlBaseClass = getFormControlClass({ highlight: false });
