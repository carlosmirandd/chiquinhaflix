#!/usr/bin/env python3
"""Publica o Worker da agenda na Cloudflare e liga o app a ele, de uma vez.

Uso (na pasta do projeto):
    python cloudflare/publicar.py

O que o script faz:
  1. confere se o Node.js está instalado (o publicador da Cloudflare, o "wrangler", roda nele);
  2. confere o login na Cloudflare e, se for a primeira vez, abre o navegador para você entrar
     (ou criar a conta gratuita) e autorizar — é a única parte que precisa de você;
  3. publica o Worker (cloudflare/worker.js);
  4. testa o endereço novo com uma chamada;
  5. grava o endereço em config.js e envia só esse arquivo ao GitHub, para o site passar a usá-lo.

O script não lê nem guarda senha ou token: o login é feito pelo próprio wrangler, no navegador.
"""
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


def git(*args):
    return subprocess.run(["git", "-C", RAIZ, *args], capture_output=True, text=True)


def main():
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

    url = achar_url(saida)
    if not url:
        url = input("\nNão achei o endereço na saída. Cole aqui o endereço do Worker (https://....workers.dev): ").strip().rstrip("/")
        if not URL_WORKER.fullmatch(url):
            print("Endereço inválido; nada foi alterado.")
            return 2
    print("\nEndereço do Worker:", url)

    ok, msg = testar(url)
    print("Teste:", msg)

    gravar_config(url)
    print("config.js atualizado.")

    if git("status", "--porcelain", "config.js").stdout.strip() == "":
        print("config.js já estava igual ao do GitHub; nada para enviar.")
        return 0
    for passo in (("add", "config.js"), ("commit", "-m", "Liga o app ao Worker da agenda na Cloudflare"), ("push",)):
        r = git(*passo)
        if r.returncode != 0:
            print("git %s falhou: %s" % (passo[0], (r.stderr or r.stdout).strip()))
            print("O config.js foi gravado aqui; envie-o ao GitHub quando puder.")
            return 2
    print("Pronto: enviado ao GitHub. O site passa a usar o Worker em alguns minutos (o Pages leva um tempo para atualizar).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
