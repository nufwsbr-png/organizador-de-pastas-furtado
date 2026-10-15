import { Semaforo } from '../src/main/semaforo';

describe('Semaforo', () => {
  it('limita a quantidade de execuções simultâneas', async () => {
    const sem = new Semaforo(2);
    let ativos = 0;
    let pico = 0;
    const tarefa = () =>
      sem.executar(async () => {
        ativos++;
        pico = Math.max(pico, ativos);
        await new Promise((r) => setTimeout(r, 20));
        ativos--;
      });
    await Promise.all([tarefa(), tarefa(), tarefa(), tarefa(), tarefa()]);
    expect(pico).toBe(2);
  });

  it('libera a vaga mesmo quando a tarefa falha', async () => {
    const sem = new Semaforo(1);
    await expect(
      sem.executar(async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow('x');
    const ok = await sem.executar(async () => 42);
    expect(ok).toBe(42);
  });
});
