import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-ember-500 text-coal-950 hover:bg-ember-400 disabled:bg-coal-600 disabled:text-coal-400',
  secondary: 'bg-coal-800 text-coal-100 border border-coal-600 hover:bg-coal-700 disabled:opacity-50',
  danger: 'bg-chili-500 text-white hover:bg-chili-400 disabled:bg-coal-600 disabled:text-coal-400',
  ghost: 'text-coal-300 hover:bg-coal-800 hover:text-coal-100 disabled:opacity-50',
};

export function Button({ variant = 'primary', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={cx('inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed', variants[variant], className)}
    />
  );
}

export function LinkButton({ variant = 'primary', className, ...props }: HTMLAttributes<HTMLAnchorElement> & { href: string; variant?: Variant; target?: string; rel?: string }) {
  return <a {...props} className={cx('inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition', variants[variant], className)} />;
}

export function Card({ className, children, ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return (
    <section {...props} className={cx('rounded-xl border border-coal-700 bg-coal-900 p-5', className)}>
      {children}
    </section>
  );
}

export function CardTitle({ children, description, actions }: { children: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-coal-100">{children}</h2>
        {description ? <p className="mt-1 text-sm text-coal-400">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'ember' | 'info';
const tones: Record<Tone, string> = {
  neutral: 'bg-coal-800 text-coal-300 border-coal-600',
  ok: 'bg-basil-500/10 text-basil-400 border-basil-500/30',
  warn: 'bg-saffron-400/10 text-saffron-400 border-saffron-400/30',
  danger: 'bg-chili-500/10 text-chili-400 border-chili-500/30',
  ember: 'bg-ember-500/10 text-ember-300 border-ember-500/30',
  info: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>;
}

export function Alert({ tone = 'info', title, children }: { tone?: Tone; title?: ReactNode; children?: ReactNode }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('rounded-lg border px-4 py-3 text-sm', tones[tone])}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={cx(title ? 'mt-1' : '', 'text-coal-300')}>{children}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-coal-600 px-6 py-10 text-center">
      <span aria-hidden className="text-3xl">🍽️</span>
      <p className="font-semibold">{title}</p>
      {children ? <p className="max-w-md text-sm text-coal-400">{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-coal-400">
      <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-coal-600 border-t-ember-400" />
      {label}
    </span>
  );
}

export function PageHeader({ title, description, actions, emoji }: { title: string; description?: ReactNode; actions?: ReactNode; emoji?: string }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          {emoji ? <span aria-hidden>{emoji}</span> : null}
          {title}
        </h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-coal-400">{description}</p> : null}
      </div>
      {actions}
    </header>
  );
}

const inputClass =
  'w-full rounded-lg border border-coal-600 bg-coal-850 px-3 py-2 text-sm text-coal-100 placeholder:text-coal-500 focus:border-ember-400 disabled:opacity-60';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputClass, 'min-h-24', props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputClass, props.className)} />;
}

export function Field({ label, htmlFor, help, error, children }: { label: string; htmlFor: string; help?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-coal-300">
        {label}
      </label>
      {children}
      {help ? <p id={`${htmlFor}-help`} className="text-xs text-coal-500">{help}</p> : null}
      {error ? <p className="text-xs text-chili-400" role="alert">{error}</p> : null}
    </div>
  );
}

/** Accessible switch (role="switch", Space/Enter toggle via native button). */
export function Toggle({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition disabled:opacity-50',
        checked ? 'border-ember-500 bg-ember-500' : 'border-coal-600 bg-coal-700',
      )}
    >
      <span className={cx('inline-block h-4 w-4 rounded-full bg-white shadow transition', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-coal-700 bg-coal-900 p-4">
      <p className="text-xs uppercase tracking-wide text-coal-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-coal-400">{hint}</p> : null}
    </div>
  );
}

export function Table({ head, children, caption }: { head: ReactNode[]; children: ReactNode; caption?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-coal-700">
      <table className="w-full text-left text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="bg-coal-850 text-xs uppercase tracking-wide text-coal-400">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-coal-800">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cx('px-4 py-3 align-top', className)}>{children}</td>;
}
