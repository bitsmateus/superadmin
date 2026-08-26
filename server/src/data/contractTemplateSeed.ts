/**
 * Modelo padrão de contrato semeado na primeira execução (contract_templates). Vem do modelo real
 * usado pela NX — os trechos entre `&lt;&lt;...&gt;&gt;` são os placeholders (equivalente ao
 * "<<...>>" vermelho do documento original) que o formulário da aba Contrato detecta e preenche.
 *
 * Ajustes feitos no texto original:
 * - "<<VALOR>>" aparecia duas vezes (valor de instalação e valor mensal) — como cada placeholder
 *   vira UM campo só, isso preencheria os dois com o mesmo valor. Renomeados para
 *   "<<VALOR DE INSTALAÇÃO>>" e "<<VALOR MENSAL>>".
 * - A tabela de serviços (Cláusula 2ª) era um HTML fixo — virou o placeholder
 *   "<<Tabela de Serviços>>", preenchido a partir de uma lista repetível no formulário (ver
 *   src/lib/contractPlaceholders.ts, applyServicesTable).
 * - Vigência (Cláusula 16ª), reajuste (Cláusula 6ª) e multa rescisória (Cláusula 14ª/§1º) eram
 *   números fixos no texto (12 meses / 12 meses / 30%) — viraram placeholders
 *   "<<Vigência (meses)>>" / "<<Reajuste (meses)>>" / "<<Multa Rescisória (%)>>", com esses mesmos
 *   valores como padrão (ver defaultValueFor) — só editáveis se o cliente negociar diferente.
 * - "<<DATA>>" (Cláusula 5ª) era ambíguo — parecia data completa, mas o texto já continua "... de
 *   2026" logo depois, então só cabe o DIA do mês (ex.: 10). Renomeado pra
 *   "<<Data do Primeiro Vencimento>>" pro campo do formulário ficar claro (ver hintFor).
 */

const P = 'style="text-align:justify;margin:0 0 12pt;line-height:1.5;"'
const H3 = 'style="text-align:center;font-size:12pt;font-weight:700;margin:22pt 0 10pt;"'
const LI = 'style="margin:0 0 4pt;line-height:1.5;"'
const LILAST = 'style="margin:0 0 12pt;line-height:1.5;"'

