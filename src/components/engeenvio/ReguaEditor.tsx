import * as React from 'react'
import { Plus, Repeat, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { EngeModelo, EnvioNovo, EtapaRegua } from '@/api/engeEnvio'
import { cn } from '@/lib/utils'
import { dataBr, datasDaEtapa, diasAte, expandirRegua, hoje, novaEtapa, somarDias, somarMeses } from '@/lib/engeEnvio'
import { CanaisToggle } from './shared'

const campo = 'h-8 rounded-md border border-line bg-surface px-2 text-xs text-foreground focus:border-accent focus:outline-none'

/**
 * Montagem da régua, etapa por etapa: "30 dias antes, às 09:00, modelo X, por e-mail e WhatsApp,
 * repetindo a cada 7 dias 2 vezes". Usado na aba Modelos e réguas e no cadastro do empreendimento.
 */
export function ReguaEditor({
  etapas,
  onChange,
  modelos,
  whatsappDisponivel,
  idBase,
}: {
  etapas: EtapaRegua[]
  onChange: (etapas: EtapaRegua[]) => void
  modelos: EngeModelo[]
  whatsappDisponivel: boolean
  idBase: string
}) {
  const set = (id: string, patch: Partial<EtapaRegua>) => onChange(etapas.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  const padrao = modelos.find((m) => m.padrao)

  return (
    <div className="space-y-2">
      {etapas.length === 0 && <p className="text-sm text-foreground/50">Nenhuma etapa. Adicione a primeira abaixo.</p>}
      <ol className="space-y-2">
        {etapas.map((e, i) => (
          <li key={e.id} className="rounded-lg border border-line bg-surface/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
                {i + 1}
              </span>
              {e.momento !== 'dia' && (
                <input
                  id={`${idBase}-${e.id}-dias`}
                  type="number"
                  min={0}
                  value={e.dias}
                  onChange={(ev) => set(e.id, { dias: Math.max(0, Number(ev.target.value) || 0) })}
                  className={cn(campo, 'w-16')}
                  aria-label="Quantos dias"
                />
              )}
              <select
                id={`${idBase}-${e.id}-momento`}
                value={e.momento}
                onChange={(ev) => set(e.id, { momento: ev.target.value as EtapaRegua['momento'] })}
                className={campo}
                aria-label="Antes ou depois do vencimento"
              >
                <option value="antes">dias antes do vencimento</option>
                <option value="dia">no dia do vencimento</option>
                <option value="depois">dias depois do vencimento</option>
              </select>
              <span className="text-xs text-foreground/50">às</span>
              <input
                id={`${idBase}-${e.id}-hora`}
                type="time"
                value={e.hora}
                onChange={(ev) => set(e.id, { hora: ev.target.value || '09:00' })}
                className={campo}
                aria-label="Hora do envio"
              />
              <button
                type="button"
                onClick={() => onChange(etapas.filter((x) => x.id !== e.id))}
                className="ml-auto rounded p-1 text-foreground/40 hover:text-danger"
                aria-label={`Remover etapa ${i + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 pl-8">
              <span className="text-xs text-foreground/50">Modelo</span>
              <select
                id={`${idBase}-${e.id}-modelo`}
                value={e.modeloId ?? ''}
                onChange={(ev) => set(e.id, { modeloId: ev.target.value || null })}
                className={cn(campo, 'max-w-[240px]')}
                aria-label="Modelo da mensagem"
              >
                <option value="">Padrão{padrao ? ` (${padrao.nome})` : ''}</option>
                {modelos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
              <CanaisToggle
                idBase={`${idBase}-${e.id}-canais`}
                valor={{ email: e.email, whatsapp: e.whatsapp }}
                onChange={(v) => set(e.id, v)}
                compacto
              />
              {e.whatsapp && !whatsappDisponivel && (
                <span className="text-[11px] text-warning">WhatsApp só sai depois de configurar a NX</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 pl-8">
              <label className="inline-flex items-center gap-1.5 text-xs text-foreground/70">
                <input
                  id={`${idBase}-${e.id}-repetir`}
                  type="checkbox"
                  checked={e.repetir}
                  onChange={(ev) => set(e.id, { repetir: ev.target.checked })}
                />
                <Repeat className="h-3.5 w-3.5" /> Repetir
              </label>
              {e.repetir && (
                <>
                  <span className="text-xs text-foreground/50">a cada</span>
                  <input
                    id={`${idBase}-${e.id}-acada`}
                    type="number"
                    min={1}
                    value={e.aCada}
                    onChange={(ev) => set(e.id, { aCada: Math.max(1, Number(ev.target.value) || 1) })}
                    className={cn(campo, 'w-16')}
                    aria-label="Repetir a cada quantos dias"
                  />
                  <span className="text-xs text-foreground/50">dias,</span>
                  <input
                    id={`${idBase}-${e.id}-vezes`}
                    type="number"
                    min={1}
                    value={e.vezes}
                    onChange={(ev) => set(e.id, { vezes: Math.max(1, Number(ev.target.value) || 1) })}
                    className={cn(campo, 'w-14')}
                    aria-label="Quantas vezes repetir"
                  />
                  <span className="text-xs text-foreground/50">{e.vezes === 1 ? 'vez' : 'vezes'} a mais</span>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        leftIcon={<Plus className="h-3.5 w-3.5" />}
        onClick={() => onChange([...etapas, novaEtapa(whatsappDisponivel)])}
      >
        Adicionar etapa
      </Button>
    </div>
  )
}

/**
 * Linha do tempo de uma régua aplicada a um vencimento (de exemplo, se não houver um de verdade):
 * mostra cada envio com data, modelo e canais — é o que vai ser agendado.
 */
export function ReguaLinhaTempo({
  etapas,
  modelos,
  vencimento,
  whatsappDisponivel,
}: {
  etapas: EtapaRegua[]
  modelos: EngeModelo[]
  vencimento?: string
  whatsappDisponivel: boolean
}) {
  const venc = vencimento || somarMeses(hoje(), 3)
  const nomeModelo = (id: string | null) => modelos.find((m) => m.id === id)?.nome ?? modelos.find((m) => m.padrao)?.nome ?? 'Padrão'
  // Todas as datas (inclusive as que já passaram, riscadas) pra régua ficar fácil de entender.
  const todas = etapas
    .flatMap((e) => datasDaEtapa(e, venc).map((d) => ({ d, e })))
    .sort((a, b) => a.d.localeCompare(b.d) || a.e.hora.localeCompare(b.e.hora))
  const vaiSair = expandirRegua(etapas, venc, { whatsappDisponivel }).length

  return (
    <div className="space-y-2">
      <p className="text-xs text-foreground/50">
        {vencimento ? 'Vencimento' : 'Exemplo com vencimento'} em {dataBr(venc)}: {vaiSair} {vaiSair === 1 ? 'envio' : 'envios'}
      </p>
      <ol className="relative space-y-1.5 border-l border-line pl-4">
        {todas.map(({ d, e }, i) => {
          const passou = d <= hoje()
          const canais = [e.email && 'e-mail', e.whatsapp && whatsappDisponivel && 'WhatsApp'].filter(Boolean).join(' + ')
          // O vencimento entra na ordem certa (antes das etapas "depois do vencimento").
          const marcaVencimento = d > venc && (i === 0 || todas[i - 1].d <= venc)
          return (
            <React.Fragment key={`${d}-${e.id}-${i}`}>
              {marcaVencimento && <Vencimento venc={venc} />}
              <li className={cn('relative text-xs', passou && 'text-foreground/35 line-through')}>
                <span className={cn('absolute -left-[21px] top-1 h-2 w-2 rounded-full', passou ? 'bg-foreground/20' : 'bg-accent')} />
                <span className="tabular-nums text-foreground/80">
                  {dataBr(d)} {e.hora}
                </span>{' '}
                <span className="text-foreground/50">
                  · {textoRelativo(diasAte(venc, d))} · {nomeModelo(e.modeloId)} · {canais || 'sem canal'}
                </span>
              </li>
            </React.Fragment>
          )
        })}
        {!todas.some(({ d }) => d > venc) && <Vencimento venc={venc} />}
      </ol>
    </div>
  )
}

function Vencimento({ venc }: { venc: string }) {
  return (
    <li className="relative text-xs font-medium text-foreground">
      <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-warning" />
      {dataBr(venc)} · vencimento
    </li>
  )
}

const textoRelativo = (n: number) => (n === 0 ? 'no dia' : n > 0 ? `${n}d antes` : `${-n}d depois`)

/** Avisos a criar (gerados por uma régua ou à mão): dia/hora, modelo e canais de cada um. */
export function ListaEnviosNovos({
  envios,
  onChange,
  modelos,
  whatsappDisponivel,
  idBase,
}: {
  envios: EnvioNovo[]
  onChange: (envios: EnvioNovo[]) => void
  modelos: EngeModelo[]
  whatsappDisponivel: boolean
  idBase: string
}) {
  const padrao = modelos.find((m) => m.padrao)
  const set = (i: number, patch: Partial<EnvioNovo>) => onChange(envios.map((e, j) => (j === i ? { ...e, ...patch } : e)))
  return (
    <div className="space-y-2">
      {envios.length === 0 && <p className="text-sm text-foreground/50">Nenhum aviso.</p>}
      {envios.map((e, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-2.5 py-2">
          <input
            id={`${idBase}-${i}-quando`}
            type="datetime-local"
            value={e.enviarEm}
            onChange={(ev) => set(i, { enviarEm: ev.target.value })}
            className={campo}
            aria-label={`Dia e hora do aviso ${i + 1}`}
          />
          <select
            id={`${idBase}-${i}-modelo`}
            value={e.modeloId ?? ''}
            onChange={(ev) => set(i, { modeloId: ev.target.value || null })}
            className={cn(campo, 'max-w-[200px]')}
            aria-label={`Modelo do aviso ${i + 1}`}
          >
            <option value="">Padrão{padrao ? ` (${padrao.nome})` : ''}</option>
            {modelos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </select>
          <CanaisToggle
            idBase={`${idBase}-${i}-canais`}
            valor={{ email: e.email, whatsapp: e.whatsapp && whatsappDisponivel }}
            onChange={(v) => set(i, v)}
            compacto
          />
          <button
            type="button"
            onClick={() => onChange(envios.filter((_, j) => j !== i))}
            className="ml-auto rounded p-1 text-foreground/40 hover:text-danger"
            aria-label={`Remover aviso ${i + 1}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        leftIcon={<Plus className="h-3.5 w-3.5" />}
        onClick={() =>
          onChange([
            ...envios,
            { enviarEm: `${somarDias(hoje(), 1)}T09:00`, modeloId: null, email: true, whatsapp: whatsappDisponivel },
          ])
        }
      >
        Adicionar aviso
      </Button>
    </div>
  )
}
