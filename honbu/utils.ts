import { getSettings, setSettings } from "../koujou/settings/settings.ts";

class ReaderBuffer {
  _reader: Deno.Reader;
  _buffer: Uint8Array;
  _decoder = new TextDecoder();
  _msg = "";

  constructor(reader: Deno.Reader, size = 4096) {
    this._reader = reader;
    this._buffer = new Uint8Array(size);
  }
  _decode = () => this._decoder.decode(this._buffer);

  async read() {
    const ret = await this._reader.read(this._buffer);
    if (ret === null) return null;
    return this._msg = this._decode().slice(0, ret).trim();
  }

  message = () => this._msg;
}

export const readReader = async (
  reader: Deno.Reader,
  callback: (msg: string) => boolean | undefined | void,
) => {
  const rb = new ReaderBuffer(reader);
  while (await rb.read() !== null) {
    for (const msg of rb.message().split("\n")) {
      if (msg.indexOf("\0") === 0) continue;
      if (callback(msg)) return;
    }
  }
};

const getDockerEdition = async () => {
  const process = Deno.run({
    cmd: ["docker", "version", "-f", "'{{.Server.Platform.Name}}'"],
    stdout: "piped",
  });
  const status = await process.status();
  if (!status.success || status.code !== 0) return undefined;
  return new TextDecoder().decode(await process.output()).slice(1, -2);
};

export const isDockerDesktop = async () =>
  await getDockerEdition().then((e) => e?.includes("Desktop") ?? false);

export const isExist = (path: string) => {
  try {
    return Deno.statSync(path);
  } catch {
    return false;
  }
};

export const initProjectSettingsInteract = async () => {
  const yon = "y/n";
  const msgPleaseChangeFromSettingFile = "変更する場合は設定ファイルから行ってください。\n";

  const rb = new ReaderBuffer(Deno.stdin);

  // Let's encrypt同意して
  console.log(
    "このアプリはcertbotコンテナを使用したLet's Encryptを使用してます。\n" +
      "Let's Encrypt Subscriber Agreementの同意が必要です。 https://letsencrypt.org/repository/\n" +
      "同意しますか？" + yon,
  );
  const agree = await rb.read().then((ret) => ret?.toLowerCase());
  if (agree !== "y") {
    console.log("同意できなきゃ多分使っちゃダメ");
    throw new Error("Not agree let's encrype agreement");
  }

  const projectSettings = getSettings();

  console.log(
    "こんにちは。\n" +
      "プロジェクトフォルダの設定をはじめます。\n",
  );

  console.log(
    "サーバーが許可するフロントのオリジンを設定します。\n" +
      `現在、${projectSettings.origins.join(", ")}が設定されてます。\n` +
      "追加しますか？" + yon,
  );
  while (await rb.read() !== null) {
    const buf = rb.message().toLocaleLowerCase();
    if (buf === "y") {
      console.log("カンマ区切りでオリジンを入れてください。");
      const ret = await rb.read();
      if (ret === null) throw new Error("input is null");

      const inputOrigin = ret.replaceAll(/\s+/g, "").split(",\n");
      console.log(
        `${inputOrigin}を追加します。\n` +
          msgPleaseChangeFromSettingFile,
      );
      projectSettings.origins = projectSettings.origins.concat(inputOrigin);
    } else if (buf === "n") {
      break;
    } else {
      console.log(yon);
    }
  }

  console.log(
    "WebAuthnの設定をします。\n" +
      "rpNameを入力してください。",
  );
  const rpName = await rb.read();
  if (rpName === null) throw new Error("input is null");

  console.log(
    `"${rpName}"に設定します。\n` +
      msgPleaseChangeFromSettingFile,
  );
  projectSettings.WebAuthn.rpName = rpName;

  console.log(
    "これにて設定は終わりです。\n" +
      "その他" + msgPleaseChangeFromSettingFile,
  );

  setSettings(projectSettings);
};
