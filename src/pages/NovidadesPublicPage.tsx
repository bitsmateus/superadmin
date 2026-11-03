import * as React from 'react'
import { Loader2 } from 'lucide-react'
import logoNx from '@/assets/logo-nx.jpg'
import { novidadesPublicApi, TIPO_LABEL, type ComunicadoPost, type TipoComunicado } from '@/api/comunicados'

/**
 * Página pública (sem login) com o que mudou na plataforma — o link que vai no template
 * "atualizações da semana". Mostra só o que foi publicado no menu Comunicados, do mais novo pro mais antigo,
 * agrupado por mês.
 */

const FUNDO = 'linear-gradient(135deg, #1E1B6B 0%, #2B2FB5 55%, #2F5BFF 100%)'

const TIPO_COR: Record<TipoComunicado, string> = {
  novidade: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  melhoria: 'bg-blue-50 text-blue-700 border-blue-200',
  correcao: 'bg-slate-50 text-slate-600 border-slate-200',
  aviso: 'bg-amber-50 text-amber-700 border-amber-200',
}

function mesDe(iso: string): string {
  const s = new Date(iso).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function NovidadesPublicPage() {
  const [posts, setPosts] = React.useState<ComunicadoPost[] | null>(null)
  const [erro, setErro] = React.useState(false)

  React.useEffect(() => {
    document.title = 'Novidades da plataforma NX'
    novidadesPublicApi.list().then(setPosts).catch(() => setErro(true))
  }, [])

  const porMes = React.useMemo(() => {
    const grupos: { mes: string; itens: ComunicadoPost[] }[] = []
    for (const p of posts ?? []) {
      const mes = mesDe(p.publicado_em as string)
      const ultimo = grupos[grupos.length - 1]
      if (ultimo?.mes === mes) ultimo.itens.push(p)
      else grupos.push({ mes, itens: [p] })
    }
    return grupos
  }, [posts])

  return (
    <div className="min-h-screen w-full px-4 py-10" style={{ background: FUNDO }}>
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="flex items-center gap-3 text-white">
          <img src={logoNx} alt="Grupo NX Digital" className="h-12 w-12 rounded-2xl object-cover shadow-sm" />
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">Novidades da plataforma</h1>
            <p className="text-sm text-white/70">O que mudou na NX, semana a semana.</p>
          </div>
        </header>

        {erro ? (
          <div className="rounded-2xl bg-white p-6 text-sm text-slate-600 shadow-xl">Não deu pra carregar as novidades agora. Tente de novo em instantes.</div>
        ) : posts === null ? (
          <div className="flex items-center gap-2 text-sm text-white">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : posts.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 text-sm text-slate-600 shadow-xl">Ainda não tem novidade publicada por aqui.</div>
        ) : (
          porMes.map((g) => (
            <section key={g.mes} className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-white/70">{g.mes}</h2>
              {g.itens.map((p) => (
                <article key={p.id} className="rounded-2xl bg-white p-5 shadow-xl sm:p-6">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${TIPO_COR[p.tipo] ?? TIPO_COR.novidade}`}>
                      {TIPO_LABEL[p.tipo] ?? p.tipo}
                    </span>
                    <span className="text-xs text-slate-400">
                      {new Date(p.publicado_em as string).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold text-slate-800">{p.titulo}</h3>
                  {p.corpo && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{p.corpo}</p>}
                </article>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  )
}
