// Build da extensão NX Demo Capture: bundle com esbuild (popup, service worker e content script como scripts
// clássicos, um arquivo cada — o content script é injetado via chrome.scripting e não pode importar nada),
// cópia dos arquivos estáticos para extension/dist e o zip em public/nx-demo-capture.zip, que o painel serve
// para download (Demo Studio → Configurações → Extensão). Rodar pela raiz: `npm run build:ext`.
import { build } from 'esbuild'
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = dirname(fileURLToPath(import.meta.url))
const dist = join(raiz, 'dist')
const zip = join(raiz, '..', 'public', 'nx-demo-capture.zip')

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

await build({
  entryPoints: { background: join(raiz, 'src/background.ts'), content: join(raiz, 'src/content.ts'), popup: join(raiz, 'src/popup.ts') },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
})
for (const f of ['manifest.json', 'popup.html', 'popup.css', 'icons']) cpSync(join(raiz, f), join(dist, f), { recursive: true })

writeFileSync(zip, criarZip(arquivos(dist).map((p) => [relative(dist, p).replace(/\\/g, '/'), readFileSync(p)])))
console.log(`extensão: ${relative(join(raiz, '..'), dist)} e ${relative(join(raiz, '..'), zip)}`)

function arquivos(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? arquivos(p) : [p]
  })
}

/* Zip mínimo (método "store", sem compressão): o suficiente para o Chrome e para o Windows abrirem, sem
   depender de pacote nem de ferramenta do sistema (o build roda no Alpine do Docker). */
function criarZip(entradas) {
  const tabela = new Uint32Array(256).map((_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc32 = (buf) => {
    let c = 0xffffffff
    for (const b of buf) c = tabela[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const locais = []
  const centrais = []
  let deslocamento = 0
  for (const [nome, dados] of entradas) {
    const n = Buffer.from(nome, 'utf8')
    const crc = crc32(dados)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // nomes em UTF-8
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(0x00210000, 10) // 01/01/1980 00:00
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(dados.length, 18)
    local.writeUInt32LE(dados.length, 22)
    local.writeUInt16LE(n.length, 26)
    local.writeUInt16LE(0, 28)
    locais.push(local, n, dados)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(0x00210000, 12)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(dados.length, 20)
    central.writeUInt32LE(dados.length, 24)
    central.writeUInt16LE(n.length, 28)
    central.writeUInt32LE(deslocamento, 42)
    centrais.push(central, n)
    deslocamento += 30 + n.length + dados.length
  }
  const tamanhoCentral = centrais.reduce((t, b) => t + b.length, 0)
  const fim = Buffer.alloc(22)
  fim.writeUInt32LE(0x06054b50, 0)
  fim.writeUInt16LE(entradas.length, 8)
  fim.writeUInt16LE(entradas.length, 10)
  fim.writeUInt32LE(tamanhoCentral, 12)
  fim.writeUInt32LE(deslocamento, 16)
  return Buffer.concat([...locais, ...centrais, fim])
}
