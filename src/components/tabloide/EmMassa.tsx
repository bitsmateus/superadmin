import * as React from 'react'
import { toast } from 'sonner'
import { baixarArquivo, lerImagem, tabloideApi, type TabloideSalvo } from '@/api/mercadoNunesTabloide'
import { FORMATOS, paginar, type DadosTabloide, type FormatoTabloide } from '../../../server/src/lib/tabloide/layout'
import { PreviaDoPost } from './Previa'
import { Modal, btnPrimario, btnSecundario, inputCls } from './EscolherFoto'

/**
 * Ações em massa do Histórico: baixar vários tabloides de uma vez (num .zip, no formato escolhido) e postar
 * vários no Instagram/Facebook — agendados ou na hora. No feed, vários tabloides viram UM carrossel.
 */

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'tabloide'

const agoraMais = (min: number) => {
  const d = new Date(Date.now() + min * 60_000)
  d.setSeconds(0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

const quandoTexto = (d: Date) => d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/** Escolher quais páginas de UM tabloide vão no post (aparece quando ele tem mais de uma). */
export function EscolherPaginas({
  dados,
  formato,
  value,
  onChange,
}: {
  dados: DadosTabloide
  formato: FormatoTabloide
  value: number[]
  onChange: (v: number[]) => void
}) {
  const paginas = paginar(dados.itens, formato, dados.porPagina)
  if (paginas.length < 2) return null
  const todas = value.length === paginas.length
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-[#7A716A]">Quais páginas postar</span>
        <button
          className="text-xs font-bold text-[#C1503F] hover:underline"
          onClick={() => onChange(todas ? [] : paginas.map((_, i) => i))}
        >
          {todas ? 'Limpar' : 'Marcar todas'}
        </button>
      </div>
      <div className="grid gap-1.5">
        {paginas.map((p, i) => (
          <label
            key={i}
            className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm ${value.includes(i) ? 'border-[#C1503F] bg-[#FCEFEC]' : 'border-[#E7E1D9] bg-white'}`}
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={value.includes(i)}
              onChange={() => onChange(value.includes(i) ? value.filter((x) => x !== i) : [...value, i].sort((a, b) => a - b))}
            />
            <span className="min-w-0">
              <b className="text-[#2A2622]">Página {i + 1}</b>{' '}
              <span className="text-xs text-[#9A928B]">· {p.length} produto{p.length !== 1 ? 's' : ''}</span>
              <span className="block truncate text-[11px] text-[#7A716A]">{p.map((it) => it.nome).filter(Boolean).join(', ')}</span>
            </span>
          </label>
        ))}
      </div>
      {value.length === 0 && <p className="mt-1 text-xs font-semibold text-red-600">Marque pelo menos uma página.</p>}
    </div>
  )
}

// ── Baixar em massa ─────────────────────────────────────────────────────────

type SaidaBaixar = { id: string; nome: string; formato: FormatoTabloide; pdf: boolean }
const SAIDAS: SaidaBaixar[] = [
  { id: 'feed', nome: 'Feed (imagem)', formato: 'feed', pdf: false },
  { id: 'story', nome: 'Story / Status (imagem)', formato: 'story', pdf: false },
  { id: 'a4', nome: 'A4 (imagem)', formato: 'a4', pdf: false },
  { id: 'a4pdf', nome: 'A4 (PDF para imprimir)', formato: 'a4', pdf: true },
]

export function ModalBaixarEmMassa({ tabloides, onFechar }: { tabloides: TabloideSalvo[]; onFechar: () => void }) {
  const [saida, setSaida] = React.useState('feed')
  const [feitos, setFeitos] = React.useState(0)
  const [baixando, setBaixando] = React.useState(false)

  const baixar = async () => {
    const s = SAIDAS.find((x) => x.id === saida)!
    setBaixando(true)
    setFeitos(0)
    try {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      const falhas: string[] = []
      for (const [i, t] of tabloides.entries()) {
        const prefixo = `${String(i + 1).padStart(2, '0')}-${slug(t.titulo)}`
        const dados = { ...t.dados, formato: s.formato }
        try {
          if (s.pdf) {
            zip.file(`${prefixo}.pdf`, await tabloideApi.exportarPdf(dados))
          } else {
            const { arquivos } = await tabloideApi.exportarPng(dados)
            for (const [n, a] of arquivos.entries()) {
              const bin = a.dataUrl.slice(a.dataUrl.indexOf(',') + 1)
              zip.file(arquivos.length > 1 ? `${prefixo}-${n + 1}.png` : `${prefixo}.png`, bin, { base64: true })
            }
          }
        } catch (e) {
          falhas.push(`${t.titulo}: ${(e as Error).message}`)
        }
        setFeitos(i + 1)
      }
      if (falhas.length === tabloides.length) throw new Error(falhas[0] ?? 'Não consegui gerar os arquivos.')
      const blob = await zip.generateAsync({ type: 'blob' })
      baixarArquivo(blob, `tabloides-${s.id}-${new Date().toISOString().slice(0, 10)}.zip`)
      if (falhas.length) toast.error(`${falhas.length} tabloide(s) não saíram: ${falhas.join(' · ')}`)
      else toast.success(`${tabloides.length} tabloide(s) baixados.`)
      onFechar()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBaixando(false)
    }
  }

  return (
    <Modal titulo={`Baixar ${tabloides.length} tabloide${tabloides.length > 1 ? 's' : ''}`} onFechar={baixando ? () => {} : onFechar} largura={480}>
      <div className="flex flex-col gap-4">
        <div>
          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-[#7A716A]">Formato</div>
          <div className="grid gap-2">
            {SAIDAS.map((s) => (
              <label
                key={s.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm ${saida === s.id ? 'border-[#C1503F] bg-[#FCEFEC]' : 'border-[#E7E1D9] bg-white'}`}
              >
                <input type="radio" checked={saida === s.id} onChange={() => setSaida(s.id)} disabled={baixando} />
                <span>
                  <b className="text-[#2A2622]">{s.nome}</b>
                  <span className="block text-[11px] text-[#9A928B]">{FORMATOS[s.formato].dica}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <p className="text-xs text-[#9A928B]">
          Os tabloides são redesenhados no formato escolhido (não muda o que está salvo) e vêm todos juntos num arquivo .zip.
        </p>
        <div className="flex items-center justify-end gap-2">
          {baixando && (
            <span className="mr-auto text-sm text-[#7A716A]">
              Gerando {feitos}/{tabloides.length}…
            </span>
          )}
          <button className={btnSecundario} onClick={onFechar} disabled={baixando}>
            Cancelar
          </button>
          <button className={btnPrimario} onClick={() => void baixar()} disabled={baixando}>
            {baixando ? 'Gerando…' : '⬇ Baixar .zip'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Postar em massa ─────────────────────────────────────────────────────────

const INTERVALOS = [
  { min: 0, rotulo: 'Todos no mesmo horário' },
  { min: 30, rotulo: 'A cada 30 minutos' },
  { min: 60, rotulo: 'A cada 1 hora' },
  { min: 120, rotulo: 'A cada 2 horas' },
  { min: 240, rotulo: 'A cada 4 horas' },
  { min: 1440, rotulo: 'Um por dia (mesmo horário)' },
]

export function ModalPostarEmMassa({ tabloides, onFechar }: { tabloides: TabloideSalvo[]; onFechar: () => void }) {
  const varios = tabloides.length > 1
  const [conta, setConta] = React.useState<{ ok: boolean; username?: string; motivo?: string } | null>(null)
  const [formato, setFormato] = React.useState<'feed' | 'story'>('feed')
  const [carrossel, setCarrossel] = React.useState(varios)
  const [facebook, setFacebook] = React.useState(false)
  const [legenda, setLegenda] = React.useState('')
  const [comIa, setComIa] = React.useState(false)
  const [quando, setQuando] = React.useState<'agora' | 'agendar'>('agora')
  const [dataHora, setDataHora] = React.useState(agoraMais(60))
  const [intervalo, setIntervalo] = React.useState(varios ? 60 : 0)
  const [etapa, setEtapa] = React.useState<'editar' | 'revisar'>('editar')
  const [paginasEscolhidas, setPaginasEscolhidas] = React.useState<number[]>(() =>
    paginar(tabloides[0].dados.itens, 'feed', tabloides[0].dados.porPagina).map((_, i) => i),
  )
  // Capa manual (opcional): entra como 1ª imagem de cada post.
  const [capa, setCapa] = React.useState<string | null>(null)
  const [gerandoLegenda, setGerandoLegenda] = React.useState(false)
  const [enviando, setEnviando] = React.useState(false)
  const [progresso, setProgresso] = React.useState(0)
  const [resultado, setResultado] = React.useState<{ ok: number; falhas: string[] } | null>(null)

  React.useEffect(() => {
    tabloideApi
      .instagram()
      .then(setConta)
      .catch((e: Error) => setConta({ ok: false, motivo: e.message }))
  }, [])

  const juntar = formato === 'feed' && carrossel && varios
  const paginas = tabloides.reduce((n, t) => n + paginar(t.dados.itens, 'feed', t.dados.porPagina).length, 0)
  const estouraCarrossel = juntar && paginas + (capa ? 1 : 0) > 10
  const nPosts = juntar ? 1 : tabloides.length
  const escalonado = !juntar && quando === 'agendar' && nPosts > 1

  /** Horário de cada post: agora (null) ou a data escolhida + i × intervalo. */
  const horarios = Array.from({ length: nPosts }, (_, i) =>
    quando === 'agendar' ? new Date(new Date(dataHora).getTime() + (escalonado ? i * intervalo * 60_000 : 0)) : null,
  )

  const gerarLegenda = async () => {
    setGerandoLegenda(true)
    try {
      const r = await tabloideApi.legenda(
        tabloides[0].dados,
        varios ? tabloides.map((t) => t.dados) : undefined,
      )
      setLegenda(r.legenda)
      setComIa(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setGerandoLegenda(false)
    }
  }

  const irRevisar = () => {
    if (!tabloides.every((t) => t.dados.itens.length)) return toast.error('Tem tabloide sem produto na seleção.')
    if (!varios && !paginasEscolhidas.length) return toast.error('Marque pelo menos uma página.')
    if (estouraCarrossel) return toast.error(`O carrossel aceita até 10 imagens e a seleção tem ${paginas}. Selecione menos ou poste um por tabloide.`)
    if (quando === 'agendar' && new Date(dataHora).getTime() < Date.now() + 60_000) return toast.error('Escolha um horário pelo menos 1 minuto à frente.')
    setEtapa('revisar')
  }

  const postar = async () => {
    setEnviando(true)
    setProgresso(0)
    const redes: ('instagram' | 'facebook')[] = formato === 'feed' && facebook ? ['instagram', 'facebook'] : ['instagram']
    const falhas: string[] = []
    let ok = 0
    const grupos = juntar ? [tabloides] : tabloides.map((t) => [t])
    for (const [i, grupo] of grupos.entries()) {
      const nome = juntar ? `Carrossel (${grupo.length} tabloides)` : grupo[0].titulo
      try {
        let texto = legenda
        if (comIa && !juntar && formato === 'feed') {
          try {
            texto = (await tabloideApi.legenda(grupo[0].dados)).legenda
          } catch {
            /* IA indisponível: cai na legenda escrita acima */
          }
        }
        await tabloideApi.publicar({
          dados: { ...grupo[0].dados, formato },
          dados_lista: juntar ? grupo.map((t) => t.dados) : undefined,
          paginas: !varios ? paginasEscolhidas : undefined,
          // Story: a capa entra uma vez só (no 1º post). Repetida em cada tabloide, saía a mesma story várias vezes.
          capa: capa && !(formato === 'story' && i > 0) ? capa : undefined,
          formato,
          legenda: formato === 'story' ? '' : texto,
          agendado_para: horarios[i] ? horarios[i]!.toISOString() : null,
          redes,
        })
        ok++
      } catch (e) {
        falhas.push(`${nome}: ${(e as Error).message}`)
      }
      setProgresso(i + 1)
    }
    setEnviando(false)
    setResultado({ ok, falhas })
  }

  return (
    <Modal titulo="Postar em massa" onFechar={enviando ? () => {} : onFechar} largura={620}>
      {resultado ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="text-4xl">{resultado.falhas.length ? '⚠️' : '✅'}</div>
          <p className="font-bold text-[#2A2622]">
            {resultado.ok} post{resultado.ok !== 1 ? 's' : ''} {quando === 'agendar' ? 'agendado' : 'enviado'}
            {resultado.ok !== 1 ? 's' : ''}.
          </p>
          {resultado.falhas.length > 0 && (
            <ul className="w-full rounded-lg bg-red-50 p-3 text-left text-xs text-red-700">
              {resultado.falhas.map((f) => (
                <li key={f}>• {f}</li>
              ))}
            </ul>
          )}
          <p className="text-sm text-[#7A716A]">Os posts também aparecem no Social media do Mercado Nunes, no painel da NX, com o status da publicação.</p>
          <button className={btnPrimario} onClick={onFechar}>
            Fechar
          </button>
        </div>
      ) : etapa === 'revisar' ? (
        <div className="flex flex-col gap-4">
          <p className="rounded-lg bg-[#FCEFEC] px-3 py-2 text-sm text-[#2A2622]">Confira. Nada foi publicado ainda.</p>
          <div className="text-sm text-[#2A2622]">
            <b>Onde:</b> Instagram @{conta?.username}
            {formato === 'feed' && facebook ? ' + página do Facebook' : ''} · <b>Como:</b>{' '}
            {formato === 'story' ? 'Story (uma por página)' : juntar ? `Carrossel com ${paginas + (capa ? 1 : 0)} imagens` : 'Post no feed (um por tabloide)'}
            {capa ? ' · com capa' : ''}
          </div>
          <ul className="max-h-[40vh] divide-y divide-[#EFEAE3] overflow-y-auto rounded-lg border border-[#E7E1D9] text-sm">
            {(juntar ? [{ nome: `Carrossel: ${tabloides.map((t) => t.titulo).join(' → ')}` }] : tabloides.map((t) => ({ nome: t.titulo }))).map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="truncate">{p.nome}</span>
                <span className="shrink-0 text-xs font-semibold text-[#7A716A]">{horarios[i] ? quandoTexto(horarios[i]!) : 'Agora'}</span>
              </li>
            ))}
          </ul>
          {formato === 'feed' && (
            <div className="text-xs text-[#7A716A]">
              <b>Legenda:</b> {comIa && !juntar ? 'escrita com IA para cada post' : legenda.trim() ? <span className="whitespace-pre-wrap">{legenda}</span> : 'sem legenda'}
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <button className={btnSecundario} onClick={() => setEtapa('editar')} disabled={enviando}>
              ← Voltar
            </button>
            <div className="flex items-center gap-3">
              {enviando && (
                <span className="text-sm text-[#7A716A]">
                  Enviando {progresso}/{nPosts}…
                </span>
              )}
              <button className={btnPrimario} onClick={() => void postar()} disabled={enviando}>
                {enviando ? 'Enviando…' : quando === 'agendar' ? '✅ Confirmar agendamento' : '✅ Postar agora'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-[#E7E1D9] bg-[#FBF9F6] px-3 py-2 text-sm">
            {conta === null ? (
              <span className="text-[#9A928B]">Conferindo o Instagram do mercado…</span>
            ) : conta.ok ? (
              <span className="text-green-800">
                Publica em <b>@{conta.username}</b> · {tabloides.length} tabloide{varios ? 's' : ''} selecionado{varios ? 's' : ''}
              </span>
            ) : (
              <span className="text-amber-800">{conta.motivo}</span>
            )}
          </div>

          <div>
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-[#7A716A]">Onde postar</div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['feed', 'Feed', 'Instagram e, se quiser, Facebook'],
                  ['story', 'Story', 'Só Instagram, uma story por página'],
                ] as const
              ).map(([id, nome, dica]) => (
                <button
                  key={id}
                  onClick={() => setFormato(id)}
                  className={`rounded-lg border p-2 text-left ${formato === id ? 'border-[#C1503F] bg-[#FCEFEC]' : 'border-[#E7E1D9] bg-white'}`}
                >
                  <div className="text-sm font-bold text-[#2A2622]">{nome}</div>
                  <div className="text-[11px] text-[#9A928B]">{dica}</div>
                </button>
              ))}
            </div>
            {formato === 'feed' && (
              <label className="mt-2 flex items-center gap-2 text-sm text-[#2A2622]">
                <input type="checkbox" checked={facebook} onChange={(e) => setFacebook(e.target.checked)} />
                Publicar também na página do Facebook
              </label>
            )}
          </div>

          <div>
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-[#7A716A]">Capa (opcional)</div>
            {capa ? (
              <div className="flex items-center gap-3 rounded-lg border border-[#E7E1D9] bg-white p-2">
                <img src={capa} alt="Capa" className="h-20 w-16 rounded-md object-cover" />
                <div className="text-xs text-[#7A716A]">
                  Vai como a <b>primeira imagem</b> {juntar ? 'do carrossel' : formato === 'story' ? 'da primeira story (só uma vez)' : 'de cada post'}. A imagem aparece inteira, sobre um fundo borrado dela mesma.
                </div>
                <button className="ml-auto text-xs font-bold text-red-600 hover:underline" onClick={() => setCapa(null)}>
                  Remover
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-[#CFC7BD] bg-[#FBF9F6] px-3 py-3 text-sm font-semibold text-[#7A716A] hover:bg-white">
                🖼 Adicionar imagem de capa
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) lerImagem(f, 1600).then(setCapa).catch((err: Error) => toast.error(err.message))
                  }}
                />
              </label>
            )}
          </div>

          {!varios && (
            <EscolherPaginas
              dados={tabloides[0].dados}
              formato={formato}
              value={paginasEscolhidas}
              onChange={setPaginasEscolhidas}
            />
          )}

          {formato === 'feed' && varios && (
            <div>
              <div className="mb-1 text-xs font-bold uppercase tracking-wide text-[#7A716A]">Como montar</div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    [true, 'Um carrossel só', 'Todos os tabloides viram um post deslizável (até 10 imagens)'],
                    [false, 'Um post por tabloide', 'Cada tabloide sai separado'],
                  ] as const
                ).map(([v, nome, dica]) => (
                  <button
                    key={nome}
                    onClick={() => setCarrossel(v)}
                    className={`rounded-lg border p-2 text-left ${carrossel === v ? 'border-[#C1503F] bg-[#FCEFEC]' : 'border-[#E7E1D9] bg-white'}`}
                  >
                    <div className="text-sm font-bold text-[#2A2622]">{nome}</div>
                    <div className="text-[11px] text-[#9A928B]">{dica}</div>
                  </button>
                ))}
              </div>
              {juntar && (
                <p className={`mt-1 text-xs ${estouraCarrossel ? 'font-semibold text-red-600' : 'text-[#9A928B]'}`}>
                  {paginas + (capa ? 1 : 0)} imagem{paginas + (capa ? 1 : 0) !== 1 ? 'ns' : ''} no carrossel{capa ? ' (com a capa)' : ''}{estouraCarrossel ? ' — passa do limite de 10. Selecione menos tabloides.' : ' (na ordem em que você selecionou).'}
                </p>
              )}
            </div>
          )}

          <PreviaDoPost
            tabloides={tabloides.map((t) => t.dados)}
            formato={formato}
            capa={capa}
            paginas={!varios ? paginasEscolhidas : undefined}
          />

          {formato === 'feed' && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-[#7A716A]">Legenda</span>
                <button
                  className="text-sm font-bold text-[#C1503F] hover:underline disabled:opacity-50"
                  disabled={gerandoLegenda || (comIa && !juntar)}
                  onClick={() => void gerarLegenda()}
                >
                  {gerandoLegenda ? 'Escrevendo…' : '✨ Gerar legenda com IA'}
                </button>
              </div>
              <div className="mb-1 flex justify-end">
                {!juntar && varios && (
                  <label className="flex items-center gap-1.5 text-xs font-bold text-[#C1503F]">
                    <input type="checkbox" checked={comIa} onChange={(e) => setComIa(e.target.checked)} />✨ Escrever uma com IA para cada post
                  </label>
                )}
              </div>
              <textarea
                value={legenda}
                onChange={(e) => setLegenda(e.target.value)}
                rows={5}
                maxLength={2200}
                className={inputCls}
                disabled={comIa && !juntar}
                placeholder={comIa && !juntar ? 'A IA escreve uma legenda para cada tabloide.' : 'Legenda (a mesma para todos os posts). Pode deixar em branco.'}
              />
            </div>
          )}

          <div>
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-[#7A716A]">Quando</div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={quando === 'agora'} onChange={() => setQuando('agora')} /> Agora
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={quando === 'agendar'} onChange={() => setQuando('agendar')} /> Agendar
              </label>
              {quando === 'agendar' && (
                <input type="datetime-local" value={dataHora} min={agoraMais(2)} onChange={(e) => setDataHora(e.target.value)} className={inputCls} style={{ width: 220 }} />
              )}
            </div>
            {quando === 'agendar' && !juntar && nPosts > 1 && (
              <label className="mt-2 flex items-center gap-2 text-sm text-[#2A2622]">
                Intervalo entre os posts:
                <select value={intervalo} onChange={(e) => setIntervalo(Number(e.target.value))} className={inputCls} style={{ width: 240 }}>
                  {INTERVALOS.map((i) => (
                    <option key={i.min} value={i.min}>
                      {i.rotulo}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button className={btnSecundario} onClick={onFechar}>
              Cancelar
            </button>
            <button className={btnPrimario} disabled={!conta?.ok || estouraCarrossel} onClick={irRevisar}>
              Revisar e postar →
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
