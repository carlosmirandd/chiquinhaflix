#!/usr/bin/env python3
"""Publica o Worker da agenda na Cloudflare e liga o app a ele, de uma vez.

Uso (na pasta do projeto):
    python cloudflare/publicar.py --tmdb SUA_CHAVE_DA_TMDB
    python cloudflare/publicar.py            (se a chave já foi guardada antes, ou para pedir a chave na tela)

O que o script faz:
  1. confere se o Node.js está instalado (o publicador da Cloudflare, o "wrangler", roda nele);
  2. confere o login na Cloudflare e, se for a primeira vez, abre o navegador para você entrar
     (ou criar a conta gratuita) e autorizar — é a única parte que precisa de você;
  3. publica o Worker (cloudflare/worker.js);
  4. guarda a chave da TMDB como segredo do Worker (ela não vai para o site nem para o GitHub);
  5. testa o endereço novo (agenda e TMDB) com uma chamada;
  6. grava o endereço em config.js e envia só esse arquivo ao GitHub, para o site passar a usá-lo.

O script não lê nem guarda senha: o login é feito pelo próprio wrangler, no navegador. A chave da TMDB
só passa direto para o wrangler (entrada padrão), não é gravada em nenhum arquivo daqui.
"""
import argparse
import getpass
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASTA = os.path.join(RAIZ, "cloudflare")
CONFIG = os.path.join(RAIZ, "config.js")
URL_WORKER = re.compile(r"https://[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.workers\.dev")


def achar_url(texto):
    """Pega o endereço *.workers.dev na saída do wrangler (ou None)."""
    achados = URL_WORKER.findall(texto or "")
    return achados[-1].rstrip("/") if achados else None


def gravar_config(url):
    conteudo = (
        "// Endereço do Worker da Cloudflare que lê a agenda do SuperFlix (veja cloudflare/LEIAME.md).\n"
        "// Gerado por cloudflare/publicar.py. Deixe vazio para o app usar só o agenda.json.\n"
        "window.CHIQUINHA_AGENDA_URL = %s;\n" % json.dumps(url)
    )
    with open(CONFIG, "w", encoding="utf-8", newline="\n") as f:
        f.write(conteudo)


