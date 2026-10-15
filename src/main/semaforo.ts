/** Limita quantas tarefas assíncronas rodam ao mesmo tempo. */
export class Semaforo {
  private ativos = 0;
  private fila: Array<() => void> = [];

  constructor(public limite: number) {}

  async executar<T>(tarefa: () => Promise<T>): Promise<T> {
    await this.adquirir();
    try {
      return await tarefa();
    } finally {
      this.liberar();
    }
  }

  private adquirir(): Promise<void> {
    if (this.ativos < this.limite) {
      this.ativos++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.fila.push(() => {
        this.ativos++;
        resolve();
      });
    });
  }

  private liberar(): void {
    this.ativos--;
    const proximo = this.fila.shift();
    if (proximo) proximo();
  }
}
