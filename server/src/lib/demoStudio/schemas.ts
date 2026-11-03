import { z } from 'zod';

/** Validação de toda entrada do Demo Studio. Mensagens em português (voltam pro editor). */

const caixa = z.object({
  x: z.number().finite().min(0),
  y: z.number().finite().min(0),
  w: z.number().finite().min(4),
  h: z.number().finite().min(4),
});

const cta = z.object({
  type: z.enum(['WHATSAPP', 'URL']),
  phone: z.string().max(20).optional(),
  message: z.string().max(1000).optional(),
  url: z.string().url('URL inválida').max(2000).optional().or(z.literal('')),
  buttonLabel: z.string().max(60).optional(),
  collect: z.array(z.enum(['nome', 'empresa'])).max(2).optional(),
});

const form = z.object({
  fields: z.array(z.object({ key: z.string().max(30), label: z.string().max(60), required: z.boolean().optional() })).max(8),
  consentText: z.string().max(500).optional(),
});

const cor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor no formato #RRGGBB');

export const criarDemo = z.object({
  name: z.string().trim().min(1, 'Dê um nome para a demo').max(120),
  fromTemplateId: z.string().uuid().optional(),
});

export const editarDemo = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use só letras minúsculas, números e hífen').max(60),
    description: z.string().max(500).nullable(),
    isTemplate: z.boolean(),
    segment: z.string().max(60).nullable(),
    coverFrameId: z.string().uuid().nullable(),
    theme: z.object({
      accent: cor.optional(),
      brandName: z.string().max(60).optional(),
      logoText: z.string().max(12).optional(),
    }),
    settings: z.object({
      showProgress: z.boolean().optional(),
      showRestart: z.boolean().optional(),
      leadGateStep: z.number().int().min(1).nullable().optional(),
      ctaPhone: z.string().max(20).optional(),
      ctaMessage: z.string().max(1000).optional(),
    }),
  })
  .partial();

export const enviarFrame = z.object({
  dataUrl: z.string().min(30),
  name: z.string().max(120).optional(),
  pixelRatio: z.number().min(0.5).max(4).optional(),
  displayUrl: z.string().max(300).optional(),
});

export const editarFrame = z.object({
  name: z.string().max(120).nullable(),
  displayUrl: z.string().max(300).nullable(),
}).partial();

const tipoEtapa = z.enum(['HOTSPOT', 'MODAL', 'LEAD_FORM', 'CTA']);

export const criarEtapa = z.object({
  kind: tipoEtapa,
  frameId: z.string().uuid(),
  /** Entra logo depois desta posição (1-based). Sem ela, vai pro fim. */
  afterOrder: z.number().int().min(0).optional(),
  hotspot: caixa.nullable().optional(),
  title: z.string().max(120).optional(),
});

export const editarEtapa = z
  .object({
    kind: tipoEtapa,
    frameId: z.string().uuid(),
    hotspot: caixa.nullable(),
    title: z.string().max(120),
    body: z.string().max(600),
    placement: z.enum(['auto', 'right', 'left', 'top', 'bottom']),
    buttonLabel: z.string().max(40).nullable(),
    cta: cta.nullable(),
    form: form.nullable(),
  })
  .partial();

export const reordenar = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });

/** Primeira mensagem de erro do zod, pronta pra mostrar. */
export function mensagemDoErro(e: z.ZodError): string {
  const p = e.issues[0];
  if (!p) return 'Dados inválidos';
  const campo = p.path.join('.');
  return campo ? `${campo}: ${p.message}` : p.message;
}
