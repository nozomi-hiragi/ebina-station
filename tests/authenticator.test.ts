import { assertEquals, assertThrows } from "@std/assert";
import { ecdsaRawToDer } from "./helpers/authenticator.ts";

/** 独立に書いた DER の読み取り（SEQUENCE { INTEGER, INTEGER }）。署名を 32 バイトずつの r||s に戻す */
function derToRaw(der: Uint8Array): Uint8Array {
  let at = 0;
  const byte = () => der[at++];
  assertEquals(byte(), 0x30);
  assertEquals(byte(), der.length - 2, "SEQUENCE の長さ");
  const out = new Uint8Array(64);
  for (const offset of [0, 32]) {
    assertEquals(byte(), 0x02);
    const length = byte();
    let body = der.slice(at, at + length);
    at += length;
    // 最小の表現: 先頭が 0x00 なのは、値が 0 のときか、次のバイトの最上位ビットが立つときだけ
    if (body[0] === 0x00 && body.length > 1) {
      assertEquals((body[1] & 0x80) !== 0, true, "余分な 0x00");
      body = body.slice(1);
    } else {
      assertEquals(body[0] & 0x80, 0, "負の数になっている");
    }
    out.set(body, offset + 32 - body.length);
  }
  assertEquals(at, der.length);
  return out;
}

function raw(r: number[], s: number[]): Uint8Array {
  const out = new Uint8Array(64);
  out.set(r, 32 - r.length);
  out.set(s, 64 - s.length);
  return out;
}

Deno.test("ecdsaRawToDer: 最上位ビット、先頭の 0、最小の値を正しく DER にする", () => {
  const cases: [string, Uint8Array][] = [
    ["通常", raw([0x01, ...new Array(31).fill(0x11)], [0x02, ...new Array(31).fill(0x22)])],
    ["r の最上位ビットが立つ", raw([0x80, ...new Array(31).fill(0xff)], [0x7f, ...new Array(31).fill(0x01)])],
    ["s の最上位ビットが立つ", raw([0x7f, ...new Array(31).fill(0x01)], [0xff, ...new Array(31).fill(0xff)])],
    ["r の先頭が 0", raw([0x00, 0x00, 0x05, ...new Array(29).fill(0x33)], [0x06, ...new Array(31).fill(0x44)])],
    [
      "r の先頭が 0 のあとに最上位ビット",
      raw([0x00, 0x90, ...new Array(30).fill(0x33)], [0x06, ...new Array(31).fill(0x44)]),
    ],
    ["小さい値", raw([0x01], [0x7f])],
    ["最小", raw([0x00], [0x01])],
  ];
  for (const [label, signature] of cases) {
    const der = ecdsaRawToDer(signature);
    if (label === "最小") {
      // r = 0 は DER では 02 01 00。先頭の 0 を削りすぎない
      assertEquals([...der], [0x30, 0x06, 0x02, 0x01, 0x00, 0x02, 0x01, 0x01]);
    }
    assertEquals(derToRaw(der), signature, label);
  }
  assertEquals([...ecdsaRawToDer(raw([0x80, ...new Array(31).fill(0)], [0x01]))].slice(0, 5), [
    0x30,
    0x26,
    0x02,
    0x21,
    0x00,
  ]);
});

Deno.test("ecdsaRawToDer: 64 バイトでなければ投げる", () => {
  assertThrows(() => ecdsaRawToDer(new Uint8Array(63)), Error);
});

Deno.test("ecdsaRawToDer: WebCrypto の本物の署名を DER にして戻すと元の署名になる", async () => {
  const { privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  for (let i = 0; i < 200; i++) {
    const signature = new Uint8Array(
      await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new Uint8Array([i])),
    );
    assertEquals(derToRaw(ecdsaRawToDer(signature)), signature);
  }
});
