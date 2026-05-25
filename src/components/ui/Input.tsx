import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  containerClassName?: string
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    { className, containerClassName, label, hint, error, leftIcon, rightIcon, id, ...rest },
    ref,
  ) => {
    const inputId = id || React.useId()
    return (
      <div className={cn('w-full', containerClassName)}>
        {label && (
          <label
            htmlFor={inputId}
            className="mb-1.5 block text-xs font-medium text-foreground/70"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'h-10 w-full rounded-lg bg-surface px-3 text-sm text-foreground',
              'border border-elevate/10 placeholder:text-foreground/30',
              'transition-colors focus:outline-none',
              'focus:border-accent focus:ring-4 focus:ring-accent/15',
              leftIcon && 'pl-9',
              rightIcon && 'pr-9',
              error && 'border-danger/60 focus:border-danger focus:ring-danger/15',
              className,
            )}
            {...rest}
          />
          {rightIcon && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/40">
              {rightIcon}
            </span>
          )}
        </div>
        {(hint || error) && (
          <p
            className={cn(
              'mt-1.5 text-xs',
              error ? 'text-danger' : 'text-foreground/40',
            )}
          >
            {error || hint}
          </p>
        )}
      </div>
    )
  },
)
Input.displayName = 'Input'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: string
  error?: string
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, hint, error, id, ...rest }, ref) => {
    const inputId = id || React.useId()
    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="mb-1.5 block text-xs font-medium text-foreground/70"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={cn(
            'w-full rounded-lg bg-surface px-3 py-2 text-sm text-foreground',
            'border border-elevate/10 placeholder:text-foreground/30',
            'transition-colors focus:outline-none min-h-[90px] resize-y',
            'focus:border-accent focus:ring-4 focus:ring-accent/15',
            error && 'border-danger/60 focus:border-danger focus:ring-danger/15',
            className,
          )}
          {...rest}
        />
        {(hint || error) && (
          <p
            className={cn(
              'mt-1.5 text-xs',
              error ? 'text-danger' : 'text-foreground/40',
            )}
          >
            {error || hint}
          </p>
        )}
      </div>
    )
  },
)
Textarea.displayName = 'Textarea'
