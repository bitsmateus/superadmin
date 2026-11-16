import * as React from 'react'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import {
  arquivoParaBase64, dataBr, pontosService,
  type Colaborador, type Mapeamento, type PapelColuna, type PedidoDeImportacao, type PreviaDeImportacao,
} from '@/services/pontos'

const PAPEIS: { valor: PapelColuna; rotulo: string }[] = [
  { valor: 'ignorar', rotulo: 'Ignorar' },
  { valor: 'nome', rotulo: 'Nome do colaborador' },
  { valor: 'data', rotulo: 'Data' },
  { valor: 'datahora', rotulo: 'Data e hora juntas' },
  { valor: 'hora', rotulo: 'Hora (uma batida por linha)' },
  { valor: 'batida', rotulo: 'Batida (entrada/saída)' },
  { valor: 'batidas_texto', rotulo: 'Várias batidas no campo' },
]
const MAX = 5 * 1024 * 1024
const ACEITOS = ['xlsx', 'xls', 'csv']

/**
 * "Importar planilha" do Pontos: arrastar/soltar ou escolher o arquivo do relógio (.xlsx/.xls/.csv), escolher o modo
 * (mês completo ou data/período), conferir a pré-visualização (período, colaboradores, dias, batidas, avisos, conflitos)
 * e confirmar. A leitura e as regras ficam no servidor; aqui só montamos o pedido e mostramos o resultado.
 */
