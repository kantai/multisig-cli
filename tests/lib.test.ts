import { expect, test, it } from 'vitest'

import * as lib from "../src/lib"
import * as C32 from "c32check";
import * as StxTx from "@stacks/transactions";

const C32_ADDRESS_VERSION_MAINNET_MULTISIG = 20;
const C32_ADDRESS_VERSION_TESTNET_MULTISIG = 21;

test('vitest running', () => {
  expect(true).toBe(true)
})

test('Base64 encode/decode', async () => {
  const tx = await lib.generateMultiSignedTx();
  // Stringify and parse to fix BigInt formatting
  // Not sure why this works
  const tx_expected = JSON.parse(JSON.stringify(tx));
  const tx_encoded = lib.base64Serialize(tx);
  const tx_decoded = lib.base64Deserialize(tx_encoded);
  expect(tx_decoded).toEqual(tx_expected);
})

test('Multisig address generation', () => {
  const pubkeys = [
    "02b30fafab3a12372c5d150d567034f37d60a91168009a779498168b0e9d8ec7f2", // 1
    "03ce61f1d155738a5e434fc8a61c3e104f891d1ec71576e8ad85abb68b34670d35", // 2
    "03ef2340518b5867b23598a9cf74611f8b98064f7d55cdb8c107c67b5efcbc5c77", // 3
  ];
  const c32_address = lib.makeMultiSigAddr(pubkeys, 2);
  const c32_expected = C32.c32address(C32_ADDRESS_VERSION_MAINNET_MULTISIG, "b01162ecda72c57ed419f7966ec4e8dd7987c704");
  expect(c32_address).toBe(c32_expected);
})

test('Get auth field info', async () => {
  const tx = await lib.generateMultiSignedTx();
  const info = lib.getAuthFieldInfo(tx);
  expect(info).toEqual({
    authFields: 3,
    pubkeys: 1,
    signatures: 2,
    signaturesRequired: 2,
  });
})

test('Test transaction building', async () => {
  const pubkeys = [
    "02b30fafab3a12372c5d150d567034f37d60a91168009a779498168b0e9d8ec7f2", // 1
    "03ce61f1d155738a5e434fc8a61c3e104f891d1ec71576e8ad85abb68b34670d35", // 2
    "03ef2340518b5867b23598a9cf74611f8b98064f7d55cdb8c107c67b5efcbc5c77", // 3
  ];
  const data: lib.MultisigData = {
    tx: {
      fee: "300",
      amount: "10000",
      numSignatures: 3,
      nonce: 4,
      recipient: "ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH",
    },
    spendingFields: pubkeys.map(x => ({ publicKey: x })),
  };

  const tx = await lib.makeStxTokenTransferFrom(data);
  const spendingCondition = tx.auth.spendingCondition as StxTx.MultiSigSpendingCondition;

  it('Should have correct numbers of auth fields', () => {
    const info = lib.getAuthFieldInfo(tx);
    expect(info).toEqual({
      authFields: 3,
      pubkeys: 3,
      signatures: 0,
      signaturesRequired: 3,
    });
  });

  it('Should have correct pubkeys', () => {
    spendingCondition.fields.forEach((f, i) => {
      expect(f.contents.type).toBe(StxTx.StacksMessageType.PublicKey)
      const pubkey = f.contents.data.toString('hex');
      expect(pubkey).toBe(pubkeys[i])
    });
  });

  it('Should have correct fee, nonce, and hash mode', () => {
    expect(spendingCondition.fee).toBe(300)
    expect(spendingCondition.nonce).toBe(4)
    expect(spendingCondition.hashMode).toBe(StxTx.AddressHashMode.SerializeP2SH)
  });
})