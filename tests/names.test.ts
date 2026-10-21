import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  isAppNameFormat,
  isReservedAppName,
  isValidAppName,
  RESERVED_APP_NAMES,
  validateAppName,
} from "../src/apps/names.ts";

Deno.test("アプリ名: 形式に合う名前", () => {
  for (const name of ["a", "echo", "binette-editor", "app2", "a-", "a".repeat(63)]) {
    assertEquals(isAppNameFormat(name), true, name);
    assertEquals(isValidAppName(name), true, name);
    assertEquals(validateAppName(name), null, name);
  }
});

Deno.test("アプリ名: 形式に合わない名前", () => {
  const bad = [
    "",
    "A",
    "Echo",
    "1app",
    "-app",
    "my_app",
    "my.app",
    "a b",
    "a/b",
    "..",
    ".",
    "a\n",
    "あ",
    "a".repeat(64),
  ];
  for (const name of bad) {
    assertEquals(isAppNameFormat(name), false, JSON.stringify(name));
    assertEquals(isValidAppName(name), false, JSON.stringify(name));
    assertEquals(typeof validateAppName(name), "string", JSON.stringify(name));
  }
});

Deno.test("アプリ名: 予約名は形式に合っても使えない", () => {
  assertEquals([...RESERVED_APP_NAMES].sort(), ["ebina", "index", "me", "settings", "station"]);
  for (const name of RESERVED_APP_NAMES) {
    assertEquals(isAppNameFormat(name), true, name);
    assertEquals(isReservedAppName(name), true, name);
    assertEquals(isValidAppName(name), false, name);
    assertStringIncludes(validateAppName(name) ?? "", "予約");
  }
  assertEquals(isReservedAppName("echo"), false);
});
