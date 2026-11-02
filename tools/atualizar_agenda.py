#!/usr/bin/env python3
"""Gera o agenda.json do ChiquinhaFlix a partir da lista de eventos do SuperFlix.

O navegador não consegue ler essa API direto (CORS), então este script faz a
chamada pelo servidor e salva só os campos que o app usa.

Uso:
    python tools/atualizar_agenda.py                    # atualiza (no máximo a cada 5 min)
    python tools/atualizar_agenda.py --force            # ignora o intervalo mínimo
    python tools/atualizar_agenda.py --publicar         # atualiza e envia o agenda.json ao GitHub
                                                        # (para o site do Pages mostrar a agenda)

Cuidado com o limite de requisições do SuperFlix: o script faz UMA chamada e,
se levar "429 Muitas requisições", espera o tempo que o servidor pediu e tenta
mais uma vez. Se falhar de novo, ele para e mantém o agenda.json antigo.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

URL = "https://superflixapi.fun/lista?category=eventos&format=json"
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARQUIVO = os.path.join(RAIZ, "agenda.json")
INTERVALO_MINIMO = 5 * 60          # segundos entre duas atualizações
ID_OK = re.compile(r"^[A-Za-z0-9_-]{1,120}$")


def idade_do_arquivo():
    """Segundos desde a última geração, ou None se não houver agenda válida."""
    try:
        with open(ARQUIVO, encoding="utf-8") as f:
            gerado = json.load(f).get("gerado")
        if not gerado:
            return None
        return (datetime.now(timezone.utc) - datetime.fromisoformat(gerado)).total_seconds()
    except (OSError, ValueError, json.JSONDecodeError):
        return None


def baixar():
    req = urllib.request.Request(URL, headers={
        "User-Agent": "Mozilla/5.0 (compatible; ChiquinhaFlix/1.0; uso pessoal)",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def compactar(e):
    ident = e.get("public_slug") or e.get("base_public_slug") or e.get("slug") or ""
    if not ID_OK.match(ident):
        return None
    canais = []
    for m in e.get("embeds") or []:
        if m.get("type") == "channel" and ID_OK.match(m.get("slug") or ""):
            canais.append([m.get("provider") or m["slug"], m["slug"], m.get("quality") or ""])
    return {
        "i": ident,
        "t": e.get("title") or ident,
        "st": e.get("status") or "upcoming",
        "sp": e.get("category") or "",
        "c": e.get("competition") or "",
        "d": e.get("start_time") or "",
        "a": e.get("time1_name") or "",
        "b": e.get("time2_name") or "",
        "la": e.get("time1") or "",
        "lb": e.get("time2") or "",
        "el": e.get("event_logo") or "",
        "e": canais,
    }


def atualizar(forcar=False):
    """Atualiza o agenda.json. Retorna (ok, mensagem)."""
    idade = idade_do_arquivo()
    if not forcar and idade is not None and idade < INTERVALO_MINIMO:
        return True, "agenda ainda recente (%d s); nada a fazer" % idade

    dados = None
    for tentativa in (1, 2):
        try:
            dados = baixar()
            break
        except urllib.error.HTTPError as erro:
            if erro.code == 429 and tentativa == 1:
                try:
                    espera = int(json.load(erro).get("retry_after", 10))
                except Exception:
                    espera = 10
                time.sleep(min(max(espera, 5), 30) + 1)
                continue
            return False, "o SuperFlix respondeu HTTP %d; agenda.json mantido" % erro.code
        except (urllib.error.URLError, TimeoutError, ValueError) as erro:
            return False, "falha ao baixar (%s); agenda.json mantido" % erro

    if not dados or not dados.get("success") or not isinstance(dados.get("data"), list):
        return False, "resposta inesperada do SuperFlix; agenda.json mantido"

    eventos = [x for x in (compactar(e) for e in dados["data"]) if x]
    saida = {"gerado": datetime.now(timezone.utc).isoformat(timespec="seconds"), "eventos": eventos}
    tmp = ARQUIVO + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, ARQUIVO)
    return True, "%d eventos salvos em agenda.json" % len(eventos)


def publicar():
    """Envia o agenda.json para o GitHub, para o site do Pages usar a agenda nova."""
    def git(*args):
        return subprocess.run(["git", "-C", RAIZ, *args], capture_output=True, text=True)

    if git("status", "--porcelain", "agenda.json").stdout.strip() == "":
        return True, "agenda.json já está igual ao do GitHub; nada para publicar"
    agora = datetime.now().strftime("%d/%m/%Y %H:%M")
    for passo in (("add", "agenda.json"), ("commit", "-m", "Atualiza agenda (" + agora + ")"), ("push",)):
        r = git(*passo)
        if r.returncode != 0:
            return False, "git %s falhou: %s" % (passo[0], (r.stderr or r.stdout).strip())
    return True, "agenda.json publicado no GitHub (o Pages leva alguns minutos para atualizar)"


if __name__ == "__main__":
    ok, msg = atualizar("--force" in sys.argv)
    print(msg)
    if ok and "--publicar" in sys.argv:
        ok, msg = publicar()
        print(msg)
    sys.exit(0 if ok else 2)
