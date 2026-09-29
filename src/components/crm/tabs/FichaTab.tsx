import * as React from 'react'
import { toast } from 'sonner'
import { Check, ClipboardList, Copy } from 'lucide-react'
import { Section } from '../ClientDrawer'
import { asText } from '@/lib/utils'
import type { Client } from '@/types/client'

/** Aba "Ficha de cadastro" — dados que o cliente preencheu no formulário público. */
export function FichaTab({ client }: { client: Client }) {
  const f = client.fichaCadastro

  const campos = React.useMemo(
    () =>
      !f
        ? []
        : [
            { k: 'Empresa', v: client.company, full: false },
            { k: 'CNPJ', v: f.cnpj, full: false },
            { k: 'CPF do responsável', v: f.cpfResponsavel, full: false },
            { k: 'Melhor dia de pagamento', v: f.paymentDay, full: false },
            { k: 'Precisa de Nota Fiscal?', v: f.needsNF == null ? undefined : f.needsNF ? 'Sim' : 'Não', full: false },
            { k: 'Número (NF+Boleto)', v: f.nfNumber, full: false },
            { k: 'E-mail (NF+Boleto)', v: f.nfEmail, full: false },
            { k: 'Endereço completo', v: f.address, full: true },
          ],
    [client.company, f],
  )

  /**
   * Copiar a ficha pra fora (Google Docs, e-mail, WhatsApp) tem que sair como TEXTO — sem a cor do
   * tema junto. O navegador copia a cor calculada do que está na tela, então no tema escuro o texto
   * chegava branco no Docs e sumia na folha branca, obrigando a pintar de preto na mão.
   *
   * Aqui a seleção é reescrita na hora de copiar: o formato texto vai igualzinho, e o formato HTML
   * vai sem nenhuma cor — assim quem recebe aplica a cor do próprio documento.
   */
  const aoCopiar = (e: React.ClipboardEvent) => {
    const selecao = window.getSelection()?.toString()
    if (!selecao) return
    e.preventDefault()
    e.clipboardData.setData('text/plain', selecao)
    e.clipboardData.setData(
      'text/html',
      `<span style="color:inherit;background:transparent">${escaparHtml(selecao).replace(/\n/g, '<br>')}</span>`,
    )
  }

  if (!f) {
    return (
      <div className="rounded-xl border border-line bg-card px-4 py-10 text-center text-sm text-foreground/45">
        Este cliente não preencheu a ficha de cadastro pública.
      </div>
    )
  }

  const fichaEmTexto = campos
    .filter((c) => asText(c.v, '') !== '')
    .map((c) => `${c.k}: ${asText(c.v, '')}`)
    .join('\n')

  return (
    <div className="space-y-4" onCopy={aoCopiar}>
      <Section
        title={
          <span className="flex items-center gap-2">
            <ClipboardList className="h-3.5 w-3.5 text-accent" />
            Ficha de cadastro
          </span>
        }
        action={<BotaoCopiar texto={fichaEmTexto} rotulo="Copiar ficha" aviso="Ficha copiada" />}
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {campos.map((c) => (
            <Row key={c.k} k={c.k} v={c.v} full={c.full} />
          ))}
        </dl>
        {f.submittedAt && (
          <p className="mt-4 text-[11px] text-foreground/40">
            Preenchida em {new Date(f.submittedAt).toLocaleString('pt-BR')}
          </p>
        )}
      </Section>
    </div>
  )
}

function Row({ k, v, full }: { k: string; v?: string; full?: boolean }) {
  const valor = asText(v, '—')
  return (
    <div className={full ? 'group sm:col-span-2' : 'group'}>
      <dt className="text-[11px] uppercase tracking-wider text-foreground/40">{k}</dt>
      <dd className="mt-0.5 flex items-center gap-1.5 text-sm text-foreground/85">
        <span>{valor}</span>
        {valor !== '—' && <BotaoCopiar texto={valor} aviso={`${k} copiado`} discreto />}
      </dd>
    </div>
  )
}

/** Copia texto puro — o que cola no Docs herda a formatação de lá, sem cor nenhuma vinda daqui. */
function BotaoCopiar({ texto, rotulo, aviso, discreto }: {
  texto: string; rotulo?: string; aviso: string; discreto?: boolean
}) {
  const [copiado, setCopiado] = React.useState(false)

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
      if (rotulo) toast.success(aviso)
    } catch {
      toast.error('O navegador bloqueou a cópia')
    }
  }

  const Icone = copiado ? Check : Copy

  if (discreto) {
    return (
      <button
        type="button"
        onClick={copiar}
        title={aviso}
        className={cnDiscreto(copiado)}
      >
        <Icone className="h-3 w-3" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={copiar}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-foreground/55 transition-colors hover:bg-elevate/[0.06] hover:text-foreground"
    >
      <Icone className={copiado ? 'h-3.5 w-3.5 text-success' : 'h-3.5 w-3.5'} />
      {copiado ? 'Copiado' : rotulo}
    </button>
  )
}

/** Some até o mouse passar pela linha — no celular fica sempre visível (não existe hover lá). */
function cnDiscreto(copiado: boolean): string {
  return [
    'grid h-5 w-5 shrink-0 place-items-center rounded transition-colors',
    copiado ? 'text-success' : 'text-foreground/30 hover:bg-elevate/[0.08] hover:text-foreground/70',
    'opacity-100 lg:opacity-0 lg:group-hover:opacity-100',
  ].join(' ')
}

function escaparHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
