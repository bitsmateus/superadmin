import * as React from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import type { CtaConfig, StepKind } from '@/lib/demoStudio/types'
import type { Etapa, Frame } from '@/services/demoStudio'
import { urlDoArquivo } from '@/services/demoStudio'
import { TIPOS_DE_ETAPA } from './ListaEtapas'

type Alteracao = Partial<Omit<Etapa, 'id' | 'order'>>

const CAMPOS_DO_FORM = [
  { key: 'nome', label: 'Seu nome' },
  { key: 'empresa', label: 'Empresa' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'E-mail' },
  { key: 'cargo', label: 'Cargo' },
  { key: 'cnpj', label: 'CNPJ' },
]

const rotuloCampo = 'mb-1.5 block text-xs font-medium text-foreground/70'
const selectCls = 'h-9 w-full rounded-lg border border-line bg-transparent px-2 text-sm'

/** Painel de propriedades da etapa selecionada (§4.3). Cada mudança vai direto pro onChange (salvo com debounce). */
export function PainelEtapa({ etapa, frame, capitulos, onChange, onNovoCapitulo, onTrocarTela, onApagar, somenteLeitura }: {
  etapa: Etapa
  frame?: Frame
  capitulos: { id: string; name: string }[]
  onChange: (a: Alteracao) => void
  onNovoCapitulo: () => void
  onTrocarTela: () => void
  onApagar: () => void
  somenteLeitura?: boolean
}) {
  const cta: CtaConfig = etapa.cta ?? { type: 'WHATSAPP' }
  const mudarCta = (a: Partial<CtaConfig>) => onChange({ cta: { ...cta, ...a } })
  const campos = etapa.form?.fields ?? []
  const h = etapa.hotspot

  return (
    <fieldset disabled={somenteLeitura} className="space-y-4">
      <div>
        <label className={rotuloCampo} htmlFor="ds-tipo">Tipo</label>
        <select
          id="ds-tipo"
          className={selectCls}
          value={etapa.kind}
          onChange={(e) => {
            const kind = e.target.value as StepKind
            onChange({
              kind,
              ...(kind === 'CTA' && !etapa.cta ? { cta: { type: 'WHATSAPP', buttonLabel: 'Falar no WhatsApp', collect: ['nome', 'empresa'] } } : {}),
            })
          }}
        >
          {(Object.keys(TIPOS_DE_ETAPA) as StepKind[]).map((k) => <option key={k} value={k}>{TIPOS_DE_ETAPA[k].rotulo}</option>)}
        </select>
      </div>

      <div>
        <span className={rotuloCampo}>Tela</span>
        <div className="flex items-center gap-2">
          <div className="h-10 w-16 shrink-0 overflow-hidden rounded border border-line">
            {frame && <img src={urlDoArquivo(frame.thumb)} alt="" className="h-full w-full object-cover object-top" />}
          </div>
          <span className="min-w-0 flex-1 truncate text-xs text-foreground/55">{frame?.name || frame?.displayUrl || 'Tela'}</span>
          <Button size="sm" variant="outline" type="button" onClick={onTrocarTela}>Trocar</Button>
        </div>
      </div>

      <div>
        <label className={rotuloCampo} htmlFor="ds-cap">Capítulo</label>
        <div className="flex gap-2">
          <select id="ds-cap" className={selectCls} value={etapa.chapterId ?? ''} onChange={(e) => onChange({ chapterId: e.target.value || null })}>
            <option value="">Sem capítulo</option>
            {capitulos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <Button size="sm" variant="outline" type="button" onClick={onNovoCapitulo}>Novo</Button>
        </div>
        <p className="mt-1 text-[11px] text-foreground/40">Com 2 ou mais capítulos, o visitante pula entre eles pelo menu do player.</p>
      </div>

      <Input label="Título" value={etapa.title} maxLength={120} onChange={(e) => onChange({ title: e.target.value })} />
      <div>
        <Textarea label="Texto" rows={4} value={etapa.body} maxLength={600} onChange={(e) => onChange({ body: e.target.value })} />
        <p className={`mt-1 text-[11px] ${etapa.body.length > 280 ? 'text-amber-500' : 'text-foreground/40'}`}>
          {etapa.body.length}/280 · **negrito** · variáveis: {'{{empresa|sua empresa}}'}, {'{{nome}}'}, {'{{vendedor}}'}
        </p>
      </div>

      {etapa.kind === 'HOTSPOT' && (
        <>
          <div>
            <label className={rotuloCampo} htmlFor="ds-pos">Posição do balão</label>
            <select id="ds-pos" className={selectCls} value={etapa.placement} onChange={(e) => onChange({ placement: e.target.value })}>
              <option value="auto">Automática</option>
              <option value="right">Direita</option>
              <option value="left">Esquerda</option>
              <option value="bottom">Abaixo</option>
              <option value="top">Acima</option>
            </select>
            <p className="mt-1 text-[11px] text-foreground/40">No celular o balão sempre fica embaixo da tela.</p>
          </div>
          <div>
            <span className={rotuloCampo}>Destaque (px CSS do frame)</span>
            {h ? (
              <div className="grid grid-cols-4 gap-1.5">
                {(['x', 'y', 'w', 'h'] as const).map((k) => (
                  <label key={k} className="text-[11px] text-foreground/50">
                    {k}
                    <input
                      type="number"
                      className="mt-0.5 h-8 w-full rounded-md border border-line bg-transparent px-1.5 text-sm tabular-nums"
                      value={h[k]}
                      min={k === 'w' || k === 'h' ? 8 : 0}
                      onChange={(e) => {
                        const v = Math.max(0, Math.round(Number(e.target.value) || 0))
                        onChange({ hotspot: { ...h, [k]: k === 'w' || k === 'h' ? Math.max(8, v) : v } })
                      }}
                    />
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-amber-500">Arraste sobre a tela para desenhar.</p>
            )}
          </div>
        </>
      )}

      {etapa.kind !== 'CTA' && (
        <Input
          label="Rótulo do botão"
          placeholder={etapa.kind === 'HOTSPOT' ? 'Próximo' : etapa.kind === 'MODAL' ? 'Começar o tour / Continuar' : 'Continuar o tour'}
          value={etapa.buttonLabel ?? ''}
          maxLength={40}
          onChange={(e) => onChange({ buttonLabel: e.target.value || null })}
        />
      )}

      {etapa.kind === 'CTA' && (
        <div className="space-y-3 rounded-lg border border-line p-3">
          <div>
            <label className={rotuloCampo} htmlFor="ds-cta-tipo">Ação</label>
            <select id="ds-cta-tipo" className={selectCls} value={cta.type} onChange={(e) => mudarCta({ type: e.target.value as CtaConfig['type'] })}>
              <option value="WHATSAPP">Abrir WhatsApp</option>
              <option value="URL">Abrir link</option>
            </select>
          </div>
          <Input label="Texto do botão" value={cta.buttonLabel ?? ''} placeholder={cta.type === 'URL' ? 'Saiba mais' : 'Falar no WhatsApp'} onChange={(e) => mudarCta({ buttonLabel: e.target.value })} />
          {cta.type === 'WHATSAPP' ? (
            <>
              <Input label="Número (vazio = o da demo)" value={cta.phone ?? ''} placeholder="5548936181649" onChange={(e) => mudarCta({ phone: e.target.value.replace(/\D/g, '') })} />
              <Textarea
                label="Mensagem modelo"
                rows={3}
                value={cta.message ?? ''}
                placeholder="Olá! Sou {{nome}} da {{empresa}}. Acabei de ver o tour…"
                onChange={(e) => mudarCta({ message: e.target.value })}
              />
              <p className="text-[11px] text-foreground/40">Frase com variável vazia sai da mensagem (ex.: "Sou {'{{nome}}'}." some se o lead não digitou o nome).</p>
              <div className="flex gap-4 text-sm">
                {(['nome', 'empresa'] as const).map((k) => (
                  <label key={k} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={cta.collect?.includes(k) ?? false}
                      onChange={(e) => mudarCta({ collect: e.target.checked ? [...(cta.collect ?? []), k] : (cta.collect ?? []).filter((c) => c !== k) })}
                    />
                    Pedir {k}
                  </label>
                ))}
              </div>
            </>
          ) : (
            <Input label="Endereço" value={cta.url ?? ''} placeholder="https://…" onChange={(e) => mudarCta({ url: e.target.value })} />
          )}
        </div>
      )}

      {etapa.kind === 'LEAD_FORM' && (
        <div className="space-y-2 rounded-lg border border-line p-3">
          <span className={rotuloCampo}>Campos</span>
          {CAMPOS_DO_FORM.map((c) => {
            const atual = campos.find((f) => f.key === c.key)
            return (
              <div key={c.key} className="flex items-center gap-3 text-sm">
                <label className="flex flex-1 items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={!!atual}
                    onChange={(e) => onChange({
                      form: {
                        ...(etapa.form ?? {}),
                        fields: e.target.checked ? [...campos, { key: c.key, label: c.label }] : campos.filter((f) => f.key !== c.key),
                      },
                    })}
                  />
                  {c.label}
                </label>
                {atual && (
                  <label className="flex items-center gap-1 text-xs text-foreground/55">
                    <input
                      type="checkbox"
                      checked={!!atual.required}
                      onChange={(e) => onChange({
                        form: { ...(etapa.form ?? {}), fields: campos.map((f) => (f.key === c.key ? { ...f, required: e.target.checked } : f)) },
                      })}
                    />
                    obrigatório
                  </label>
                )}
              </div>
            )
          })}
          <Textarea
            label="Texto de consentimento (LGPD)"
            rows={2}
            value={etapa.form?.consentText ?? ''}
            placeholder="Ao enviar, você concorda em ser contatado pela NX Digital…"
            onChange={(e) => onChange({ form: { fields: campos, ...(etapa.form ?? {}), consentText: e.target.value } })}
          />
          <p className="text-[11px] text-foreground/40">O envio do lead para o painel entra no M3; hoje o formulário só preenche {'{{nome}}'} e {'{{empresa}}'} no resto do tour.</p>
        </div>
      )}

      {!somenteLeitura && (
        <Button variant="ghost" size="sm" type="button" className="text-red-500" leftIcon={<Trash2 className="h-4 w-4" />} onClick={onApagar}>
          Apagar etapa
        </Button>
      )}
    </fieldset>
  )
}
