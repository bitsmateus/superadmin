import { useQuery } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { engeApi } from '@/api/engeEnvio'
import { dataHoraBr } from '@/lib/engeEnvio'

/** O aviso exatamente como saiu (e-mail e WhatsApp), com data/hora e a confirmação do síndico — é o comprovante. */
export function EmailModal({ envioId, onFechar }: { envioId: string | null; onFechar: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['engeenvio', 'envio', envioId],
    queryFn: () => engeApi.verEnvio(envioId!),
    enabled: Boolean(envioId),
  })

  return (
    <Modal open={Boolean(envioId)} onClose={onFechar} size="lg" title="Aviso enviado">
      {isLoading && <p className="text-sm text-foreground/50">Carregando…</p>}
      {error && <p className="text-sm text-danger">{(error as Error).message}</p>}
      {data && (
        <div className="space-y-4 text-foreground">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {data.enviadoEm && (
              <>
                <dt className="text-foreground/50">E-mail</dt>
                <dd className="break-words">
                  <span className="tabular-nums">{dataHoraBr(data.enviadoEm)}</span> · {data.destinatarios}
                </dd>
                <dt className="text-foreground/50">Assunto</dt>
                <dd className="font-medium">{data.assunto}</dd>
              </>
            )}
            {data.whatsappEnviadoEm && (
              <>
                <dt className="text-foreground/50">WhatsApp</dt>
                <dd className="break-words">
                  <span className="tabular-nums">{dataHoraBr(data.whatsappEnviadoEm)}</span> · {data.whatsappPara}
                </dd>
              </>
            )}
            <dt className="text-foreground/50">Ciente</dt>
            <dd>
              {data.cienteEm ? (
                <span className="text-success">
                  {data.cienteNome} em {dataHoraBr(data.cienteEm)}
                  {data.cienteIp && <span className="text-foreground/50"> · IP {data.cienteIp}</span>}
                </span>
              ) : (
                <span className="text-foreground/50">Ainda não confirmou</span>
              )}
            </dd>
          </dl>
          {data.whatsappTexto && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-foreground/70">Mensagem de WhatsApp</p>
              <p className="whitespace-pre-wrap rounded-lg border border-line bg-elevate/[0.03] p-3 text-sm text-foreground/85">
                {data.whatsappTexto}
              </p>
            </div>
          )}
          {data.html && (
            // Fundo branco fixo de propósito: é como o e-mail aparece na caixa do síndico.
            <div className="rounded-lg border border-line bg-white p-4" dangerouslySetInnerHTML={{ __html: data.html }} />
          )}
        </div>
      )}
    </Modal>
  )
}