export function ImportarPontosModal({ open, onClose, onImportado, colaboradores }: {
  open: boolean
  onClose: () => void
  onImportado: () => void
  colaboradores: Colaborador[]
}) {
  const [arquivo, setArquivo] = React.useState<{ nome: string; base64: string } | null>(null)
  const [arrastando, setArrastando] = React.useState(false)
  const [modo, setModo] = React.useState<'mes' | 'periodo'>('mes')
  const [mes, setMes] = React.useState('')
  const [de, setDe] = React.useState('')
  const [ate, setAte] = React.useState('')
  const [mapeamentos, setMapeamentos] = React.useState<Record<string, Mapeamento>>({})
  const [associacoes, setAssociacoes] = React.useState<Record<string, string>>({})
  const [decisoes, setDecisoes] = React.useState<Record<string, 'manter' | 'substituir'>>({})
  const [previa, setPrevia] = React.useState<PreviaDeImportacao | null>(null)
  const [carregando, setCarregando] = React.useState(false)
  const [importando, setImportando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (open) return
    setArquivo(null); setModo('mes'); setMes(''); setDe(''); setAte(''); setMapeamentos({}); setAssociacoes({})
    setDecisoes({}); setPrevia(null); setErro(null)
  }, [open])

  const pedido = React.useCallback((): PedidoDeImportacao | null => {
    if (!arquivo) return null
    return {
      arquivoNome: arquivo.nome, arquivoBase64: arquivo.base64, modo,
      mes: modo === 'mes' && mes ? mes : undefined,
      de: modo === 'periodo' ? de : undefined,
      ate: modo === 'periodo' ? (ate || de) : undefined,
      mapeamentos, associacoes, decisoes,
    }
  }, [arquivo, modo, mes, de, ate, mapeamentos, associacoes, decisoes])

  // Pré-visualização: refaz quando muda o arquivo, o modo/período, o mapeamento ou a associação de nomes.
  React.useEffect(() => {
    const p = pedido()
    if (!p || (modo === 'periodo' && !de)) { setPrevia(null); return }
    let vivo = true
    setCarregando(true)
    setErro(null)
    const t = window.setTimeout(() => {
      pontosService.previa({ ...p, decisoes: {} })
        .then((r) => {
          if (!vivo) return
          setPrevia(r)
          if (modo === 'mes' && !mes && r.periodo) setMes(r.periodo.inicio.slice(0, 7))
        })
        .catch((e) => { if (vivo) { setPrevia(null); setErro((e as Error).message) } })
        .finally(() => { if (vivo) setCarregando(false) })
    }, 250)
    return () => { vivo = false; window.clearTimeout(t) }
    // decisões não mudam a leitura: ficam fora de propósito
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arquivo, modo, mes, de, ate, mapeamentos, associacoes])

  const escolher = async (f: File | undefined) => {
    if (!f) return
    const ext = (f.name.split('.').pop() ?? '').toLowerCase()
    if (!ACEITOS.includes(ext)) { toast.error('Envie um arquivo .xlsx, .xls ou .csv.'); return }
    if (f.size > MAX) { toast.error('Arquivo maior que 5 MB.'); return }
    try {
      setArquivo({ nome: f.name, base64: await arquivoParaBase64(f) })
      setMes(''); setMapeamentos({}); setAssociacoes({}); setDecisoes({})
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const confirmar = async () => {
    const p = pedido()
    if (!p) return
    setImportando(true)
    try {
      const r = await pontosService.importar(p)
      toast.success(`Importação concluída: ${r.novos} nova(s), ${r.atualizados} atualizada(s), ${r.ignorados} ignorada(s).`)
      onImportado()
      onClose()
    } catch (e) {
      toast.error((e as Error).message || 'Não deu pra importar.')
    } finally {
      setImportando(false)
    }
  }

  const abasSemMapa = previa?.abas.filter((a) => a.precisaMapeamento && !mapeamentos[a.nome]) ?? []
  const naoResolvidos = previa?.naoReconhecidos.filter((n) => !associacoes[n]) ?? []
  const podeConfirmar = !!previa?.periodo && !carregando && abasSemMapa.length === 0 && previa.colaboradores.length > 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Importar planilha do ponto"
      description="Arquivo exportado do relógio de ponto (.xlsx, .xls ou .csv, até 5 MB)."
      size="2xl"
      closeOnBackdrop={false}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void confirmar()} disabled={!podeConfirmar || importando} leftIcon={importando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}>
            Confirmar importação
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        {/* arquivo */}
        <div
          onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastando(false); void escolher(e.dataTransfer.files?.[0]) }}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors',
            arrastando ? 'border-accent bg-accent/5' : 'border-line',
          )}
        >
          {arquivo ? (
            <>
              <FileSpreadsheet className="h-7 w-7 text-success" />
              <p className="text-sm font-medium text-foreground">{arquivo.nome}</p>
              <button type="button" className="text-xs text-accent hover:underline" onClick={() => inputRef.current?.click()}>Trocar arquivo</button>
            </>
          ) : (
            <>
              <Upload className="h-7 w-7 text-foreground/40" />
              <p className="text-sm text-foreground/70">Arraste a planilha aqui</p>
              <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()}>Selecionar arquivo</Button>
            </>
          )}
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { void escolher(e.target.files?.[0]); e.target.value = '' }} />
        </div>

        {/* modo */}
        <div className="grid gap-2 sm:grid-cols-2">
          {([['mes', 'Mês completo', 'Lê o arquivo inteiro e detecta o mês pelas datas.'], ['periodo', 'Data ou período específico', 'Importa só as linhas do dia/intervalo escolhido.']] as const).map(([v, t, d]) => (
            <button
              key={v}
              type="button"
              onClick={() => setModo(v)}
              className={cn('rounded-xl border p-3 text-left transition-colors', modo === v ? 'border-accent/50 bg-accent/5' : 'border-line hover:bg-elevate/[0.03]')}
            >
              <p className="text-sm font-semibold text-foreground">{t}</p>
              <p className="text-xs text-foreground/55">{d}</p>
            </button>
          ))}
        </div>
        {modo === 'mes' ? (
          <label className="flex flex-wrap items-center gap-2 text-sm text-foreground/70">
            Mês:
            <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm" />
            {previa?.mesDetectado && <span className="text-xs text-foreground/45">detectado no arquivo: {previa.mesDetectado.split('-').reverse().join('/')}</span>}
          </label>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm text-foreground/70">
            De <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm" />
            até <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm" />
            <span className="text-xs text-foreground/45">(sem "até" = só o dia)</span>
          </div>
        )}

        {erro && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{erro}</p>}
        {carregando && <p className="inline-flex items-center gap-2 text-sm text-foreground/50"><Loader2 className="h-4 w-4 animate-spin" />Lendo a planilha…</p>}

        {previa && (
          <div className="space-y-4">
            {/* mapeamento */}
            {previa.abas.filter((a) => a.precisaMapeamento || mapeamentos[a.nome]).map((a) => (
              <MapeamentoDaAba
                key={a.nome}
                aba={a}
                atual={mapeamentos[a.nome]}
                onAplicar={(m) => setMapeamentos((x) => ({ ...x, [a.nome]: m }))}
              />
            ))}

            {previa.periodo && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Numero rotulo="Período" valor={`${dataBr(previa.periodo.inicio)} – ${dataBr(previa.periodo.fim)}`} />
                <Numero rotulo="Batidas novas" valor={String(previa.contagens.novos)} />
                <Numero rotulo="Completam dias" valor={String(previa.contagens.atualizados)} />
                <Numero rotulo="Ignoradas" valor={String(previa.contagens.ignorados)} />
              </div>
            )}

            {previa.colaboradores.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/45">Colaboradores encontrados</p>
                <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                  {previa.colaboradores.map((c) => (
                    <li key={c.colaboradorId} className="flex justify-between px-3 py-2">
                      <span className="font-medium text-foreground">{c.nome}</span>
                      <span className="text-foreground/55">{c.dias} dia(s) · {c.batidas} batida(s)</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {previa.naoReconhecidos.length > 0 && (
              <div className="rounded-xl border border-warning/40 bg-warning/5 p-3">
                <p className="mb-2 text-sm font-semibold text-foreground">Nomes que não bateram com o cadastro</p>
                <div className="space-y-2">
                  {previa.naoReconhecidos.map((n) => (
                    <label key={n} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="min-w-[10rem] font-medium">{n}</span>
                      <select
                        value={associacoes[n] ?? ''}
                        onChange={(e) => setAssociacoes((x) => ({ ...x, [n]: e.target.value }))}
                        className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm"
                      >
                        <option value="">Escolha…</option>
                        {colaboradores.filter((c) => c.ativo).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                        <option value="ignorar">Ignorar esse nome</option>
                      </select>
                    </label>
                  ))}
                </div>
                {naoResolvidos.length > 0 && <p className="mt-2 text-xs text-foreground/55">Nome sem escolha fica de fora desta importação.</p>}
              </div>
            )}

            {previa.conflitos.length > 0 && (
              <div className="rounded-xl border border-line p-3">
                <p className="mb-2 text-sm font-semibold text-foreground">Dias com batida diferente da que já está no sistema</p>
                <div className="space-y-2">
                  {previa.conflitos.map((c) => (
                    <div key={c.chave} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="min-w-[9rem] font-medium">{c.nome} · {dataBr(c.data)}</span>
                      <span className="text-foreground/55">atual: {c.atuais.join(' ')}</span>
                      <span className="text-foreground/55">planilha: {c.novas.join(' ')}</span>
                      <select
                        value={decisoes[c.chave] ?? 'manter'}
                        onChange={(e) => setDecisoes((x) => ({ ...x, [c.chave]: e.target.value as 'manter' | 'substituir' }))}
                        className="ml-auto rounded-lg border border-line bg-card px-2 py-1 text-sm"
                      >
                        <option value="manter">Manter a atual</option>
                        <option value="substituir">Substituir pela nova</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(previa.avisos.length > 0 || previa.totalInvalidas > 0) && (
              <div className="rounded-xl bg-elevate/[0.04] p-3 text-xs text-foreground/70">
                <p className="mb-1 inline-flex items-center gap-1.5 font-semibold text-foreground"><AlertTriangle className="h-3.5 w-3.5 text-warning" />Avisos</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {previa.avisos.map((a, i) => <li key={i}>{a}</li>)}
                  {previa.invalidas.slice(0, 20).map((l, i) => <li key={`i${i}`}>Linha {l.linha} ({l.aba}): {l.motivo}</li>)}
                  {previa.totalInvalidas > 20 && <li>… e mais {previa.totalInvalidas - 20} linha(s) inválida(s).</li>}
                </ul>
              </div>
            )}

            {!previa.colaboradores.length && !abasSemMapa.length && (
              <p className="text-sm text-foreground/55">Nenhuma batida de colaborador cadastrado no período. Confira o período e os nomes.</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-xl bg-elevate/[0.04] p-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-foreground/45">{rotulo}</p>
      <p className="text-sm font-semibold tabular-nums text-foreground">{valor}</p>
    </div>
  )
}

/** Tela rápida de mapeamento: escolher a linha do cabeçalho e o papel de cada coluna. Fica salvo na importação. */
function MapeamentoDaAba({ aba, atual, onAplicar }: {
  aba: PreviaDeImportacao['abas'][number]
  atual?: Mapeamento
  onAplicar: (m: Mapeamento) => void
}) {
  const [linha, setLinha] = React.useState(atual?.linhaCabecalho ?? aba.mapeamento?.linhaCabecalho ?? 0)
  const [colunas, setColunas] = React.useState<Record<string, PapelColuna>>(atual?.colunas ?? aba.mapeamento?.colunas ?? {})
  const largura = Math.max(aba.cabecalhos.length, ...aba.amostra.map((l) => l.length))
  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
      <p className="text-sm font-semibold text-foreground">Mapear colunas — aba “{aba.nome}”</p>
      <p className="mb-2 text-xs text-foreground/55">Não reconheci todas as colunas. Diga o que é cada uma: fica salvo pras próximas importações.</p>
      <label className="mb-2 flex items-center gap-2 text-xs text-foreground/70">
        Linha do cabeçalho:
        <input type="number" min={1} value={linha + 1} onChange={(e) => setLinha(Math.max(0, Number(e.target.value) - 1))} className="w-16 rounded border border-line bg-card px-1.5 py-1" />
      </label>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr>
              {Array.from({ length: largura }, (_, i) => (
                <th key={i} className="px-1.5 py-1 text-left font-normal">
                  <select
                    value={colunas[String(i)] ?? 'ignorar'}
                    onChange={(e) => setColunas((c) => ({ ...c, [String(i)]: e.target.value as PapelColuna }))}
                    className="w-full min-w-[8rem] rounded border border-line bg-card px-1 py-1"
                  >
                    {PAPEIS.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
                  </select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {aba.amostra.map((l, r) => (
              <tr key={r} className={r === 0 ? 'font-semibold' : ''}>
                {Array.from({ length: largura }, (_, i) => <td key={i} className="max-w-[10rem] truncate border-t border-line px-1.5 py-1">{l[i] ?? ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex justify-end">
        <Button size="sm" onClick={() => onAplicar({ linhaCabecalho: linha, colunas })}>Aplicar mapeamento</Button>
      </div>
    </div>
  )
}
