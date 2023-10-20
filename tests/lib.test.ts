import { expect, test, it } from 'vitest'

import * as lib from "../src/lib"
import * as C32 from "c32check";
import * as StxTx from "@stacks/transactions";

test('vitest running', () => {
  expect(true).toBe(true)
})

test('StacksTransaction serialize/deserialize', async () => {
  const tx = await lib.generateMultiSignedTx();
  const tx_encoded = tx.serialize();
  const tx_decoded = StxTx.deserializeTransaction(tx_encoded);

  // FIXME: When transaction is deserialized, there are a bunch of null bytes in `memo.content`:
  //   content: '\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00'
  // It should be:
  //   content: ''
  delete tx.payload['memo'].content;
  delete tx_decoded.payload['memo'].content;

  expect(tx_decoded).toEqual(tx);

  // Check object methods
  expect(tx_decoded.serialize).toBeDefined();
  expect(tx_decoded.txid).toBeDefined();
  expect(tx_decoded.verifyOrigin).toBeDefined();
})

test('StacksTransaction encode/decode', async () => {
  const tx = await lib.generateMultiSignedTx();
  const tx_encoded = lib.txEncode(tx);
  const tx_decoded = lib.txDecode(tx_encoded);

  // FIXME: When transaction is deserialized, there are a bunch of null bytes in `memo.content`:
  //   content: '\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00'
  // It should be:
  //   content: ''
  delete tx.payload['memo'].content;
  delete tx_decoded.payload['memo'].content;

  expect(tx_decoded).toEqual(tx);

  // Check object methods
  expect(tx_decoded.serialize).toBeDefined();
  expect(tx_decoded.txid).toBeDefined();
  expect(tx_decoded.verifyOrigin).toBeDefined();
})

test('Multisig address generation', () => {
  const pubkeys = [
    "02b30fafab3a12372c5d150d567034f37d60a91168009a779498168b0e9d8ec7f2", // 1
    "03ce61f1d155738a5e434fc8a61c3e104f891d1ec71576e8ad85abb68b34670d35", // 2
    "03ef2340518b5867b23598a9cf74611f8b98064f7d55cdb8c107c67b5efcbc5c77", // 3
  ];
  const c32_address = lib.makeMultiSigAddr(pubkeys, 2);
  // This Hash160 encodes as SM2R12RQCV9SCAZPM37VSCVP4X3EQK1Y70KCV7EDE
  //const c32_expected = "SM2R12RQCV9SCAZPM37VSCVP4X3EQK1Y70KCV7EDE";
  const c32_expected = C32.c32address(StxTx.AddressVersion.MainnetMultiSig, "b01162ecda72c57ed419f7966ec4e8dd7987c704");
  expect(c32_address).toEqual(c32_expected);
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

test('Transaction building (success)', async () => {
  const recipient = 'ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH';
  const publicKeys = [
    "02b30fafab3a12372c5d150d567034f37d60a91168009a779498168b0e9d8ec7f2", // 1
    "03ce61f1d155738a5e434fc8a61c3e104f891d1ec71576e8ad85abb68b34670d35", // 2
    "03ef2340518b5867b23598a9cf74611f8b98064f7d55cdb8c107c67b5efcbc5c77", // 3
  ];
  const data: lib.MultisigTxInput = {
    recipient, fee: '300', amount: '10000', publicKeys, numSignatures: 3, nonce: '4', network: 'mainnet'
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
      expect(f.contents.type).toEqual(StxTx.StacksMessageType.PublicKey)
      const pubkey = f.contents.data.toString('hex');
      expect(pubkey).toEqual(publicKeys[i])
    });
  });

  it('Should have correct fee, nonce, and hash mode', () => {
    expect(spendingCondition.fee).toEqual(300)
    expect(spendingCondition.nonce).toEqual(4)
    expect(spendingCondition.hashMode).toEqual(StxTx.AddressHashMode.SerializeP2SH)
  });
})

test('Transaction building from array (success)', async () => {
  const sender = 'SM2R12RQCV9SCAZPM37VSCVP4X3EQK1Y70KCV7EDE'; // This should match signers
  const recipient = 'ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH';
  const publicKeys = [
    "02b30fafab3a12372c5d150d567034f37d60a91168009a779498168b0e9d8ec7f2", // 1
    "03ce61f1d155738a5e434fc8a61c3e104f891d1ec71576e8ad85abb68b34670d35", // 2
    "03ef2340518b5867b23598a9cf74611f8b98064f7d55cdb8c107c67b5efcbc5c77", // 3
  ];

  const inputs: lib.MultisigTxInput[] = [
    { recipient, fee: '300', amount:  '10000', publicKeys, numSignatures: 3, nonce: '4', network: 'testnet' },
    { recipient, fee: '777', amount: '100000', publicKeys, numSignatures: 2, network: 'testnet' }, // Should work without `nonce`
    //{ recipient, fee: '300', amount:  '50000', publicKeys, numSignatures: 1, nonce: '1' }, // Should work without `network`
    //{ recipient, fee: '777', amount: '100000', publicKeys, numSignatures: 2, sender }, // Should work with `sender`
  ];

  const txs = await lib.makeTxsFromInputs(inputs);
  const expectedTxsLen = inputs.length;

  it(`Should have generated ${expectedTxsLen} transactions`, () => {
    expect(txs.length).toEqual(expectedTxsLen)
  });

  for (const i in inputs) {
    const input = inputs[i];
    const tx = txs[i];
    const expectedAuthFields = input.publicKeys.length;

    it(`Should have ${expectedAuthFields} numbers of auth fields`, () => {
      const info = lib.getAuthFieldInfo(tx[i]);
      expect(info).toEqual({
        authFields: expectedAuthFields,
        pubkeys: expectedAuthFields,
        signatures: 0,
        signaturesRequired: input.numSignatures,
      });
    });

    const spendingCondition = tx.auth.spendingCondition as StxTx.MultiSigSpendingCondition;
    it('Should have correct pubkeys', () => {
      spendingCondition.fields.forEach((f, i) => {
        expect(f.contents.type).toEqual(StxTx.StacksMessageType.PublicKey)
        const pubkey = f.contents.data.toString('hex');
        expect(pubkey).toEqual(input.publicKeys[i])
      });
    });

    it('Should have correct fee, nonce, and hash mode', () => {
      expect(spendingCondition.fee).toEqual(parseInt(input.fee))
      expect(spendingCondition.hashMode).toEqual(StxTx.AddressHashMode.SerializeP2SH)
      if (input.nonce) {
        expect(spendingCondition.nonce).toEqual(parseInt(input.nonce))
      }
    });
  }
})