export const DEFAULT_CONTRACT_HTML = `
<h2 style="text-align:center;font-size:14pt;font-weight:700;margin:0 0 18pt;">CONTRATO DE PRESTAÇÃO DE SERVIÇOS</h2>
<p ${P}>Pelo presente instrumento particular, <strong>&lt;&lt;Nome Fantasia&gt;&gt;</strong>, pessoa jurídica de direito privado, inscrita no CNPJ <strong>&lt;&lt;CNPJ&gt;&gt;</strong>, com sede na <strong>&lt;&lt;Logradouro/Rua&gt;&gt;</strong>, <strong>&lt;&lt;Número&gt;&gt;</strong>, <strong>&lt;&lt;Complemento&gt;&gt;</strong>, <strong>&lt;&lt;Bairro&gt;&gt;</strong>, <strong>&lt;&lt;Cidade&gt;&gt;</strong>, <strong>&lt;&lt;Estado&gt;&gt;</strong>, <strong>&lt;&lt;CEP&gt;&gt;</strong>, doravante denominada <strong>CONTRATANTE</strong>, contrata os serviços de <strong>NX NETSCALE LTDA</strong>, pessoa jurídica de direito privado, inscrita no CNPJ <strong>59.935.008/0001-92</strong>, com sede na <strong>AV. EXPEDICIONÁRIO JOSÉ PEDRO COELHO, 1237 - CENTRO - TUBARÃO/SC - 88701-005</strong>, doravante denominada <strong>CONTRATADA</strong>. As Partes, em conjunto denominadas &ldquo;Partes&rdquo; e, individualmente, &ldquo;Parte&rdquo;, têm entre si justo e contratado o seguinte:</p>

<h3 ${H3}>Título I &ndash; Objeto do Contrato</h3>
<p ${P}><strong>Cláusula 1ª</strong> - O presente instrumento tem por objeto a prestação de serviços pela <strong>CONTRATADA</strong>, consistentes na disponibilização e utilização de uma solução de gestão de atendimento ao cliente, plataforma NX. Trata-se de uma plataforma que integra múltiplos canais de comunicação, automatiza respostas 24 horas por dia, 7 dias por semana, organiza tarefas, fornece painéis de controle e relatórios gerenciais, com o objetivo de facilitar a comunicação interna, personalizar filas de atendimento e aprimorar a experiência do <strong>CONTRATANTE</strong>.</p>
<p ${P}>§ 1˚: A plataforma utilizada para a prestação dos serviços será acessada pelo endereço eletrônico <strong>https://app.nxsystems.com.br</strong> e contará com a disponibilização de <strong>&lt;&lt;NÚMERO DE TELAS&gt;&gt;</strong> telas para utilização pelo <strong>CONTRATANTE</strong>.</p>

<h3 ${H3}>Título II &ndash; Serviços</h3>
<p ${P}><strong>Cláusula 2ª:</strong> A <strong>CONTRATADA</strong> prestará serviços relativos à tabela abaixo:</p>
&lt;&lt;Tabela de Serviços&gt;&gt;
<p ${P}>§ 1˚: A <strong>CONTRATADA</strong> não se responsabiliza por quaisquer bloqueios ou indisponibilidades decorrentes de ações de terceiros, inclusive de plataformas utilizadas para a prestação dos serviços, como o WhatsApp. Caso ocorra o bloqueio ou banimento da conta de WhatsApp do <strong>CONTRATANTE</strong> (ou de qualquer outro canal integrado), a <strong>CONTRATADA</strong> não terá qualquer responsabilidade ou obrigação de indenizar, sendo seu dever apenas orientar quanto aos riscos e indicar as melhores práticas para minimizar a possibilidade de bloqueio ou banimento.</p>
<p ${P}>§ 2ª Caso o <strong>CONTRATANTE</strong> opte pela utilização de API oficial do WhatsApp ou de qualquer outro canal de comunicação que exija contratação ou integração oficial junto ao provedor, será necessário o pagamento de valores adicionais, que deverão ser previamente consultados e acordados entre as partes. Os custos referentes à contratação e utilização da API oficial serão de inteira responsabilidade do <strong>CONTRATANTE</strong>, não estando inclusos no valor pactuado neste instrumento.</p>

<h3 ${H3}>Título III &ndash; Prazos</h3>
<p ${P}><strong>Cláusula 3ª</strong> &ndash; O prazo para a implementação da plataforma, com a disponibilização de todas as funcionalidades contratadas, será de até 7 (sete) dias úteis contados a partir da confirmação do pagamento inicial e do fornecimento, pelo <strong>CONTRATANTE</strong>, de todas as informações e credenciais necessárias para a execução dos serviços.</p>
<p ${P}><strong>Cláusula 4ª</strong> &ndash; Após a entrega da plataforma, o <strong>CONTRATANTE</strong> terá direito a solicitar ajustes, correções ou adequações necessárias ao perfeito funcionamento das funcionalidades contratadas.</p>
<p ${P}>§ 1º: Qualquer solicitação formal de ajuste ou correção feita pelo <strong>CONTRATANTE</strong> à <strong>CONTRATADA</strong> terá prazo máximo de 5 (cinco) dias úteis para execução, contados a partir da data do recebimento da solicitação.</p>
<p ${P}>§ 2º: Alterações que impliquem em novas funcionalidades ou personalização não previstas neste instrumento serão objeto de orçamento específico e contratação à parte.</p>

<h3 ${H3}>Título IV &ndash; Remuneração</h3>
<p ${P}><strong>Cláusula 5ª:</strong> O <strong>CONTRATANTE</strong> se compromete a pagar ao(à) <strong>CONTRATADO(A)</strong>, o valor de instalação e mão de obra para configuração da plataforma, o valor de R$<strong>&lt;&lt;VALOR DE INSTALAÇÃO&gt;&gt;</strong> via PIX ou CARTÃO DE CRÉDITO (em até 10x c/juros) na mesma data da assinatura do presente contrato e, por meio de pagamento via PIX ou BOLETO, o valor de R$ <strong>&lt;&lt;VALOR MENSAL&gt;&gt;</strong> mensal, com o primeiro vencimento em <strong>&lt;&lt;Data do Primeiro Vencimento&gt;&gt;</strong> de 2026, e as demais no mesmo dia dos meses subsequentes, até que se finde esta obrigação.</p>
<p ${P}>§ 1º: Ocorrendo atraso no pagamento de qualquer importância ajustada no presente instrumento por prazo superior a 2 (dois) dias, o serviço será interrompido até que as pendências financeiras sejam regularizadas. Após 1 (um) mês de inadimplência, os serviços serão extintos sem possibilidade de retomada. Caso o atraso persista, a <strong>CONTRATADA</strong> poderá incluir o nome da <strong>CONTRATANTE</strong> nos cadastros de inadimplentes, como SERASA e/ou SPC, até que a dívida seja regularizada.</p>
<p ${P}>§ 2º: Em caso de atraso no pagamento do boleto, incidirá multa equivalente a 2% (dois por cento) do valor devido, mais juros de mora de 1% (um por cento) ao mês.</p>
<p ${P}>§ 3º: A <strong>CONTRATANTE</strong> deverá estar ciente de que a <strong>CONTRATADA</strong> somente realizará os serviços contratados que constarem no contrato. Qualquer pedido adicional será cobrado separadamente deste documento, mediante a prévia formulação de orçamento e aceite das partes.</p>
<p ${P}>§ 4º: Após assinado o contrato, caso haja desistência por parte do cliente, fica estabelecido que não haverá devolução de valores referentes às mensalidades já pagas.</p>
<p ${P}>§ 5º: A <strong>CONTRATADA</strong> fica responsável por enviar o boleto bancário para a <strong>CONTRATANTE</strong> até 5 (cinco) dias antes do seu vencimento, utilizando os canais de comunicação WhatsApp e/ou e-mail.</p>
<p ${P}>§ 6º: A nota fiscal será emitida e enviada à <strong>CONTRATANTE</strong> em até 10 (dez) dias úteis após o pagamento.</p>
<p ${P}>§ 7º: As partes podem adotar outra forma de pagamento, desde que uma parte informe com 30 (trinta) dias de antecedência seu desejo de alterar e a outra parte concorde expressamente, através de aditivo contratual ou simples solicitação por e-mail.</p>

<h3 ${H3}>Título V &ndash; Reajuste</h3>
<p ${P}><strong>Cláusula 6ª:</strong> Os valores deste contrato serão reajustados anualmente, sendo o prazo de &lt;&lt;Reajuste (meses)&gt;&gt; meses a partir da data de início, de acordo com o Índice de Preços no Consumo (IPCA) divulgado pelo IBRE (Instituto Brasileiro de Economia) ou outro índice oficial que vier a substituí-lo. Em caso de alteração das alíquotas dos impostos incidentes sobre a prestação de serviços ou de negociações coletivas, as partes em comum acordo poderão majorar o valor pactuado, de forma a restabelecer o equilíbrio econômico contratual.</p>

<h3 ${H3}>Título VI &ndash; Direitos autorais</h3>
<p ${P}><strong>Cláusula 7ª:</strong> A <strong>CONTRATANTE</strong> é a titular dos direitos autorais patrimoniais sobre todas as imagens e vídeos disponibilizados para os trabalhos e sobre todos os trabalhos publicitários desenvolvidos pela <strong>CONTRATADA</strong> e por seus profissionais, para publicação nas redes sociais da contratante, por tempo indeterminado, para fazer uso a qualquer tempo e modo como bem entender.</p>

<h3 ${H3}>Título VII &ndash; Proteção da imagem</h3>
<p ${P}><strong>Cláusula 8ª:</strong> A <strong>CONTRATADA</strong> se compromete a adotar todas as medidas técnicas e administrativas razoáveis para proteger os dados e informações fornecidos pelo <strong>CONTRATANTE</strong>, garantindo, na medida do possível, sua integridade, confidencialidade e disponibilidade, em conformidade com a legislação aplicável, incluindo a Lei Geral de Proteção de Dados Pessoais &ndash; LGPD (Lei nº 13.709/2018).</p>
<p ${P}>§ 1º: O <strong>CONTRATANTE</strong> reconhece que, embora a <strong>CONTRATADA</strong> empregue práticas adequadas de segurança, não é possível garantir proteção absoluta contra incidentes de segurança decorrentes de fatores externos, tais como invasões, ataques cibernéticos, falhas em serviços de terceiros ou ações alheias à sua atuação.</p>
<p ${P}>§ 2º: Fica estabelecido que a <strong>CONTRATADA</strong> não será responsável por quaisquer danos, prejuízos ou perdas resultantes de incidentes de segurança ocorridos por causas fora do seu controle, cabendo ao <strong>CONTRATANTE</strong> adotar medidas internas complementares para proteção de suas informações.</p>

<h3 ${H3}>Título VIII &ndash; Sigilo</h3>
<p ${P}><strong>Cláusula 9ª:</strong> Se durante a vigência deste contrato, qualquer uma das partes vier a tomar conhecimento e/ou receber informações concernentes a segredo industrial e/ou comercial e ideias patenteáveis ou não, bem como quaisquer outras informações de natureza confidencial tituladas pela outra, a referida parte obriga-se por si, e/ou quaisquer outras pessoas sob sua responsabilidade, que vierem a ter acesso a tais informações, a mantê-las em absoluto sigilo, sendo-lhe vedado, durante a vigência deste contrato e nos 48 (quarenta e oito) meses imediatamente subsequentes, revelar essas informações a terceiros, em qualquer hipótese.</p>

<h3 ${H3}>Título X &ndash; Deveres das Partes</h3>
<p ${P}><strong>Cláusula 10ª:</strong> Fica estabelecido que são obrigações da <strong>CONTRATANTE</strong>:</p>
<p ${LI}>a) Efetuar o pagamento, de acordo com o estabelecido na cláusula quarta do presente contrato.</p>
<p ${LI}>b) Fornecer à <strong>CONTRATADA</strong> os materiais e informações indispensáveis ao seu serviço, facilitando a execução dos serviços contratados.</p>
<p ${LI}>c) Responder de forma exclusiva pelos seus encargos trabalhistas, fiscais, comerciais e previdenciários decorrentes da execução dos serviços, se houver, sem qualquer responsabilidade subsidiária ou solidária da outra parte.</p>
<p ${LILAST}>d) Agir de forma ética e respeitar todas as leis vigentes no Brasil.</p>
<p ${P}><strong>Cláusula 11ª:</strong> Fica estabelecido que são obrigações da <strong>CONTRATADA</strong>:</p>
<p ${LI}>a) Cumprir o estipulado nos termos do presente instrumento contratual.</p>
<p ${LI}>b) Prestar informações à <strong>CONTRATANTE</strong>, sempre que este lhe solicitar, informando sobre a execução de seus serviços e demais detalhes sobre a execução de suas atividades.</p>
<p ${LI}>c) Responder de forma exclusiva pelos seus encargos trabalhistas, fiscais, comerciais e previdenciários decorrentes da execução dos serviços, se houver, sem qualquer responsabilidade subsidiária ou solidária da outra parte.</p>
<p ${LILAST}>d) Agir de forma ética e respeitar todas as leis vigentes no Brasil.</p>

<h3 ${H3}>Título XI &ndash; Rescisão</h3>
<p ${P}><strong>Cláusula 12ª:</strong> São motivos para que a <strong>CONTRATANTE</strong> rescinda o presente instrumento:</p>
<p ${LI}>a) Desídia da <strong>CONTRATADA</strong> no cumprimento das obrigações assumidas para com a <strong>CONTRATANTE</strong>.</p>
<p ${LI}>b) Praticar atos, que atinjam a imagem comercial da <strong>CONTRATANTE</strong> perante terceiros.</p>
<p ${LI}>c) Deixar de cumprir a <strong>CONTRATADA</strong>, qualquer das cláusulas dispostas no presente instrumento.</p>
<p ${LILAST}>d) Término do prazo ajustado.</p>
<p ${P}><strong>Cláusula 13ª:</strong> São motivos para que a <strong>CONTRATADA</strong> rescindir o presente instrumento:</p>
<p ${LI}>a) Deixar a <strong>CONTRATANTE</strong> de observar quaisquer obrigações que conste no presente contrato.</p>
<p ${LI}>b) Deixar a <strong>CONTRATANTE</strong> de cumprir com o disposto na cláusula quarta deste contrato.</p>
<p ${LI}>c) Por motivos de força maior.</p>
<p ${LILAST}>d) Término do prazo ajustado.</p>
<p ${P}><strong>Cláusula 14ª:</strong> Havendo interesse em sua rescisão, após o prazo de vigência deste contrato, a parte interessada notificará a outra parte por escrito e com assinatura do representante legal da empresa, com antecedência mínima de trinta (30) dias, sob pena de multa equivalente à &lt;&lt;Multa Rescisória (%)&gt;&gt;% de uma mensalidade, no valor previsto na cláusula 4ª.</p>
<p ${P}>§ 1º: Se a <strong>CONTRATANTE</strong> rescindir o contrato antes do prazo de vigência ficará sujeita ao pagamento de multa equivalente &lt;&lt;Multa Rescisória (%)&gt;&gt;% da remuneração prevista na cláusula 4ª até o término do prazo de vigência deste contrato.</p>
<p ${P}><strong>Cláusula 15ª:</strong> Na hipótese de cessação de determinada prestação de serviço, por qualquer motivo, as partes devolverão, em um prazo máximo de 30 dias, a quem de direito, quaisquer documentos, fórmulas, processos, desenhos em papel ou arquivo eletrônico e demais especificações que estejam em seu poder para a prestação do serviço descontinuado.</p>

<h3 ${H3}>Título XII &ndash; Vigência</h3>
<p ${P}><strong>Cláusula 16ª:</strong> O presente contrato terá vigência pelo prazo de &lt;&lt;Vigência (meses)&gt;&gt; meses, com renovação automática se nenhuma parte manifestar por escrito interesse em rescindir.</p>

<h3 ${H3}>Título XIII &ndash; Disposições gerais</h3>
<p ${P}><strong>Cláusula 17ª:</strong> A <strong>CONTRATADA</strong> poderá extinguir o presente contrato, a qualquer tempo, mediante prévia notificação ao <strong>CONTRATANTE</strong> sempre que, a seu critério, considerar caracterizado algum tipo de infração aos dispositivos constantes deste presente contrato;</p>
<p ${P}><strong>Cláusula 18ª:</strong> A <strong>CONTRATADA</strong> poderá transferir ou delegar as atribuições e responsabilidades que assume por força deste contrato a terceiros sob sua responsabilidade;</p>
<p ${P}><strong>Cláusula 19ª:</strong> A <strong>CONTRATANTE</strong> fica isenta de toda e qualquer responsabilidade pelo não cumprimento da <strong>CONTRATADA</strong> de determinações administrativas e/ou legais relativas à execução do objeto do presente instrumento;</p>
<p ${P}><strong>Cláusula 20ª:</strong> Os signatários do presente contrato assegurem e afirmam que são os representantes legais competentes para assumir em nome das partes as obrigações descritas neste contrato e representar de forma efetiva seus interesses;</p>
<p ${P}><strong>Cláusula 21ª:</strong> As partes são contratantes totalmente independentes, sendo cada uma inteiramente responsável por seus atos, obrigações e conteúdo das informações prestadas, em toda e qualquer circunstância, visto que o presente instrumento não cria vínculo empregatício e nem de representação comercial entre elas, e nenhuma delas poderá declarar que possui qualquer autoridade para assumir ou criar qualquer obrigação, expressa ou implícita, em nome da outra, e nem representá-la sob nenhum pretexto e em nenhuma situação;</p>
<p ${P}><strong>Cláusula 22ª:</strong> O não exercício por qualquer das partes de direitos ou faculdades que lhe assistam em decorrência do presente contrato, ou a tolerância com o atraso no cumprimento das obrigações da outra parte, não afetará aqueles direitos ou faculdades, os quais poderão ser exercidos a qualquer tempo, a exclusivo critério do interessado, não alterando as condições neste instrumento estipuladas;</p>
<p ${P}><strong>Cláusula 23ª:</strong> A impossibilidade de prestação do serviço causada por incorreção em informação fornecida pela <strong>CONTRATANTE</strong> ou por omissão no provimento de informação essencial à prestação, não caracteriza descumprimento de obrigação contratual isentando-o de toda e qualquer responsabilidade, ao tempo em que configuraram o não cumprimento de obrigação por parte da <strong>CONTRATANTE</strong>;</p>
<p ${P}><strong>Cláusula 24ª:</strong> Os contatos e/ou comunicação de expediente entre as partes far-se-á exclusivamente por WhatsApp, respeitando-se o horário de segunda a sexta, das 9h às 12h e a partir das 14h às 17h, e as respostas serão efetuadas em até 48 horas. A <strong>CONTRATADA</strong> fica isenta de cumprir qualquer demanda fora do horário acordado neste contrato.</p>
<p ${P}><strong>Cláusula 25ª:</strong> Cada uma das Partes será responsável, em todos os aspectos por seus negócios, atividades e obrigações de qualquer natureza, inclusive civis, comerciais, trabalhistas, fiscais e previdenciários, não havendo também qualquer espécie de vínculo ou responsabilidade recíproca por resultados.</p>

<h3 ${H3}>Título XIV &ndash; Foro</h3>
<p ${P}><strong>Cláusula 26ª:</strong> As partes elegem o Foro do município de Tubarão/SC, para dirimir judicialmente as controvérsias inerentes do presente contrato.</p>
<p ${P}>E, assim por estarem justos e contratados assinam o presente, em 2 (duas) vias de igual forma, teor, na presença das testemunhas abaixo:</p>
<p style="margin:20pt 0 40pt;">Tubarão, &lt;&lt;Data de início&gt;&gt;.</p>

<table style="width:100%;border-collapse:collapse;margin-top:20pt;">
  <tr>
    <td style="width:50%;text-align:center;vertical-align:top;padding:0 10pt;">
      <div style="font-weight:700;margin-bottom:40pt;">CONTRATANTE</div>
      <div style="border-top:1px solid #333;width:80%;margin:0 auto 6pt;"></div>
      <div style="font-weight:700;">&lt;&lt;Razão Social&gt;&gt;</div>
      <div>CNPJ: &lt;&lt;CNPJ&gt;&gt;</div>
    </td>
    <td style="width:50%;text-align:center;vertical-align:top;padding:0 10pt;">
      <div style="font-weight:700;margin-bottom:40pt;">CONTRATADA</div>
      <div style="border-top:1px solid #333;width:80%;margin:0 auto 6pt;"></div>
      <div style="font-weight:700;">NX NETSCALE LTDA</div>
      <div>CNPJ: 59.935.008/0001-92</div>
    </td>
  </tr>
</table>
`.trim()
