"""Validação transacional do carregador; executa sem banco externo."""
import unittest
import carregar_vies_partidos as carga


class Conexao:
    def __init__(self, cobertura):
        self.resultado = cobertura
        self.comandos = []

    def execute(self, sql):
        self.comandos.append(sql)
        return self

    def executemany(self, *_):
        pass

    def fetchall(self):
        return self.resultado


class TransacaoTest(unittest.TestCase):
    def test_valida_antes_do_commit(self):
        for valores in [[(2018, 99.8), (2020, 100), (2022, 100), (2024, 100)],
                        [(2018, None), (2020, 100), (2022, 100), (2024, 100)],
                        [(2018, 100)]]:
            with self.subTest(valores=valores):
                con = Conexao(valores)
                with self.assertRaises(ValueError):
                    carga.gravar(con, [], [])
                self.assertNotIn('COMMIT', con.comandos)
                self.assertEqual(con.comandos[-1], 'ROLLBACK')

    def test_cobertura_completa(self):
        con = Conexao([(ano, 100) for ano in carga.ONDA_POR_ELEICAO])
        carga.gravar(con, [], [])
        self.assertEqual(con.comandos[-1], 'COMMIT')


if __name__ == '__main__':
    unittest.main()
