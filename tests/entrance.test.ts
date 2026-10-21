import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { type BinetteSettingsSection, parseBinette } from "@binette/core";
import { Buffer } from "node:buffer";
import { buildEntrance, type EntrancePage } from "../src/et/entrance.ts";
import { fakeApp, testConfig } from "./helpers/station.ts";

const ACCOUNT: BinetteSettingsSection = { order: 10, label: "アカウント", type: "element", component: "logout" };

function isPage(entrance: ReturnType<typeof buildEntrance>): entrance is EntrancePage {
  return "entry" in entrance;
}

function pageOf(entrance: ReturnType<typeof buildEntrance>): EntrancePage {
  assert(isPage(entrance), "アプリ一覧の入口のはずが転送になっている");
  return entrance;
}

Deno.test("entrance: entrance.redirect があれば転送と「アカウント」だけ", () => {
  const entrance = buildEntrance(testConfig({ entrance: { redirect: "/binette-editor" } }), [fakeApp("notes")]);
  assertEquals(entrance, { binette: "0.1", redirect: "/binette-editor", settings: [ACCOUNT] });
  const parsed = parseBinette(JSON.stringify(entrance));
  assertEquals(parsed.redirect, "/binette-editor");
  assertEquals(parsed.entry, undefined);
  assertEquals(parsed.settings, [ACCOUNT]);
});

Deno.test("entrance: 予約名のフォルダは、有効で異常でも一覧に出さない", () => {
  const apps = [
    fakeApp("notes", { label: "ノート" }),
    // 予約名のフォルダ（registry が理由つきの異常として返す）。押すと組み込みのパスへ移ってしまう
    ...["settings", "index", "me", "station", "ebina"].map((name) =>
      fakeApp(name, { label: name, status: "error", error: "予約されています" })
    ),
  ];
  const page = pageOf(buildEntrance(testConfig(), apps));
  assert(page.assets.main.content.includes('const apps = [{"name":"notes","label":"ノート"}];'));
});

Deno.test("entrance: redirect が無ければ、有効なアプリの一覧を出す js と css の画面", () => {
  const apps = [
    fakeApp("notes", { label: "ノート", icon: "📝" }),
    fakeApp("off", { label: "止めたもの", enabled: false }),
    fakeApp("broken", { label: "壊れたもの", status: "error", error: "app.json が不正です" }),
  ];
  const page = pageOf(buildEntrance(testConfig(), apps));
  assertEquals(page.binette, "0.1");
  assertEquals(page.title, "EbinaStation");
  assertEquals(page.entry, "main");
  assertEquals(Object.keys(page.assets).sort(), ["main", "style"]);
  assertEquals(page.assets.main.type, "js");
  assertEquals(page.assets.style.type, "css");
  assertEquals(page.settings, [ACCOUNT]);

  // status に関わらず enabled のものだけ。無効なものは入らない
  assertStringIncludes(page.assets.main.content, '{"name":"notes","label":"ノート","icon":"📝"}');
  assertStringIncludes(page.assets.main.content, '{"name":"broken","label":"壊れたもの"}');
  assert(!page.assets.main.content.includes("止めたもの"));

  const parsed = parseBinette(JSON.stringify(page));
  assertEquals(parsed.entry, "main");
  assertEquals(parsed.assets.main.type, "js");
  assertEquals(parsed.settings, [ACCOUNT]);
});

Deno.test("entrance: アプリが無くても parseBinette に通る", () => {
  const page = pageOf(buildEntrance(testConfig(), []));
  assertStringIncludes(page.assets.main.content, "const apps = [];");
  parseBinette(JSON.stringify(page));
});

