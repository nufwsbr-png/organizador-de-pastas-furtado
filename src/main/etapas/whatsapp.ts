import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Etapa } from '../job';
import { formatarTelefone } from '../ferramentas/nomes';
import type { ArquivoWhatsapp, FonteWhatsapp } from '../ferramentas/waha';
import { ehImagem, ehPdf } from '../padrao';
import { lerCliente } from './cliente';
import { inventariar, type Inventario } from './inventario';

/** Pasta onde chega o que o cliente mandou no WhatsApp; a classificação esvazia (o que não for usado vai para Não juntar). */
export const PASTA_WHATSAPP = 'WhatsApp';

export const MENSAGEM_SEM_WAHA =
  'Para puxar os documentos que o cliente mandou no WhatsApp preciso do WAHA configurado em Ajustes → WhatsApp. Depois clique em Tentar de novo.';

/** Documentos que vêm do WhatsApp (o que já estiver na pasta não é procurado). */
export function faltamDoWhatsapp(inventario: Inventario): string[] {
  const tipos = new Set(inventario.arquivos.flatMap((a) => ((a.situacao === 'no-lugar' || a.situacao === 'mover') && 'tipo' in a ? [a.tipo] : [])));
  const faltam: string[] = [];
  if (!tipos.has('RG') && !tipos.has('CNH')) faltam.push('RG ou CNH');
  if (!tipos.has('CTPS')) faltam.push('CTPS');
  if (!tipos.has('Comprovante de residência')) faltam.push('comprovante de residência');
  return faltam;
}

const EXTENSOES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/bmp': '.bmp',
  'image/tiff': '.tif',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/plain': '.txt',
};

/** "2026-10-06 14.10 - RG frente.jpg": data e hora (de Brasília) em que o cliente mandou, e o nome original. */
export function nomeDoArquivo(a: ArquivoWhatsapp): string {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(a.quando * 1000))
      .map((p) => [p.type, p.value]),
  );
  const quando = `${partes.year}-${partes.month}-${partes.day} ${partes.hour}.${partes.minute}`;
  const original = a.nomeArquivo?.trim() ?? '';
  const ext = (extname(original) || EXTENSOES[a.mimetype.split(';')[0].trim().toLowerCase()] || '.bin').toLowerCase();
  const base = original ? original.slice(0, original.length - extname(original).length) : a.mimetype.startsWith('image/') ? 'foto' : 'documento';
  const limpo = base.replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'arquivo';
  return `${quando} - ${limpo}${ext}`;
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Hash de todos os documentos e imagens que já estão na pasta (inclusive em _substituidos), para não baixar de novo. */
function hashesDaPasta(pasta: string): Set<string> {
  const hashes = new Set<string>();
  const percorrer = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const caminho = join(dir, e.name);
      if (e.isDirectory()) percorrer(caminho);
      else if (e.isFile() && (ehImagem(e.name) || ehPdf(e.name) || /\.(docx?|txt|heic|heif)$/i.test(e.name))) hashes.add(sha256(readFileSync(caminho)));
    }
  };
  percorrer(pasta);
  return hashes;
}

/**
 * Acha a conversa do cliente no WhatsApp do escritório (pelo telefone confirmado na planilha) e baixa
 * todas as imagens e documentos que ele mandou para a pasta WhatsApp/. A classificação decide o que é cada um.
 */
export function etapaWhatsapp(fonte: () => FonteWhatsapp | null): Etapa {
  return {
    nome: 'whatsapp',
    saida: 'whatsapp.json',
    dependeDe: ['cliente'],
    async executar(ctx) {
      const arquivoInventario = join(ctx.pastaJob, 'inventario.json');
      const inventario = JSON.parse(readFileSync(arquivoInventario, 'utf8')) as Inventario;
      const faltam = faltamDoWhatsapp(inventario);
      if (faltam.length === 0) return { status: 'pulada', motivo: 'RG ou CNH, CTPS e comprovante já estão na pasta; não precisei do WhatsApp.' };

      const w = fonte();
      if (!w) return { status: 'pendente', motivo: MENSAGEM_SEM_WAHA };
      const cliente = lerCliente(ctx.pastaJob);
      if (!cliente) return { status: 'pendente', motivo: 'O cliente ainda não foi confirmado na planilha.' };
      const tel = formatarTelefone(cliente.telefone);
      ctx.log(`Procurando a conversa com ${tel} no WhatsApp (falta ${faltam.join(', ')})…`);

      const salvos: { relativo: string; id: string; quando: string }[] = [];
      let repetidos = 0;
      try {
        const conversa = await w.acharConversa(cliente.telefone);
        if (!conversa) {
          return { status: 'pendente', motivo: `Não achei conversa com ${tel} no WhatsApp do escritório. Confira o telefone na planilha ou informe outro abaixo.` };
        }
        const hashes = hashesDaPasta(ctx.job.pasta);
        const resumo = await w.midiasDoCliente(conversa, async (a) => {
          const h = sha256(a.conteudo);
          if (hashes.has(h)) {
            repetidos++;
            return;
          }
          hashes.add(h);
          const nome = nomeDoArquivo(a);
          let relativo = `${PASTA_WHATSAPP}/${nome}`;
          for (let n = 2; existsSync(join(ctx.job.pasta, relativo)); n++) relativo = `${PASTA_WHATSAPP}/${nome.slice(0, nome.length - extname(nome).length)} (${n})${extname(nome)}`;
          mkdirSync(join(ctx.job.pasta, PASTA_WHATSAPP), { recursive: true });
          writeFileSync(join(ctx.job.pasta, relativo), a.conteudo);
          salvos.push({ relativo, id: a.id, quando: new Date(a.quando * 1000).toISOString() });
        });

        for (const f of resumo.falhas.slice(0, 5)) ctx.log(`WhatsApp: um arquivo de ${new Date(f.quando * 1000).toLocaleDateString('pt-BR')} não veio (${f.motivo}).`, 'aviso');
        if (resumo.falhas.length > 5) ctx.log(`WhatsApp: mais ${resumo.falhas.length - 5} arquivo(s) não vieram.`, 'aviso');
        ctx.log(
          `WhatsApp: li ${resumo.mensagens} mensagem(ns) do cliente e salvei ${salvos.length} documento(s) ou imagem(ns) em ${PASTA_WHATSAPP}/` +
            (repetidos > 0 ? ` (${repetidos} repetido(s) ignorado(s))` : '') +
            '.',
        );
        if (salvos.length === 0 && repetidos === 0) ctx.log('Não encontrei documentos nem imagens do cliente na conversa.', 'aviso');
        if (salvos.length > 0) inventariar(ctx.job.pasta, arquivoInventario);
        writeFileSync(
          join(ctx.pastaJob, 'whatsapp.json'),
          JSON.stringify({ conversa, mensagens: resumo.mensagens, salvos, repetidos, falhas: resumo.falhas, quando: new Date().toISOString() }, null, 2),
        );
        return { status: 'ok' };
      } catch (erro) {
        if (salvos.length > 0) inventariar(ctx.job.pasta, arquivoInventario);
        return { status: 'pendente', motivo: `WhatsApp: ${erro instanceof Error ? erro.message : String(erro)}` };
      }
    },
  };
}
