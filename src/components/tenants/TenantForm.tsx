import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Building2, Hash, Mail } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import type { Tenant } from '@/types'

export const tenantSchema = z.object({
  name: z.string().min(2, 'Mínimo de 2 caracteres'),
  status: z.enum(['active', 'inactive']),
  maxUsers: z.coerce.number().int().min(1, 'Mínimo 1').max(999, 'Máx. 999'),
  maxConnections: z.coerce.number().int().min(1, 'Mínimo 1').max(999, 'Máx. 999'),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
})

export type TenantFormValues = z.infer<typeof tenantSchema>

export interface TenantFormProps {
  defaultValues?: Partial<TenantFormValues>
  initialTenant?: Tenant
  submitLabel?: string
  onSubmit: (values: TenantFormValues) => void | Promise<void>
  onCancel?: () => void
  loading?: boolean
}

function deriveStatus(t: Tenant): 'active' | 'inactive' {
  if (t.status === 'active' || t.status === 'inactive') return t.status as 'active' | 'inactive'
  if (typeof t.active === 'boolean') return t.active ? 'active' : 'inactive'
  if (typeof t.is_active === 'boolean') return t.is_active ? 'active' : 'inactive'
  if (typeof t.status === 'string') {
    const s = t.status.toLowerCase()
    if (s === 'ativo' || s === 'enabled' || s === '1' || s === 'true') return 'active'
  }
  return 'active'
}

function asNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v)
  return fallback
}

export function TenantForm({
  defaultValues,
  initialTenant,
  submitLabel = 'Salvar',
  onSubmit,
  onCancel,
  loading,
}: TenantFormProps) {
  const merged = React.useMemo<Partial<TenantFormValues>>(() => {
    if (initialTenant) {
      return {
        name: initialTenant.name ?? '',
        status: deriveStatus(initialTenant),
        maxUsers: asNumber(initialTenant.maxUsers, 3),
        maxConnections: asNumber(initialTenant.maxConnections, 3),
        email: (initialTenant.email as string) ?? '',
      }
    }
    return {
      status: 'active',
      maxUsers: 3,
      maxConnections: 3,
      ...defaultValues,
    }
  }, [initialTenant, defaultValues])

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<TenantFormValues>({
    resolver: zodResolver(tenantSchema),
    defaultValues: merged,
    mode: 'onChange',
  })

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
    >
      <div className="sm:col-span-2">
        <Input
          label="Nome do tenant *"
          placeholder="Acme Ltda"
          leftIcon={<Building2 className="h-4 w-4" />}
          {...register('name')}
          error={errors.name?.message}
        />
      </div>

      <Select
        label="Status *"
        options={[
          { value: 'active', label: 'Ativo' },
          { value: 'inactive', label: 'Inativo' },
        ]}
        {...register('status')}
      />

      <Input
        label="E-mail de contato"
        type="email"
        placeholder="admin@empresa.com"
        leftIcon={<Mail className="h-4 w-4" />}
        {...register('email')}
        error={errors.email?.message}
      />

      <Input
        label="Máx. usuários *"
        type="number"
        min={1}
        leftIcon={<Hash className="h-4 w-4" />}
        {...register('maxUsers', { valueAsNumber: true })}
        error={errors.maxUsers?.message}
      />

      <Input
        label="Máx. conexões *"
        type="number"
        min={1}
        leftIcon={<Hash className="h-4 w-4" />}
        {...register('maxConnections', { valueAsNumber: true })}
        error={errors.maxConnections?.message}
      />

      <div className="sm:col-span-2 mt-2 flex items-center justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit" loading={loading} disabled={!isValid}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
