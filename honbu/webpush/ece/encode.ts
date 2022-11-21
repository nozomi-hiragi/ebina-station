import {
  decode,
  deriveKeyAndNonce,
  generateNonce,
  ID_LEN_SIZE,
  KEY_SIZE,
  KeyAndNonce,
  PAD_SIZE,
  RS_SIZE,
  SALT_SIZE,
  webpushSecret,
} from "./mod.ts";

const TAG_SIZE = 16;

const writeHeader = (
  header: { salt: Uint8Array; keyid: Uint8Array; rs: number },
) => {
  const keyid = new Uint8Array(header.keyid || []);
  const buff = new Uint8Array(SALT_SIZE + 5 + keyid.length);
  const dataView = new DataView(buff.buffer);
  buff.set(header.salt);
  dataView.setUint32(SALT_SIZE, header.rs);
  dataView.setUint8(SALT_SIZE + RS_SIZE, keyid.length);
  buff.set(keyid, SALT_SIZE + RS_SIZE + ID_LEN_SIZE);
  return buff;
};

const encryptRecord = (
  key: KeyAndNonce,
  counter: number,
  buffer: Uint8Array,
  last: boolean,
) => {
  const padding = new Uint8Array([last ? 2 : 1]);
  const record = new Uint8Array(buffer.length + padding.length);
  record.set(buffer);
  record.set(padding, buffer.length);

  return crypto.subtle.importKey(
    "raw",
    key.key,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  ).then((cek) =>
    crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: generateNonce(key.nonce, counter),
        tagLength: 128,
      },
      cek,
      record,
    )
  ).then((data) => new Uint8Array(data));
};

const extractEncryptKeys = (
  keys: { localPubKey: Uint8Array; dh: Uint8Array },
) => ({
  remotePubKey: keys.dh,
  senderPubKey: keys.localPubKey,
  receiverPubKey: keys.dh,
});

export const encrypt = async (buffer: Uint8Array, params: {
  keyid?: Uint8Array;
  key?: string | Uint8Array;
  localKey: CryptoKeyPair;
  dh?: string | Uint8Array;
  authSecret?: string | Uint8Array;
  salt?: Uint8Array;
  rs?: number;
}) => {
  const salt = params.salt ??
    crypto.getRandomValues(new Uint8Array(SALT_SIZE));
  if (salt.length !== SALT_SIZE) {
    throw new Error("salt length must be " + SALT_SIZE + " bytes");
  }
  const rs = params.rs ?? 4096;

  let keyid = params.keyid ?? new Uint8Array([]);
  let secret: Uint8Array;
  if (params.key) {
    const key = decode(params.key);
    if (key.length !== KEY_SIZE) {
      throw new Error("key length must be " + KEY_SIZE + " bytes");
    }
    secret = key;
  } else {
    if (!params.localKey) throw new Error("No privateKey in params");
    if (!params.authSecret) throw new Error("No authSecret in params");
    if (!params.dh) throw new Error("No dh in params");

    const localPubKey = await crypto.subtle.exportKey(
      "raw",
      params.localKey.publicKey,
    ).then((key) => new Uint8Array(key));
    if (keyid.length === 0) keyid = localPubKey;

    secret = await webpushSecret(
      decode(params.authSecret),
      params.localKey.privateKey,
      extractEncryptKeys({
        localPubKey,
        dh: decode(params.dh),
      }),
    );
  }

  const key = await deriveKeyAndNonce(salt, secret);
  const overhead = PAD_SIZE + TAG_SIZE;

  let start = 0;
  let counter = 0;
  let last = false;
  let result = writeHeader({ keyid, salt, rs });
  while (!last) {
    const end = start + rs - overhead;
    last = end >= buffer.length;
    const block = await encryptRecord(
      key,
      counter,
      buffer.slice(start, end),
      last,
    );
    const tmp = new Uint8Array(result.byteLength + block.byteLength);
    tmp.set(result);
    tmp.set(block, result.length);
    result = tmp;

    start = end;
    ++counter;
  }
  return result;
};
