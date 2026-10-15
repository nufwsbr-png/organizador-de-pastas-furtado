import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Fila } from '../src/main/fila';

function pastaTemp(): string {
  return mkdtempSync(join(tmpdir(), 'fila-'));
}

describe('Fila persistente', () => {
  it('adiciona uma pasta como job na fila e grava jobs.json atomicamente', () => {
    const dir = pastaTemp();
    const fila = new Fila(join(dir, 'jobs.json'));
    const job = fila.adicionar('C:\\Clientes\\Maria Silva');
    expect(job.estado).toBe('na-fila');
    expect(job.nome).toBe('Maria Silva');
    expect(job.id).toMatch(/^[a-z0-9-]+$/);
    const gravado = JSON.parse(readFileSync(join(dir, 'jobs.json'), 'utf8'));
    expect(gravado.jobs).toHaveLength(1);
    expect(existsSync(join(dir, 'jobs.json.tmp'))).toBe(false);
  });

  it('não duplica a mesma pasta', () => {
    const fila = new Fila(join(pastaTemp(), 'jobs.json'));
    const a = fila.adicionar('C:\\Clientes\\Maria');
    const b = fila.adicionar('c:\\clientes\\maria\\');
    expect(b.id).toBe(a.id);
    expect(fila.listar()).toHaveLength(1);
  });

  it('ao carregar, job que estava rodando volta para a fila (retomada)', () => {
    const arquivo = join(pastaTemp(), 'jobs.json');
    const fila = new Fila(arquivo);
    const job = fila.adicionar('C:\\Clientes\\Ana');
    fila.atualizar(job.id, { estado: 'rodando', etapa: 'transcricao' });
    const outra = new Fila(arquivo);
    const [carregado] = outra.listar();
    expect(carregado.estado).toBe('na-fila');
    expect(carregado.etapa).toBe('transcricao');
  });

  it('mantém concluídos e registra mensagens com hora', () => {
    const arquivo = join(pastaTemp(), 'jobs.json');
    const fila = new Fila(arquivo);
    const job = fila.adicionar('C:\\Clientes\\Ana');
    fila.mensagem(job.id, 'Transcrevendo áudio…', 'info');
    fila.atualizar(job.id, { estado: 'concluido' });
    const outra = new Fila(arquivo);
    const [c] = outra.listar();
    expect(c.estado).toBe('concluido');
    expect(c.mensagens[0].texto).toBe('Transcrevendo áudio…');
    expect(c.mensagens[0].quando).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('arquivo corrompido não derruba o app: começa vazio', () => {
    const arquivo = join(pastaTemp(), 'jobs.json');
    writeFileSync(arquivo, '{ isso não é json');
    const fila = new Fila(arquivo);
    expect(fila.listar()).toEqual([]);
  });
});
