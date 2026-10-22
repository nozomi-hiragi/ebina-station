// Binette エディタの編集の画面。mount(el, sh) を Scene が呼ぶ。名前は URL の ?name=<名前> から読む。
// 画面ごとに 1 ファイルにまとめる（js の asset は相対 import を使えない）ため、小さな補助は list.js と同じものを持つ。
// ユーザーの値は textContent / value / setAttribute だけで DOM に入れる（innerHTML は使わない）。

const API = "/binette-editor/api/binettes";

/** 名前の規則（サーバーと同じ）。URL の値を使う前に確かめる */
function isValidName(name) {
  if (name.length === 0 || name.length > 200) return false;
  return name.split("/").every((segment) =>
    segment.length >= 1 && segment.length <= 64 && !segment.endsWith(".bina") && segment !== "." && segment !== ".." &&
    /^[A-Za-z0-9._-]+$/.test(segment)
  );
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

/** API を呼ぶ。通信に失敗したときは status 0。text は本文そのまま */
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
    return { ok: response.ok, status: response.status, text, body };
  } catch {
    return { ok: false, status: 0, text: "", body: null };
  }
}

function failure(result) {
  if (result.status === 0) return "通信に失敗しました";
  if (result.body && typeof result.body.error === "string") return result.body.error;
  return `失敗しました（${result.status}）`;
}

export function mount(el, sh) {
  let disposed = false;
  let dirty = false;
  let saving = false;
  const name = (new URLSearchParams(location.search).get("name") ?? "").trim();

  const status = h("p", { class: "be-status", role: "status" });
  const alert = h("p", { class: "be-status be-error", role: "alert" });
  const prompt = h("div", { class: "be-prompt", role: "group", "aria-label": "保存していない変更" });
  prompt.hidden = true;
  const dirtyMark = h("span", { class: "be-dirty" });
  const editor = h("textarea", {
    id: "be-editor",
    class: "be-editor",
    spellcheck: "false",
    autocomplete: "off",
    autocapitalize: "off",
    wrap: "off",
    disabled: true,
  });

  const showError = (message) => {
    alert.textContent = message;
    status.textContent = "";
  };
  const showStatus = (message) => {
    status.textContent = message;
    alert.textContent = "";
  };
  const setDirty = (value) => {
    dirty = value;
    dirtyMark.textContent = value ? "未保存の変更があります" : "";
  };

  const button = (label, ariaLabel, onClick, extraClass = "") =>
    h(
      "button",
      { type: "button", class: `be-button ${extraClass}`.trim(), "aria-label": ariaLabel, onclick: onClick },
      label,
    );

  const saveButton = button("保存", "ビネットを保存する", () => void save(), "be-primary");
  const previewButton = button("プレビュー", "保存したビネットをプレビューする", () => leave(goPreview));
  const backButton = button("一覧へ", "一覧に戻る", () => leave(goList));
  saveButton.disabled = true;
  previewButton.disabled = true;

  const goList = () => sh.navigate("/binette-editor");
  const goPreview = () => sh.navigate(`/binette-editor/preview/${name}`);

  /** 保存する。成功したら true */
  async function save() {
    if (saving || editor.disabled) return false;
    saving = true;
    saveButton.disabled = true;
    const sent = editor.value;
    const result = await call(sh, `${API}/${name}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: sent,
    });
    saving = false;
    if (disposed) return false;
    saveButton.disabled = false;
    if (!result.ok) {
      showError(failure(result));
      return false;
    }
    // 保存している間に打ち足した分は、まだ未保存
    if (editor.value === sent) setDirty(false);
    // 保存できたので、離れるときの確認は隠す
    prompt.hidden = true;
    showStatus("保存しました");
    return true;
  }

  /** 保存していない変更があるときは、移る前に確かめる */
  function leave(go) {
    if (!dirty) return go();
    prompt.replaceChildren(
      h("span", { class: "be-confirm" }, "保存していない変更があります。"),
      button("保存して移る", "保存してから移る", async () => {
        if (await save()) go();
        else prompt.hidden = true;
      }, "be-primary"),
      button("保存せずに移る", "保存せずに移る", go, "be-danger"),
      button("戻る", "移るのをやめて編集に戻る", () => {
        prompt.hidden = true;
        editor.focus();
      }),
    );
    prompt.hidden = false;
  }

  async function load() {
    const result = await call(sh, `${API}/${name}`);
    if (disposed) return;
    if (!result.ok) {
      showError(result.status === 404 ? `ビネット「${name}」がありません` : failure(result));
      return;
    }
    editor.value = result.text;
    editor.disabled = false;
    saveButton.disabled = false;
    previewButton.disabled = false;
    showStatus("");
  }

  editor.addEventListener("input", () => {
    setDirty(true);
    prompt.hidden = true;
  });
  editor.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void save();
    }
  });

  // 未保存の変更があるあいだは、ページを離れる前にブラウザの確認を出す
  const onBeforeUnload = (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  };
  globalThis.addEventListener("beforeunload", onBeforeUnload);

  const title = h("h1", null, "ビネットを編集");
  const root = h("main", { class: "be-root" }, title);
  if (!isValidName(name)) {
    root.append(
      h("p", { class: "be-status be-error", role: "alert" }, "編集するビネットの名前が正しくありません"),
      h("div", { class: "be-actions" }, backButton),
    );
  } else {
    title.append(" ", h("span", { class: "be-name" }, name));
    root.append(
      h("label", { for: "be-editor", class: "be-label" }, "ビネットの JSON"),
      editor,
      h("div", { class: "be-actions" }, saveButton, previewButton, backButton, dirtyMark),
      prompt,
      status,
      alert,
    );
    void load();
  }
  el.append(root);

  return () => {
    disposed = true;
    globalThis.removeEventListener("beforeunload", onBeforeUnload);
    root.remove();
  };
}
