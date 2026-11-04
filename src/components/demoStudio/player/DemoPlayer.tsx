import * as React from 'react'
import './player.css'
import { calcularVisao, ehCelular, paraTela, posicionarBalao, type Lado } from '@/lib/demoStudio/layout'
import {
  aplicarVariaveis,
  aplicarVariaveisSemFrasesVazias,
  formatarTelefone,
  linkWhatsapp,
  trechosDoTexto,
  type Variaveis,
} from '@/lib/demoStudio/variables'
import type { PlayerDemo, PlayerStep } from '@/lib/demoStudio/types'
import { urlDoArquivo } from '@/services/demoStudio'

/**
 * Player da demo (link público, incorporação e pré-visualização do editor). Comportamento portado de
 * docs/demo-studio/reference/player/player-v1.html; a geometria (zoom no celular, posição do balão) mora
 * em lib/demoStudio/layout.ts, com testes. Sem dependências além do React.
 */

const WHATSAPP_PADRAO = '5548936181649'

export type PlayerEvent =
  | { t: 'step_view'; stepId: string; order: number }
  | { t: 'hotspot_click'; stepId: string }
  | { t: 'cta_click'; cta: 'whatsapp' | 'url' | 'topo' }
  | { t: 'lead_submit'; fields: Record<string, string> }
  | { t: 'complete' }
  | { t: 'chapter_open'; chapter: string }

export interface DemoPlayerProps {
  demo: PlayerDemo
  /** Variáveis do link ou da querystring: empresa, nome, vendedor. */
  vars?: Variaveis
  /** Versão para iframe: sem o cabeçalho. */
  embed?: boolean
  onEvent?: (e: PlayerEvent) => void
  /** Lead já conhecido (link personalizado): pula o gate do formulário (§7.2). */
  leadConhecido?: boolean
  /** Envia o formulário (origem 'form') ou o nome/empresa do CTA ('cta') ao servidor. Sem ele, só preenche as variáveis. */
  enviarLead?: (campos: Record<string, string>, origem: 'form' | 'cta') => Promise<void>
  /** Texto de consentimento e política de privacidade do workspace. */
  consentimento?: { texto?: string; politicaUrl?: string }
}

/** Etapa sintética do gate: aparece na etapa N quando a demo pede o lead antes de continuar. */
const ETAPA_DO_GATE: Omit<PlayerStep, 'id' | 'order' | 'frameId'> = {
  kind: 'LEAD_FORM',
  hotspot: null,
  title: 'Antes de continuar',
  body: 'Deixe seu contato para ver o restante do tour.',
  placement: 'auto',
  buttonLabel: 'Continuar o tour',
  chapter: null,
  cta: null,
  form: null,
}

interface Geometria {
  z: number
  ox: number
  oy: number
  vh: number
  spot: { L: number; T: number; W: number; H: number } | null
  tip: { x: number; y: number; lado: Lado | null; seta: { left?: number; top?: number } } | null
}

function Texto({ texto }: { texto: string }) {
  return (
    <>
      {trechosDoTexto(texto).map((t, i) =>
        t.tipo === 'quebra' ? <br key={i} /> : t.tipo === 'negrito' ? <strong key={i}>{t.valor}</strong> : <React.Fragment key={i}>{t.valor}</React.Fragment>,
      )}
    </>
  )
}

const SetaVoltar = ({ tamanho }: { tamanho: number }) => (
  <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
)

