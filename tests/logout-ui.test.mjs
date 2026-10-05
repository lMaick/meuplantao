import assert from "node:assert/strict";
import test, { describe } from "node:test";
import fs from "node:fs";

const perfilSource = fs.readFileSync("src/app/perfil/page.tsx", "utf8");
const settingsSource = fs.readFileSync("src/app/configuracoes/page.tsx", "utf8");
const buttonSource = fs.readFileSync("src/lib/auth/logout-button.tsx", "utf8");
const logoutSource = fs.readFileSync("src/lib/auth/logout.ts", "utf8");

describe("MAI-122 logout UI: perfil e configuracoes", () => {
  test("perfil exibe dados do usuario e botao Sair da Conta", () => {
    assert.match(perfilSource, /LogoutButton/);
    assert.match(perfilSource, /Sair da Conta|logout-button|Sessão &/);
    assert.match(buttonSource, /Sair da Conta/);
    assert.match(perfilSource, /auth\.getUser/);
    assert.match(perfilSource, /\/login/);
  });

  test("perfil usa skeleton proporcional durante o carregamento", () => {
    assert.match(perfilSource, /animate-pulse/);
    assert.match(perfilSource, /role="status"|aria-busy|Carregando/);
    assert.match(perfilSource, /motion-reduce:animate-none/);
  });

  test("configuracoes tem secao Conta & Sessao com logout padronizado", () => {
    assert.match(settingsSource, /Conta &/);
    assert.match(settingsSource, /Sess[aã]o/);
    assert.match(settingsSource, /LogoutButton/);
    assert.match(settingsSource, /\/login/);
    assert.match(settingsSource, /variant="destructive"/);
  });

  test("LogoutButton encerra sessao no Supabase e redireciona para /login", () => {
    assert.match(buttonSource, /logoutAndRedirect/);
    assert.match(buttonSource, /auth\.signOut/);
    assert.match(buttonSource, /router\.replace/);
    assert.match(logoutSource, /\/login/);
    assert.match(buttonSource, /Não foi possível sair/);
  });

  test("LogoutButton respeita acessibilidade e touch target >= 44px", () => {
    assert.match(buttonSource, /aria-label/);
    assert.match(buttonSource, /aria-busy/);
    assert.match(buttonSource, /disabled=\{loading\}/);
    assert.match(buttonSource, /min-h-\[44px\]/);
    assert.match(buttonSource, /data-testid="logout-button"/);
  });
});
