// Binette エディタの一覧の画面。mount(el, sh) を Scene が呼ぶ。
// 画面ごとに 1 ファイルにまとめる（js の asset は相対 import を使えない）ため、小さな補助は edit.js と同じものを持つ。
// ユーザーの値は textContent / setAttribute だけで DOM に入れる（innerHTML は使わない）。

const API = "/binette-editor/api/binettes";
const NAME_RULE = "英数字、. _ - と、区切りの / が使えます（例: notes/hello）。1 区切り 64 文字、全体 200 文字まで";

/** 名前の規則（サーバーと同じ）。使えない理由を返す。使えるなら null */
function nameProblem(name) {
  if (name.length === 0) return "名前を入力してください";
  if (name.length > 200) return "名前は 200 文字までです";
  for (const segment of name.split("/")) {
    if (segment.length === 0) return "名前の区切り（/）が空です。先頭・末尾の / や // は使えません";
    if (segment.length > 64) return "名前の 1 つの区切りは 64 文字までです";
    if (segment.endsWith(".bina")) return "名前の区切りの末尾に .bina は付けられません";
    if (segment === "." || segment === "..") return "名前の区切りに . と .. は使えません";
    if (!/^[A-Za-z0-9._-]+$/.test(segment)) return "名前に使えるのは、英数字、. _ - と、区切りの / だけです";
  }
  return null;
}

/** 要素を作る。子の文字列はテキストとして入る */
function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  node.append(...children);
  return node;
}

/** API を呼ぶ。通信に失敗したときは status 0 */
async function call(sh, path, init) {
  try {
    const response = await sh.fetch(path, init);
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      // JSON でない本文（エラーページなど）は body を null のままにする
    }
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

function failure(result) {
  if (result.status === 0) return "通信に失敗しました";
  if (result.body && typeof result.body.error === "string") return result.body.error;
  return `失敗しました（${result.status}）`;
}

/** 新しいビネットのひな形 */
function template(name) {
  return JSON.stringify(
    {
      binette: "0.1",
      title: name,
      entry: "main",
      assets: { main: { type: "html", content: "<p>こんにちは</p>" } },
    },
    null,
    2,
  ) + "\n";
}

export function mount(el, sh) {
  let disposed = false;
  let names = [];
  /** 削除の確認中の名前 */
  let confirming = null;

  const status = h("p", { class: "be-status", role: "status" });
  const alert = h("p", { class: "be-status be-error", role: "alert" });
  const list = h("ul", { class: "be-list", "aria-label": "ビネットの一覧" });
  const input = h("input", {
    id: "be-new-name",
    type: "text",
    maxlength: "200",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    placeholder: "例: notes/hello",
    "aria-describedby": "be-name-rule",
  });
  const createButton = h("button", {
    type: "submit",
    class: "be-button be-primary",
    "aria-label": "新しいビネットを作る",
  }, "作成");

  const showError = (message) => {
    alert.textContent = message;
    status.textContent = "";
  };
  const showStatus = (message) => {
    status.textContent = message;
    alert.textContent = "";
  };

  const actionButton = (label, ariaLabel, onClick, extraClass = "") =>
    h(
      "button",
      { type: "button", class: `be-button ${extraClass}`.trim(), "aria-label": ariaLabel, onclick: onClick },
      label,
    );

  async function remove(name) {
    const result = await call(sh, `${API}/${name}`, { method: "DELETE" });
    if (disposed) return;
    confirming = null;
    if (!result.ok && result.status !== 404) {
      showError(failure(result));
      render();
      return;
    }
    await load();
    if (!disposed) showStatus(`「${name}」を削除しました`);
  }

  function row(name) {
    const item = h("li", { class: "be-row" }, h("span", { class: "be-name" }, name));
    const actions = h("div", { class: "be-actions" });
    if (confirming === name) {
      actions.append(
        h("span", { class: "be-confirm" }, "削除しますか？"),
        actionButton("削除する", `${name} の削除を確定する`, () => void remove(name), "be-danger"),
        actionButton("やめる", `${name} の削除をやめる`, () => {
          confirming = null;
          render();
        }),
      );
    } else {
      actions.append(
        actionButton(
          "編集",
          `${name} を編集する`,
          () => sh.navigate(`/binette-editor/edit?name=${encodeURIComponent(name)}`),
        ),
        actionButton("プレビュー", `${name} をプレビューする`, () => sh.navigate(`/binette-editor/preview/${name}`)),
        actionButton("削除", `${name} を削除する`, () => {
          confirming = name;
          render();
        }),
      );
    }
    item.append(actions);
    return item;
  }

  function render() {
    list.replaceChildren();
    if (names.length === 0) {
      list.append(h("li", { class: "be-empty" }, "ビネットはまだありません。上の欄に名前を入れて作れます"));
      return;
    }
    for (const name of names) list.append(row(name));
  }

  async function load() {
    const result = await call(sh, API);
    if (disposed) return;
    if (!result.ok || !result.body || !Array.isArray(result.body.names)) {
      showError(failure(result));
      return;
    }
    names = result.body.names.filter((name) => typeof name === "string");
    render();
  }

  async function create(event) {
    event.preventDefault();
    const name = input.value.trim();
    const problem = nameProblem(name);
    if (problem !== null) return showError(problem);
    if (names.includes(name)) return showError(`「${name}」はすでにあります。一覧から編集してください`);
    createButton.disabled = true;
    const result = await call(sh, `${API}/${name}`, {
      method: "PUT",
      // 作るだけ。同じ名前がすでにあれば 412（上書きしない）
      headers: { "Content-Type": "application/json", "If-None-Match": "*" },
      body: template(name),
    });
    if (disposed) return;
    createButton.disabled = false;
    if (!result.ok) {
      // 412 のメッセージ（すでにあります）などはサーバーの文面をそのまま出す
      if (result.status === 412) void load();
      return showError(failure(result));
    }
    sh.navigate(`/binette-editor/edit?name=${encodeURIComponent(name)}`);
  }

  const root = h(
    "main",
    { class: "be-root" },
    h("h1", null, "Binette エディタ"),
    h(
      "form",
      { class: "be-form", onsubmit: (event) => void create(event) },
      h(
        "div",
        { class: "be-field" },
        h("label", { for: "be-new-name" }, "新しいビネットの名前"),
        input,
        h("small", { id: "be-name-rule", class: "be-hint" }, NAME_RULE),
      ),
      createButton,
    ),
    status,
    alert,
    list,
  );
  el.append(root);
  render();
  void load();

  return () => {
    disposed = true;
    root.remove();
  };
}
