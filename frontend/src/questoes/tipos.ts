// Contrato de uma questão no frontend. Cada arquivo src/questoes/pN-*.ts exporta
// por padrão um objeto assim; o painel e as gavetas só conversam com ele.
export interface Questao {
  id: string;            // usado no endereço: #/SP/p4
  numero: string;        // "P4"
  titulo: string;        // título do card e do painel
  pergunta: string;      // a pergunta como está no enunciado
  resumo: string;        // uma frase no card
  onde?: string;         // rodapé do card (padrão: recorte por estado ou estado e ano)
  usaAno?: boolean;      // true: o painel mostra os anos do estado escolhido
  // desenha a questão no painel; chamado ao abrir e a cada troca de estado ou ano
  montar(el: HTMLElement): void | Promise<void>;
  // opcionais: o que a questão acrescenta às gavetas
  gavetaMunicipio?(m: any): { html: string; ligar?(corpo: HTMLElement): void } | null;
  fichaCandidatura?(candidatura: any, historico: any): string;
  aoAbrirGaveta?(corpo: HTMLElement): void;
}
