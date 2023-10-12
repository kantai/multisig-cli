import { expect, test } from 'vitest'
import * as lib from "../src/lib"

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