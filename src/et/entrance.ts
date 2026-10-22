import type { BinetteSettingsSection } from "@binette/core";
import type { StationConfig } from "../config.ts";
import { isValidAppName } from "../apps/names.ts";
import type { AppInfo } from "../apps/types.ts";

/** 入口が転送だけを返すとき（`entrance.redirect` がある） */
export interface EntranceRedirect {
  binette: "0.1";
  redirect: string;
  settings: BinetteSettingsSection[];
}

/** 入口が有効なアプリの一覧を出すとき */
export interface EntrancePage {
  binette: "0.1";
  title: string;
  entry: string;
  assets: Record<string, { type: string; content: string }>;
  settings: BinetteSettingsSection[];
}

export type Entrance = EntranceRedirect | EntrancePage;

/** 設定画面に差し込む「アカウント」。ログアウトの部品はフロントが `components` で登録している */
const ACCOUNT: BinetteSettingsSection = { order: 10, label: "アカウント", type: "element", component: "logout" };

/** アプリ一覧の見た目。入口の css はどの画面にも入るため、クラス名に接頭辞を付けて他に影響させない */
const STYLE = `
.ebina-entrance { box-sizing: border-box; max-width: 40rem; margin: 0 auto; padding: 1rem; }
.ebina-entrance h1 { margin: 0 0 1rem; font-size: 1.25rem; }
.ebina-entrance ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.5rem; }
.ebina-entrance button {
  box-sizing: border-box; display: flex; align-items: center; gap: 0.75rem; width: 100%; min-height: 44px;
  padding: 0.5rem 0.75rem; font: inherit; color: inherit; text-align: start; cursor: pointer;
  background: color-mix(in srgb, currentColor 6%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 10px;
}
.ebina-entrance button:hover { background: color-mix(in srgb, currentColor 12%, transparent); }
.ebina-entrance button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.ebina-entrance .ebina-entrance-icon { flex: none; min-width: 1.5em; text-align: center; }
.ebina-entrance p { margin: 0; opacity: 0.7; }
`.trim();

/** アプリ一覧の画面（js の asset）。アプリの値は JSON で埋め込み、DOM には textContent だけで入れる */
function entryModule(apps: { name: string; label: string; icon?: string }[]): string {
  return `const apps = ${JSON.stringify(apps)};

export function mount(el, sh) {
  const root = document.createElement("div");
  root.className = "ebina-entrance";
  const title = document.createElement("h1");
  title.textContent = "EbinaStation";
  root.append(title);

  const controller = new AbortController();
  if (apps.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "アプリがありません";
    root.append(empty);
  } else {
    const list = document.createElement("ul");
    for (const app of apps) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      if (app.icon) {
        const icon = document.createElement("span");
        icon.className = "ebina-entrance-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = app.icon;
        button.append(icon);
      }
      const label = document.createElement("span");
      label.textContent = app.label;
      button.append(label);
      button.addEventListener("click", () => sh.navigate("/" + app.name), { signal: controller.signal });
      item.append(button);
      list.append(item);
    }
    root.append(list);
  }

  el.append(root);
  return () => {
    controller.abort();
    root.remove();
  };
}
`;
}

/**
 * 入口 `/index.bina` のビネットを作る。
 * `entrance.redirect` があればその転送。無ければ、有効なアプリの一覧を出す画面。
 * どちらにも、設定画面の「アカウント」（ログアウト）を付ける
 */
export function buildEntrance(config: StationConfig, apps: AppInfo[]): Entrance {
  const redirect = config.entrance.redirect;
  if (redirect !== undefined) {
    return { binette: "0.1", redirect, settings: [ACCOUNT] };
  }
  // 予約名のフォルダは異常として一覧に残るが、アプリではなく、押しても組み込みのパスへ移るだけなので出さない
  const enabled = apps.filter((app) => app.enabled && isValidAppName(app.name)).map((app) => ({
    name: app.name,
    label: app.label,
    ...(app.icon === undefined ? {} : { icon: app.icon }),
  }));
  return {
    binette: "0.1",
    title: "EbinaStation",
    entry: "main",
    assets: {
      main: { type: "js", content: entryModule(enabled) },
      style: { type: "css", content: STYLE },
    },
    settings: [ACCOUNT],
  };
}