Deno.test("entrance: css は他の画面に影響しないよう、クラス名に接頭辞を付け、色を直書きしない", () => {
  const css = pageOf(buildEntrance(testConfig(), [])).assets.style.content;
  for (const line of css.split("\n")) {
    const selector = line.match(/^([^\s{][^{]*)\{/)?.[1];
    if (selector) assertMatch(selector.trim(), /^\.ebina-entrance/, `セレクターに接頭辞が無い: ${selector}`);
  }
  assert(!/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/.test(css), "色の値が直書きされている");
  assertStringIncludes(css, "currentColor");
  assertStringIncludes(css, "min-height: 44px");
});

// ---- 入口の js を、DOM の代わりの小さな偽物で動かす ----

class FakeElement {
  readonly tagName: string;
  className = "";
  textContent = "";
  type = "";
  readonly attributes: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  parent: FakeElement | undefined;
  readonly listeners: { type: string; fn: () => void; signal?: AbortSignal }[] = [];

  constructor(tagName: string) {
    this.tagName = tagName;
  }
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  addEventListener(type: string, fn: () => void, options?: { signal?: AbortSignal }): void {
    this.listeners.push({ type, fn, signal: options?.signal });
  }
  click(): void {
    for (const l of this.listeners) if (l.type === "click" && !l.signal?.aborted) l.fn();
  }
  remove(): void {
    const siblings = this.parent?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parent = undefined;
  }
  find(tagName: string): FakeElement[] {
    return [...(this.tagName === tagName ? [this] : []), ...this.children.flatMap((c) => c.find(tagName))];
  }
  text(): string {
    return this.textContent + this.children.map((c) => c.text()).join("");
  }
}

type Mount = (el: FakeElement, sh: { navigate: (path: string) => void }) => unknown;

/** assets.main の js を data: URL から読み込み、偽の document を差した状態で mount を呼べるようにする */
async function loadMount(code: string): Promise<Mount> {
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  const mod: unknown = await import(url);
  const mount = typeof mod === "object" && mod !== null ? Reflect.get(mod, "mount") : undefined;
  assert(typeof mount === "function", "mount が export されていない");
  return (el, sh) => Reflect.apply(mount, undefined, [el, sh]);
}

async function withFakeDocument<T>(fn: () => Promise<T>): Promise<T> {
  Reflect.set(globalThis, "document", { createElement: (tag: string) => new FakeElement(tag) });
  try {
    return await fn();
  } finally {
    Reflect.deleteProperty(globalThis, "document");
  }
}

Deno.test("entrance js: アプリの行を出し、押すと sh.navigate('/名前') を呼ぶ。後始末で消える", async () => {
  const page = pageOf(buildEntrance(testConfig(), [fakeApp("notes", { label: "ノート", icon: "📝" }), fakeApp("b")]));
  const mount = await loadMount(page.assets.main.content);
  await withFakeDocument(() => {
    const el = new FakeElement("div");
    const visited: string[] = [];
    const cleanup = mount(el, { navigate: (path) => visited.push(path) });
    assertEquals(typeof cleanup, "function");

    assertEquals(el.children.length, 1);
    const root = el.children[0];
    assertEquals(root.className, "ebina-entrance");
    const buttons = root.find("button");
    assertEquals(buttons.length, 2);
    for (const button of buttons) assertEquals(button.type, "button");
    // 行は名前順（hub の順）に並ぶ
    assertEquals(buttons.map((b) => b.text()), ["📝ノート", "b"]);
    // アイコンは読み上げない
    assertEquals(buttons[0].find("span").find((s) => s.attributes["aria-hidden"] === "true")?.textContent, "📝");

    buttons[0].click();
    buttons[1].click();
    assertEquals(visited, ["/notes", "/b"]);

    (cleanup as () => void)();
    assertEquals(el.children.length, 0);
    buttons[0].click();
    assertEquals(visited, ["/notes", "/b"], "後始末のあとも押せてしまう");
    return Promise.resolve();
  });
});

Deno.test("entrance js: アプリが無ければ「アプリがありません」", async () => {
  const mount = await loadMount(pageOf(buildEntrance(testConfig(), [])).assets.main.content);
  await withFakeDocument(() => {
    const el = new FakeElement("div");
    mount(el, { navigate: () => {} });
    assertStringIncludes(el.text(), "アプリがありません");
    assertEquals(el.children[0].find("button").length, 0);
    return Promise.resolve();
  });
});

Deno.test("entrance js: アプリの名前やラベルに HTML や引用符が入っても、文字として出るだけ", async () => {
  const nasty = `<img src=x onerror=alert(1)>"'\`</script>  \\`;
  const page = pageOf(buildEntrance(testConfig(), [fakeApp("evil", { label: nasty, icon: nasty })]));
  assert(!page.assets.main.content.includes("innerHTML"), "innerHTML を使っている");
  assert(!page.assets.main.content.includes("insertAdjacentHTML"), "insertAdjacentHTML を使っている");
  const mount = await loadMount(page.assets.main.content);
  await withFakeDocument(() => {
    const el = new FakeElement("div");
    mount(el, { navigate: () => {} });
    const button = el.children[0].find("button")[0];
    assertEquals(button.text(), nasty + nasty);
    // 子の要素は span だけ（img などは作られない）
    assertEquals(button.find("img").length, 0);
    return Promise.resolve();
  });
});
