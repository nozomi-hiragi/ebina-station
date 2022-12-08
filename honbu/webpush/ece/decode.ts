import {
  decode,
  deriveKeyAndNonce,
  generateNonce,
  ID_LEN_SIZE,
  KEY_SIZE,
  KeyAndNonce,
  RS_SIZE,
  SALT_SIZE,
  webpushSecret,
} from "./mod.ts";

const readHeader = (buffer: Uint8Array) => {
  const dataView = new DataView(buffer);
  let cur = 0;
  const salt = new Uint8Array(dataView.buffer.slice(0, SALT_SIZE));
  cur += SALT_SIZE;
  const rs = dataView.getUint32(cur);
  cur += RS_SIZE;
  const idLen = dataView.getUint8(cur);
  cur += ID_LEN_SIZE;
  const keyid = new Uint8Array(dataView.buffer.slice(cur, cur + idLen));
  cur += idLen;
  return { salt, rs, keyid, headerLen: cur };
};

const unpad = (data: Uint8Array, last: boolean) => {
  for (let i = data.length - 1; i > 0; i--) {
    if (!data[i]) continue;
    if ((last && data[i] === 2) || (!last && data[i] === 1)) {
      return data.slice(0, i);
    }
    throw new Error("wrong delimiter");
  }
  throw new Error("all zero");
};

const decryptRecord = (key: KeyAndNonce, counter: number, data: Uint8Array) =>
  crypto.subtle.importKey(
    "raw",
    key.key,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  ).then((cek) =>
    crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: generateNonce(key.nonce, counter),
        tagLength: 128,
      },
      cek,
      data,
    )
  ).then((data) => new Uint8Array(data));

const extractDecryptKeys = (
  keys: { localPubKey: Uint8Array; keyid: Uint8Array },
) => ({
  remotePubKey: keys.keyid,
  senderPubKey: keys.keyid,
  receiverPubKey: keys.localPubKey,
});

export const decrypt = async (
  buffer: Uint8Array,
  params: {
    key?: string | Uint8Array;
    localKey?: CryptoKeyPair;
    authSecret?: string | Uint8Array;
  },
) => {
  const header = readHeader(buffer);
  buffer = buffer.slice(header.headerLen);

  let secret;
  if (params.key) {
    secret = decode(params.key);
    if (secret.length !== KEY_SIZE) {
      throw new Error("key length must be " + KEY_SIZE + " bytes");
    }
  } else {
    if (!params.localKey) throw new Error("No privateKey in params");
    if (!params.authSecret) throw new Error("No authSecret in params");

    const localPubKey = await crypto.subtle
      .exportKey("raw", params.localKey.publicKey)
      .then((key) => new Uint8Array(key));

    secret = await webpushSecret(
      decode(params.authSecret),
      params.localKey.privateKey,
      extractDecryptKeys({ localPubKey, keyid: header.keyid }),
    );
  }

  const key = await deriveKeyAndNonce(header.salt, secret);
  let start = 0;
  let result = new Uint8Array([]);
  for (let i = 0; start < buffer.length; ++i) {
    const end = Math.min(start + header.rs, buffer.length);
    const block = unpad(
      await decryptRecord(key, i, buffer.slice(start, end)),
      end >= buffer.length,
    );
    const tmp = new Uint8Array(result.length + block.length);
    tmp.set(result);
    tmp.set(block, result.length);
    result = tmp;
    start = end;
  }
  return result;
};
