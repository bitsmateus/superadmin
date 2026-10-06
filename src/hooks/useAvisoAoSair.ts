import * as React from 'react'

/**
 * Avisa antes de a pessoa perder o que digitou e não salvou.
 *
 * Cobre fechar a aba/recarregar (beforeunload) e clicar num link interno do app (o <a> do roteador).
 * Não cobre o botão "voltar" do navegador: o app usa o roteador comum, que não deixa bloquear isso —
 * por isso quem usa este hook também guarda um rascunho, e o que foi digitado volta.
 */
export function useAvisoAoSair(sujo: boolean, mensagem = 'Você tem alterações não salvas. Sair mesmo assim?') {
  React.useEffect(() => {
    if (!sujo) return
    const antes = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    const clique = (e: MouseEvent) => {
      const alvo = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!alvo || alvo.target === '_blank' || e.defaultPrevented) return
      const url = new URL(alvo.href, window.location.href)
      // Só o que sai desta tela: link pra mesma página (âncora, mesmo caminho) não perde nada.
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return
      if (!window.confirm(mensagem)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', antes)
    document.addEventListener('click', clique, true)
    return () => {
      window.removeEventListener('beforeunload', antes)
      document.removeEventListener('click', clique, true)
    }
  }, [sujo, mensagem])
}
