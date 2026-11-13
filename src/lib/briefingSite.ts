import type { BriefingConfig } from '@/types/client'

/**
 * Briefing só de site: mesma estrutura do briefing de onboarding (token em clients.briefing_token,
 * página /briefing/:token, etapa "Briefing" do Pipeline), mas o formulário público mostra apenas
 * as perguntas de criação de site (ver buildSections em BriefingPublicPage).
 */
export const SITE_ONLY_CONFIG: BriefingConfig = {
  connectionTypes: [],
  automationTypes: ['site'],
  channels: [],
  maxUsers: 0,
  maxWhatsappNumbers: 0,
  hasExternalAutomation: false,
  siteOnly: true,
}

export function briefingLinkFor(token: string): string {
  return `${window.location.origin}/briefing/${token}`
}

export function buildSiteBriefingMessage(name: string, link: string): string {
  return `Olá, ${name}!

Para começarmos a criação do seu site, preparamos um briefing com algumas perguntas sobre a sua empresa e o que você espera do site.

👉 Acesse o link abaixo e responda com atenção:
${link}

Essas informações são a base do site que vamos criar pra você.

Qualquer dúvida, é só nos chamar! 😊`
}