def rodar(cmd, mostrar=True):
    """Roda um comando mostrando a saída ao vivo (inclusive perguntas) e devolvendo o texto todo."""
    p = subprocess.Popen(cmd, cwd=PASTA, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", shell=(os.name == "nt"))
    buf = []
    while True:
        c = p.stdout.read(1)
        if c == "" and p.poll() is not None:
            break
        if c:
            buf.append(c)
            if mostrar:
                sys.stdout.write(c)
                sys.stdout.flush()
    return p.returncode, "".join(buf)


def testar(url):
    try:
        req = urllib.request.Request(url + "/agenda", headers={"User-Agent": "ChiquinhaFlix-teste"})
        with urllib.request.urlopen(req, timeout=30) as r:
            dados = json.load(r)
        return True, "%d eventos recebidos" % len(dados.get("eventos", []))
    except urllib.error.HTTPError as e:
        return False, "o Worker respondeu HTTP %d (o SuperFlix pode estar limitando; o app usa o plano B)" % e.code
    except Exception as e:
        return False, "não consegui testar agora (%s)" % e


def testar_tmdb(url):
    try:
        req = urllib.request.Request(url + "/tmdb/trending/tv/day", headers={"User-Agent": "ChiquinhaFlix-teste"})
        with urllib.request.urlopen(req, timeout=30) as r:
            dados = json.load(r)
        return True, "%d séries recebidas da TMDB" % len(dados.get("results", []))
    except urllib.error.HTTPError as e:
        try:
            detalhe = json.load(e).get("erro", "")
        except Exception:
            detalhe = ""
        return False, "o Worker respondeu HTTP %d %s" % (e.code, detalhe)
    except Exception as e:
        return False, "não consegui testar agora (%s)" % e


def chave_tmdb_existe():
    codigo, saida = rodar(["npx", "--yes", "wrangler", "secret", "list"], mostrar=False)
    return codigo == 0 and '"TMDB_KEY"' in saida


def guardar_chave_tmdb(chave):
    """Entrega a chave ao wrangler pela entrada padrão (não aparece em argumento nem em arquivo)."""
    r = subprocess.run(["npx", "--yes", "wrangler", "secret", "put", "TMDB_KEY"], cwd=PASTA, input=chave + "\n",
                       capture_output=True, text=True, encoding="utf-8", errors="replace", shell=(os.name == "nt"))
    if r.returncode != 0:
        print((r.stderr or r.stdout).replace(chave, "***").strip())
    return r.returncode == 0


def git(*args):
    return subprocess.run(["git", "-C", RAIZ, *args], capture_output=True, text=True)


def main():
    ap = argparse.ArgumentParser(description="Publica o Worker da Cloudflare e liga o app a ele.")
    ap.add_argument("--tmdb", metavar="CHAVE", help="chave da API da TMDB (v3, 32 caracteres, ou o token v4 que começa com eyJ)")
    args = ap.parse_args()
    chave = (args.tmdb or os.environ.get("TMDB_KEY") or "").strip()
    if chave and not re.fullmatch(r"[A-Za-z0-9._-]{20,600}", chave):
        print("A chave da TMDB parece inválida (só letras, números, ponto, _ e -). Nada foi feito.")
        return 2
    if not shutil.which("node") or not shutil.which("npx"):
        print("Falta o Node.js. Instale a versão LTS em https://nodejs.org, abra um terminal novo e rode de novo.")
        return 2

    print("== Conferindo o login na Cloudflare ==")
    codigo, saida = rodar(["npx", "--yes", "wrangler", "whoami"], mostrar=False)
    if codigo != 0 or "not authenticated" in saida.lower() or "you are not" in saida.lower():
        print("Você ainda não está logado. Vou abrir o navegador: entre (ou crie a conta gratuita) e clique em Permitir.\n")
        codigo, _ = rodar(["npx", "--yes", "wrangler", "login"])
        if codigo != 0:
            print("\nO login não foi concluído. Rode o comando de novo quando quiser.")
            return 2

    print("\n== Publicando o Worker ==")
    codigo, saida = rodar(["npx", "--yes", "wrangler", "deploy"])
    if codigo != 0:
        print("\nA publicação falhou (veja a mensagem acima). Se pediu para registrar um subdomínio workers.dev, aceite e rode de novo.")
        return 2

    if not chave and not chave_tmdb_existe():
        chave = getpass.getpass("\nCole a chave da TMDB (não aparece na tela) ou só Enter para pular: ").strip()
    if chave:
        print("\n== Guardando a chave da TMDB como segredo do Worker ==")
        if guardar_chave_tmdb(chave):
            print("Chave guardada.")
        else:
            print("Não consegui guardar a chave. Rode de novo com --tmdb SUA_CHAVE.")
            return 2
    else:
        print("\nSem chave da TMDB: o catálogo de séries só funciona depois que ela for guardada.")

    url = achar_url(saida)
    if not url:
        url = input("\nNão achei o endereço na saída. Cole aqui o endereço do Worker (https://....workers.dev): ").strip().rstrip("/")
        if not URL_WORKER.fullmatch(url):
            print("Endereço inválido; nada foi alterado.")
            return 2
    print("\nEndereço do Worker:", url)

    ok, msg = testar(url)
    print("Teste da agenda:", msg)
    ok2, msg2 = testar_tmdb(url)
    print("Teste da TMDB:", msg2)

    if not ok2:
        print("\nO catálogo da TMDB não respondeu, então NÃO enviei o site ao GitHub (ele ficaria sem séries).")
        print("Confira a chave da TMDB e rode de novo: python cloudflare/publicar.py --tmdb SUA_CHAVE")
        return 2

    gravar_config(url)
    print("config.js atualizado.")

    passos = []
    if git("status", "--porcelain", "config.js").stdout.strip() != "":
        passos += [("add", "config.js"), ("commit", "-m", "Liga o app ao Worker da Cloudflare")]
    # envia também commits que estavam só aqui esperando o Worker ficar pronto (ex.: o catálogo da TMDB)
    adiante = git("rev-list", "--count", "@{u}..HEAD").stdout.strip()
    if passos or adiante not in ("", "0"):
        passos.append(("push",))
    if not passos:
        print("Nada para enviar ao GitHub: tudo já estava publicado.")
        return 0
    for passo in passos:
        r = git(*passo)
        if r.returncode != 0:
            print("git %s falhou: %s" % (passo[0], (r.stderr or r.stdout).strip()))
            print("O Worker já está publicado; envie as alterações ao GitHub quando puder (git push).")
            return 2
    print("Pronto: enviado ao GitHub. O site passa a usar o novo catálogo em alguns minutos (o Pages leva um tempo para atualizar).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
