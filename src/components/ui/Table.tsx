import * as React from 'react'
import { cn } from '@/lib/utils'

export function Table({ className, ...rest }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card">
      <table className={cn('w-full text-left text-sm', className)} {...rest} />
    </div>
  )
}

export function THead({ className, ...rest }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        'bg-white/[0.02] text-[11px] uppercase tracking-wider text-white/45',
        className,
      )}
      {...rest}
    />
  )
}

export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />
}

export function TR({ className, ...rest }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'border-b border-line/80 last:border-b-0 transition-colors hover:bg-white/[0.03]',
        className,
      )}
      {...rest}
    />
  )
}

export function TH({ className, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn('px-4 py-2.5 font-medium select-none', className)}
      {...rest}
    />
  )
}

export function TD({ className, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('px-4 py-3.5 align-middle text-white/85', className)} {...rest} />
  )
}
