// Contrato entre o servidor e as rotas das questões.

// Rotas próprias da questão: caminho exato → resposta.
export type Rotas = Record<string, (url: URL) => Promise<Response>>;

// Dados extras que uma questão acrescenta à gaveta de um município
// (/api/municipality/:id). O objeto devolvido é mesclado à resposta.
export type ExtensaoMunicipio = (codigo: string) => Promise<Record<string, unknown>>;

// Dados extras que uma questão acrescenta à ficha de um candidato
// (/api/candidate/:id). Recebe as candidaturas (ano, sq) da pessoa.
export type ExtensaoCandidato = (
  id: number,
  candidaturas: Record<string, unknown>[],   // { ano_eleicao, sq_candidato }
) => Promise<Record<string, unknown>>;

export interface QuestaoApi {
  rotas?: Rotas;
  municipio?: ExtensaoMunicipio;
  candidato?: ExtensaoCandidato;
}
