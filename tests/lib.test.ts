import { expect, test } from 'vitest'
import * as lib from "../src/lib"
import * as C32 from "c32check";

test('vitest running', () => {
  expect(true).toBe(true)
})

test('Base64 encode/decode', async () => {
  // Stringify and parse to fix BigInt formatting
  // Not sure why this works
  const tx = JSON.parse(JSON.stringify(await lib.generateMultiSignedTx()));
  const encoded_tx = lib.base64Serialize(tx);
  const decoded_tx = lib.base64Deserialize(encoded_tx);
  expect(tx).toEqual(decoded_tx)
})

test('Multisig address generation', () => {
  const pubkeys = [
    "02b30fafab3a12372c5d150d567034f37d60a91168009a779498168b0e9d8ec7f2", // 1
    "03ce61f1d155738a5e434fc8a61c3e104f891d1ec71576e8ad85abb68b34670d35", // 2
    "03ef2340518b5867b23598a9cf74611f8b98064f7d55cdb8c107c67b5efcbc5c77", // 3
  ];
  const c32_address = lib.makeMultiSigAddr(pubkeys, 2);
  const c32_expected = C32.c32address(20, "b01162ecda72c57ed419f7966ec4e8dd7987c704");
  expect(c32_address).toBe(c32_expected);
})