export function DemoPlayer({ demo, vars = {}, embed = false, onEvent, leadConhecido = false, enviarLead, consentimento }: DemoPlayerProps) {
  const steps = demo.steps
  const frames = React.useMemo(() => new Map(demo.frames.map((f) => [f.id, f])), [demo.frames])
  const hotspots = React.useMemo(() => steps.map((s, i) => (s.kind === 'HOTSPOT' ? i : -1)).filter((i) => i >= 0), [steps])

  const [cur, setCur] = React.useState(0)
  const [full, setFull] = React.useState(false)
  const [anim, setAnim] = React.useState(false)
  const [tick, setTick] = React.useState(0)
  const [lead, setLead] = React.useState<Variaveis>({})
  const [leadOk, setLeadOk] = React.useState(leadConhecido)
  const [geo, setGeo] = React.useState<Geometria | null>(null)

  const vpRef = React.useRef<HTMLDivElement>(null)
  const tipRef = React.useRef<HTMLDivElement>(null)
  const spotRef = React.useRef<HTMLDivElement>(null)
  const imgsRef = React.useRef<(HTMLImageElement | null)[]>([null, null])
  const frenteRef = React.useRef(0)
  const frameAtualRef = React.useRef<string | null>(null)
  const vistasRef = React.useRef(new Set<number>())
  const onEventRef = React.useRef(onEvent)
  onEventRef.current = onEvent

  const etapaAtual: PlayerStep | undefined = steps[cur]
  // Gate (§7.2): da etapa N em diante, nada aparece até o formulário ser enviado. Vale mesmo pulando
  // pela barra de progresso ou pelo teclado.
  const gate = demo.settings.leadGateStep
  const gateAtivo = !!gate && !leadOk && !!etapaAtual && etapaAtual.order >= gate && etapaAtual.kind !== 'LEAD_FORM'
  const step: PlayerStep | undefined = gateAtivo && etapaAtual ? { ...etapaAtual, ...ETAPA_DO_GATE } : etapaAtual
  const frame = step ? frames.get(step.frameId) : undefined
  const ehHotspot = step?.kind === 'HOTSPOT'
  const hotspot = ehHotspot ? step?.hotspot ?? null : null
  const todas: Variaveis = { ...vars, ...lead }
  const marca = demo.theme.brandName || demo.name
  const telefone = demo.settings.ctaPhone || WHATSAPP_PADRAO
  // Capítulos (§4.1): primeira etapa de cada um, na ordem em que aparecem no tour.
  const capitulos = React.useMemo(() => {
    const vistos = new Map<string, number>()
    steps.forEach((s, i) => { if (s.chapter && !vistos.has(s.chapter)) vistos.set(s.chapter, i) })
    return demo.chapters.filter((c) => vistos.has(c)).map((c) => ({ nome: c, inicio: vistos.get(c)! }))
  }, [demo.chapters, steps])
  const [menuCapitulos, setMenuCapitulos] = React.useState(false)
  const raizRef = React.useRef<HTMLDivElement>(null)

  // Incorporação (§7.3): avisa a página de fora da altura do conteúdo, para o iframe crescer junto.
  React.useEffect(() => {
    if (!embed || window.parent === window || !raizRef.current) return
    const avisar = () => window.parent.postMessage({ type: 'nxdemo:height', slug: demo.slug, height: Math.ceil(raizRef.current!.getBoundingClientRect().height) }, '*')
    const ro = new ResizeObserver(avisar)
    ro.observe(raizRef.current)
    avisar()
    return () => ro.disconnect()
  }, [embed, demo.slug])
  const [celular, setCelular] = React.useState(() => typeof window !== 'undefined' && ehCelular(window.innerWidth))

  // Pré-carrega todas as telas: a troca de etapa fica instantânea.
  React.useEffect(() => {
    demo.frames.forEach((f) => {
      const im = new Image()
      im.src = urlDoArquivo(f.image)
      im.decode?.().catch(() => undefined)
    })
  }, [demo.frames])

  // Troca de tela com crossfade de 180ms entre duas <img>, só depois da nova estar decodificada.
  React.useEffect(() => {
    if (!frame || frameAtualRef.current === frame.id) return
    frameAtualRef.current = frame.id
    const frente = imgsRef.current[frenteRef.current]
    const tras = imgsRef.current[1 - frenteRef.current]
    if (!frente || !tras) return
    tras.src = urlDoArquivo(frame.image)
    const trocar = () => {
      if (frameAtualRef.current !== frame.id) return
      tras.classList.remove('off')
      frente.classList.add('off')
      frenteRef.current = 1 - frenteRef.current
    }
    ;(tras.decode ? tras.decode().catch(() => undefined) : Promise.resolve()).then(trocar)
  }, [frame])

  // Geometria: recorte visível, destaque e balão. Mede o DOM (largura do palco, tamanho do balão).
  React.useLayoutEffect(() => {
    const vp = vpRef.current
    if (!vp || !frame) return
    const larguraJanela = window.innerWidth
    const vw = vp.clientWidth
    const mobile = ehCelular(larguraJanela)
    setCelular(mobile)
    const v = calcularVisao({ vw, alturaJanela: window.innerHeight, larguraJanela, frame, hotspot, telaInteira: full })
    let spot: Geometria['spot'] = null
    let tip: Geometria['tip'] = null
    const tw = tipRef.current?.offsetWidth ?? 330
    const th = tipRef.current?.offsetHeight ?? 150
    if (hotspot) {
      spot = paraTela(hotspot, v)
      if (!mobile) {
        const p = posicionarBalao({ r: spot, vw, vh: v.vh, tw, th, preferido: step?.placement })
        tip = { x: p.x, y: p.y + vp.offsetTop, lado: p.lado, seta: p.seta }
      }
    } else if (ehHotspot && !mobile) {
      // Etapa de destaque ainda sem retângulo (rascunho): balão no meio da tela.
      tip = { x: (vw - tw) / 2, y: vp.offsetTop + Math.max(8, (v.vh - th) / 2), lado: null, seta: {} }
    }
    setGeo({ z: v.z, ox: v.ox, oy: v.oy, vh: v.vh, spot, tip })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, full, tick, frame, hotspot, step?.title, step?.body])

  React.useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const aoRedimensionar = () => {
      clearTimeout(t)
      t = setTimeout(() => setTick((n) => n + 1), 80)
    }
    window.addEventListener('resize', aoRedimensionar)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', aoRedimensionar)
    }
  }, [])

  const ir = React.useCallback(
    (i: number) => {
      if (i < 0 || i >= steps.length) return
      setAnim(true)
      setFull(false)
      setCur(i)
    },
    [steps.length],
  )
  const proximo = React.useCallback(() => ir(cur + 1), [ir, cur])
  const voltar = React.useCallback(() => ir(cur - 1), [ir, cur])

  // Eventos de etapa vista / conclusão (o coletor de analytics entra no M2 pelo onEvent).
  // Etapa atrás do gate só conta como vista depois que o formulário libera.
  React.useEffect(() => {
    if (!etapaAtual || gateAtivo || vistasRef.current.has(cur)) return
    vistasRef.current.add(cur)
    onEventRef.current?.({ t: 'step_view', stepId: etapaAtual.id, order: etapaAtual.order })
    if (etapaAtual.kind === 'CTA' || cur === steps.length - 1) onEventRef.current?.({ t: 'complete' })
  }, [cur, etapaAtual, gateAtivo, steps.length])

  React.useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null
      if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA')) return
      if (e.key === 'ArrowRight') proximo()
      if (e.key === 'ArrowLeft') voltar()
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [proximo, voltar])

  const clicarDestaque = () => {
    if (step) onEventRef.current?.({ t: 'hotspot_click', stepId: step.id })
    proximo()
  }
  const dica = (e: React.MouseEvent) => {
    const alvo = e.target as HTMLElement
    if (alvo === e.currentTarget || alvo.tagName === 'IMG' || alvo.classList.contains('canvas')) {
      const s = spotRef.current
      if (!s) return
      s.classList.remove('hint')
      void s.offsetWidth
      s.classList.add('hint')
    }
  }
  const toqueX = React.useRef<number | null>(null)
  const temCartao = !!step && step.kind !== 'HOTSPOT'

  if (!step || !frame) {
    return (
      <div className={embed ? 'dsp dsp-embed' : 'dsp'}>
        <div className="stage-wrap"><p className="meta">Esta demo ainda não tem etapas.</p></div>
      </div>
    )
  }

  const posHotspot = hotspots.indexOf(cur)
  const rotulo = posHotspot >= 0 ? `${posHotspot + 1} de ${hotspots.length}` : ''
  const ultimoHotspot = cur === hotspots[hotspots.length - 1]
  const rotuloProximo = step.buttonLabel || (ultimoHotspot ? 'Concluir' : 'Próximo')
  const semVoltar = hotspots.length === 0 || cur <= hotspots[0]
  const titulo = aplicarVariaveis(step.title, todas)
  const corpo = aplicarVariaveis(step.body, todas)
  const accent = demo.theme.accent && /^#[0-9a-f]{6}$/i.test(demo.theme.accent) ? demo.theme.accent : undefined
  const msgTopo = aplicarVariaveisSemFrasesVazias(
    demo.settings.ctaMessage || `Olá! Estou vendo o tour do ${marca} e quero falar com um especialista.`,
    todas,
  )

  return (
    <div ref={raizRef} className={embed ? 'dsp dsp-embed' : 'dsp'} style={accent ? ({ '--accent': accent } as React.CSSProperties) : undefined}>
      {!embed && (
        <header className="top">
          <div className="brand">
            {demo.theme.logoText && <span className="mark">{demo.theme.logoText}</span>}
            {marca} <small>Tour interativo</small>
          </div>
          <div className="spacer" />
          <span className="count">{rotulo && `Etapa ${rotulo}`}</span>
          {demo.settings.showRestart !== false && (
            <button className="btn btn-ghost restart" type="button" onClick={() => ir(0)}>Recomeçar</button>
          )}
          <a
            className="btn btn-wa"
            href={linkWhatsapp(telefone, msgTopo)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onEventRef.current?.({ t: 'cta_click', cta: 'topo' })}
          >
            Falar com especialista
          </a>
        </header>
      )}

      <div className="stage-wrap">
        <div className="window">
          <div className="chrome">
            <div className="dots"><i /><i /><i /></div>
            <div className="url">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              <span>{frame.displayUrl || ''}</span>
            </div>
            <button className="zoom" type="button" hidden={!hotspot} onClick={() => { setAnim(true); setFull((f) => !f) }}>
              {full ? 'Aproximar' : 'Tela inteira'}
            </button>
            {capitulos.length > 1 && (
              <div className="caps">
                <button
                  type="button"
                  className="caps-btn"
                  aria-haspopup="menu"
                  aria-expanded={menuCapitulos}
                  onClick={() => setMenuCapitulos((m) => !m)}
                >
                  {etapaAtual?.chapter || 'Capítulos'} ▾
                </button>
                {menuCapitulos && (
                  <div className="caps-menu" role="menu">
                    {capitulos.map((c) => (
                      <button
                        key={c.nome}
                        type="button"
                        role="menuitem"
                        className={c.nome === etapaAtual?.chapter ? 'atual' : ''}
                        onClick={() => {
                          setMenuCapitulos(false)
                          onEventRef.current?.({ t: 'chapter_open', chapter: c.nome })
                          ir(c.inicio)
                        }}
                      >
                        {c.nome}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div
            className="viewport"
            ref={vpRef}
            style={{ height: geo ? geo.vh : undefined, aspectRatio: geo ? undefined : `${frame.width} / ${frame.height}` }}
            onClick={dica}
            onTouchStart={(e) => { toqueX.current = e.touches[0].clientX }}
            onTouchEnd={(e) => {
              if (toqueX.current === null || temCartao) return
              const dx = e.changedTouches[0].clientX - toqueX.current
              toqueX.current = null
              if (Math.abs(dx) > 60) (dx < 0 ? proximo : voltar)()
            }}
          >
            <div
              className={anim ? 'canvas anim' : 'canvas'}
              style={{
                width: frame.width,
                height: frame.height,
                transform: geo ? `scale(${geo.z}) translate(${-geo.ox}px, ${-geo.oy}px)` : undefined,
              }}
            >
              <img ref={(el) => { imgsRef.current[0] = el }} alt="" />
              <img ref={(el) => { imgsRef.current[1] = el }} alt="" className="off" />
              {/* Rascunho: máscaras desenhadas por cima. Na versão publicada elas já vêm gravadas na imagem. */}
              {frame.masks?.map((m, i) => (
                <div
                  key={i}
                  className={m.type === 'blur' ? 'mask mask-blur' : 'mask mask-cover'}
                  style={{ left: m.x, top: m.y, width: m.w, height: m.h }}
                >
                  {m.type === 'cover' && m.text}
                </div>
              ))}
            </div>
            <div
              ref={spotRef}
              className={anim ? 'spot anim' : 'spot'}
              role="button"
              tabIndex={0}
              aria-label="Avançar para a próxima etapa"
              style={geo?.spot ? { display: 'block', left: geo.spot.L, top: geo.spot.T, width: geo.spot.W, height: geo.spot.H } : { display: 'none' }}
              onClick={(e) => { e.stopPropagation(); clicarDestaque() }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clicarDestaque() } }}
            />
            <div className="tap" hidden={!hotspot || !celular}>Toque no destaque</div>
            {temCartao && (
              <div className="card">
                <div className="box">
                  <Cartao
                    key={gateAtivo ? 'gate' : step.id}
                    demo={demo}
                    step={step}
                    indice={cur}
                    titulo={titulo}
                    corpo={corpo}
                    vars={todas}
                    totalHotspots={hotspots.length}
                    telefonePadrao={telefone}
                    marca={marca}
                    // No gate o formulário só libera a etapa atual; no LEAD_FORM normal, segue o tour.
                    onProximo={gateAtivo ? () => undefined : proximo}
                    onRever={() => ir(hotspots[0] ?? 0)}
                    consentimento={consentimento}
                    enviarLead={enviarLead}
                    onLead={(campos) => {
                      setLead((l) => ({ ...l, ...campos }))
                      setLeadOk(true)
                      onEventRef.current?.({ t: 'lead_submit', fields: campos })
                    }}
                    onCampo={(chave, valor) => setLead((l) => ({ ...l, [chave]: valor }))}
                    onCta={(tipo) => {
                      onEventRef.current?.({ t: 'cta_click', cta: tipo })
                      // Nome/empresa digitados no cartão final também identificam o lead (§3).
                      const campos = Object.fromEntries((step.cta?.collect ?? []).map((k) => [k, (todas[k] ?? '').trim()]).filter(([, v]) => v))
                      if (tipo === 'whatsapp' && Object.keys(campos).length) enviarLead?.(campos, 'cta').catch(() => undefined)
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {ehHotspot && (
          <div
            className="tip"
            ref={tipRef}
            role="dialog"
            aria-live="polite"
            style={geo?.tip ? { left: geo.tip.x, top: geo.tip.y, opacity: 1, pointerEvents: 'auto' } : { opacity: 0, pointerEvents: 'none' }}
          >
            {geo?.tip?.lado && (
              <i
                className="arrow"
                style={
                  geo.tip.lado === 'right' ? { left: -6, top: geo.tip.seta.top }
                    : geo.tip.lado === 'left' ? { right: -6, top: geo.tip.seta.top }
                      : geo.tip.lado === 'bottom' ? { top: -6, left: geo.tip.seta.left }
                        : { bottom: -6, left: geo.tip.seta.left }
                }
              />
            )}
            <h3>{titulo}</h3>
            <p><Texto texto={corpo} /></p>
            <div className="nav">
              <button className="back" type="button" aria-label="Voltar" disabled={semVoltar} onClick={voltar}><SetaVoltar tamanho={18} /></button>
              <span className="n">{rotulo}</span>
              <button className="next" type="button" onClick={proximo}>{rotuloProximo}</button>
            </div>
          </div>
        )}
      </div>

      <div className="dock" aria-live="polite" hidden={!ehHotspot}>
        <h3>{titulo}</h3>
        <p><Texto texto={corpo} /></p>
        <div className="nav">
          <button className="back" type="button" aria-label="Voltar" disabled={semVoltar} onClick={voltar}><SetaVoltar tamanho={20} /></button>
          <span className="n">{rotulo}</span>
          <button className="next" type="button" onClick={proximo}>{rotuloProximo}</button>
        </div>
      </div>

      {demo.settings.showProgress !== false && (
        <nav className="progress" aria-label="Etapas do tour">
          {steps.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={`Ir para a etapa ${i + 1}`}
              className={i < cur ? 'done' : i === cur ? 'cur' : ''}
              onClick={() => ir(i)}
            />
          ))}
        </nav>
      )}
    </div>
  )
}

interface CartaoProps {
  demo: PlayerDemo
  step: PlayerStep
  indice: number
  titulo: string
  corpo: string
  vars: Variaveis
  totalHotspots: number
  telefonePadrao: string
  marca: string
  onProximo: () => void
  onRever: () => void
  onLead: (campos: Record<string, string>) => void
  onCampo: (chave: string, valor: string) => void
  onCta: (tipo: 'whatsapp' | 'url') => void
  enviarLead?: DemoPlayerProps['enviarLead']
  consentimento?: DemoPlayerProps['consentimento']
}

const ROTULO_CAMPO: Record<string, string> = { nome: 'Seu nome', empresa: 'Empresa' }
const EXEMPLO_CAMPO: Record<string, string> = { nome: 'Ex.: Ana Souza', empresa: 'Ex.: Pedal Bikes', whatsapp: '(48) 99999-0000', email: 'voce@empresa.com.br' }
const AUTOCOMPLETE: Record<string, string> = { nome: 'name', empresa: 'organization', whatsapp: 'tel', email: 'email', cargo: 'organization-title' }

/** Cartões centralizados: abertura/explicação (MODAL), formulário (LEAD_FORM) e chamada final (CTA). */
function Cartao(p: CartaoProps) {
  const { step } = p

  if (step.kind === 'MODAL') {
    const abertura = p.indice === 0
    const empresa = (p.vars.empresa ?? '').trim()
    return (
      <>
        {abertura && <div className="eyebrow">Tour guiado</div>}
        <h2>{p.titulo}</h2>
        <p>
          {abertura && empresa && `Preparamos este tour para a ${empresa}. `}
          <Texto texto={p.corpo} />
        </p>
        <div className="row">
          <button className="btn btn-primary" type="button" onClick={p.onProximo} autoFocus>
            {step.buttonLabel || (abertura ? 'Começar o tour' : 'Continuar')}
          </button>
          {abertura && p.totalHotspots > 0 && <span className="meta">{p.totalHotspots} etapas</span>}
        </div>
      </>
    )
  }

  if (step.kind === 'LEAD_FORM') return <FormularioLead {...p} />

  // CTA
  const cta = step.cta ?? { type: 'WHATSAPP' as const }
  const coletar = cta.collect ?? []
  const telefone = cta.phone || p.telefonePadrao
  const mensagem = aplicarVariaveisSemFrasesVazias(
    cta.message || p.demo.settings.ctaMessage || `Olá! Sou {{nome}} da {{empresa}}. Acabei de ver o tour do ${p.marca} e quero falar com um especialista.`,
    p.vars,
  )
  return (
    <>
      <div className="eyebrow">Fim do tour</div>
      <h2>{p.titulo}</h2>
      <p><Texto texto={p.corpo} /></p>
      {cta.type === 'WHATSAPP' && coletar.length > 0 && (
        <div className="form">
          {coletar.map((chave) => (
            <label key={chave} htmlFor={`dsp-${chave}`}>
              {ROTULO_CAMPO[chave] ?? chave}
              <input
                id={`dsp-${chave}`}
                autoComplete={AUTOCOMPLETE[chave]}
                value={p.vars[chave] ?? ''}
                placeholder={EXEMPLO_CAMPO[chave]}
                onChange={(e) => p.onCampo(chave, e.target.value)}
              />
            </label>
          ))}
        </div>
      )}
      <div className="row">
        {cta.type === 'URL' ? (
          <a className="btn btn-primary" href={cta.url || '#'} target="_blank" rel="noopener noreferrer" onClick={() => p.onCta('url')}>
            {cta.buttonLabel || 'Saiba mais'}
          </a>
        ) : (
          <a className="btn btn-wa" href={linkWhatsapp(telefone, mensagem)} target="_blank" rel="noopener noreferrer" onClick={() => p.onCta('whatsapp')}>
            {cta.buttonLabel || 'Falar no WhatsApp'}
          </a>
        )}
        <button className="btn btn-ghost" type="button" onClick={p.onRever}>Ver de novo</button>
      </div>
      {cta.type === 'WHATSAPP' && (
        <p className="meta" style={{ margin: '14px 0 0' }}>
          Ou chame no <span className="phone">{formatarTelefone(telefone)}</span>
        </p>
      )}
    </>
  )
}

/**
 * Formulário de lead (LEAD_FORM e gate). Envia ao servidor com o consentimento marcado (LGPD, §13) e só
 * depois libera o tour; sem `enviarLead` (pré-visualização do editor) só preenche as variáveis.
 */
function FormularioLead(p: CartaoProps) {
  const campos = p.step.form?.fields?.length
    ? p.step.form.fields
    : [{ key: 'nome', label: 'Seu nome', required: true }, { key: 'empresa', label: 'Empresa' }, { key: 'whatsapp', label: 'WhatsApp', required: true }]
  const [valores, setValores] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(campos.map((c) => [c.key, p.vars[c.key] ?? ''])),
  )
  const [aceite, setAceite] = React.useState(false)
  const [enviando, setEnviando] = React.useState(false)
  const [erro, setErro] = React.useState('')
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    const faltando = campos.find((c) => c.required && !valores[c.key]?.trim())
    if (faltando) {
      setErro(`Preencha: ${faltando.label}`)
      return
    }
    if (!aceite) {
      setErro('Marque que concorda em ser contatado.')
      return
    }
    const limpos = Object.fromEntries(Object.entries(valores).map(([k, v]) => [k, v.trim()]))
    setErro('')
    setEnviando(true)
    try {
      await p.enviarLead?.(limpos, 'form')
    } catch (err) {
      setErro((err as Error).message)
      setEnviando(false)
      return
    }
    setEnviando(false)
    p.onLead(limpos)
    p.onProximo()
  }
  const politica = p.consentimento?.politicaUrl
  return (
    <form onSubmit={enviar}>
      <h2>{p.titulo}</h2>
      {p.corpo && <p><Texto texto={p.corpo} /></p>}
      <div className="form">
        {campos.map((c) => (
          <label key={c.key} htmlFor={`dsp-lead-${c.key}`}>
            {c.label}{c.required ? ' *' : ''}
            <input
              id={`dsp-lead-${c.key}`}
              type={c.key === 'email' ? 'email' : c.key === 'whatsapp' ? 'tel' : 'text'}
              autoComplete={AUTOCOMPLETE[c.key]}
              placeholder={EXEMPLO_CAMPO[c.key]}
              value={valores[c.key] ?? ''}
              onChange={(e) => setValores((v) => ({ ...v, [c.key]: e.target.value }))}
            />
          </label>
        ))}
        <label className="consent" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} style={{ width: 18, height: 18, flex: 'none', marginTop: 1 }} />
          <span>
            {p.step.form?.consentText || p.consentimento?.texto || 'Ao enviar, você concorda em ser contatado pela NX Digital sobre esta demonstração.'}
            {politica && <> <a href={politica} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>Política de privacidade</a></>}
          </span>
        </label>
        {erro && <span className="erro" role="alert">{erro}</span>}
      </div>
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={enviando}>{enviando ? 'Enviando…' : p.step.buttonLabel || 'Continuar o tour'}</button>
      </div>
    </form>
  )
}
