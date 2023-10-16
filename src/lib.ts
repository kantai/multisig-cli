
//import SpecTransport from "@ledgerhq/hw-transport-node-speculos";
//import TransportNodeHid from "@ledgerhq/hw-transport-node-hid";

import StxApp from "@zondax/ledger-blockstack";
import { LedgerError } from "@zondax/ledger-blockstack";

import * as btc from "bitcoinjs-lib";
import * as C32 from "c32check";
import { AddressVersion, createTransactionAuthField, TransactionAuthField, UnsignedMultiSigTokenTransferOptions, StacksTransaction } from "@stacks/transactions";
// import readline from "readline";

import BigNum from "bn.js";

import * as StxTx from "@stacks/transactions";

// This will generate pubkeys using
//  the format: m/44'/5757'/0'/0/x
const XPUB_PATH = `m/44'/5757'/0'`;

// This will generate pubkeys using
//  the format: m/5757'/0'/0/0/x
const BTC_MULTISIG_SCRIPT_PATH = `m/5757'/0'/0`;

export interface MultisigData {
  tx: {
    fee: string,
    amount: string,
    numSignatures: number,
    recipient: string,
    nonce: number,
    memo?: string,
  },
  spendingFields: {
    publicKey: string,
    signatureVRS?: string,
  }[],
}

// Need this to serialize BitInt
(BigInt.prototype as any).toJSON = function() {
  return this.toString()
}

export function base64Serialize(data: Object): string {
  return Buffer.from(JSON.stringify(data)).toString('base64');
}

export function base64Deserialize(serialized: string): Object {
  return JSON.parse(Buffer.from(serialized, 'base64').toString());
}

export async function getPubKey(app: StxApp, path: string): Promise<string> {
    const amt = (await app.getAddressAndPubKey(path, StxTx.AddressVersion.TestnetSingleSig));
    return amt.publicKey.toString('hex')
}  

export async function getPubKeySingleSigStandardIndex(app: StxApp, index: number): Promise<string> {
  const path = `${XPUB_PATH}/0/${index}`;
  return getPubKey(app, path);
}

export async function getPubKeyMultisigStandardIndex(app: StxApp, index: number): Promise<{pubkey: string, path: string}> {
    const path = `${BTC_MULTISIG_SCRIPT_PATH}/0/${index}`;
    return {pubkey: await getPubKey(app, path), path};
}

export async function generateMultiSigAddr(app: StxApp) {
  const pk0 = await getPubKeyMultisigStandardIndex(app, 0);
  const pk1 = await getPubKeyMultisigStandardIndex(app, 1);
  const pk2 = await getPubKeyMultisigStandardIndex(app, 2);

  const pubkeys = [pk0, pk1, pk2].sort((a, b) => a.pubkey.localeCompare(b.pubkey));
  console.log(`Making a 2 - of - ${pubkeys.length} multisig address...`);
  console.log(`Pubkeys: ${pubkeys[0].pubkey}, ${pubkeys[1].pubkey}, ${pubkeys[2].pubkey}`);
  console.log(`Paths: ${pubkeys[0].path}, ${pubkeys[1].path}, ${pubkeys[2].path}`);
  return makeMultiSigAddr([pubkeys[0].pubkey, pubkeys[1].pubkey, pubkeys[2].pubkey], 2);
}

export function makeMultiSigAddr(pubkeys: string[], required: number): string {
  const authorizedPKs = pubkeys.slice().map((k) => Buffer.from(k, 'hex'));
  const redeem = btc.payments.p2ms({ m: required, pubkeys: authorizedPKs });
  const btcAddr = btc.payments.p2sh({ redeem }).address;
  if (!btcAddr) {
    throw Error(`Failed to construct BTC address from pubkeys`);
  }
  const c32Addr = C32.b58ToC32(btcAddr);
  return c32Addr
}
  
/// Builds spending condition fields out of a multisig data serialization
function makeSpendingConditionFields(multisigData: MultisigData): TransactionAuthField[] {
  const fields = multisigData.spendingFields
      .map((field) => {
        if (field.signatureVRS) {
          return StxTx.createMessageSignature(field.signatureVRS);
        } else if (field.publicKey) {
          return StxTx.createStacksPublicKey(field.publicKey);
        } else {
          throw "spendingField in the multisig object did not have publicKey specification"
        }
      })
      .map((x) => {
        return StxTx.createTransactionAuthField(StxTx.PubKeyEncoding.Compressed, x);
      })
  return fields
}

function setMultisigTransactionSpendingConditionFields(tx: StacksTransaction, fields: TransactionAuthField[]) {
  if (!tx.auth.spendingCondition) {
    throw new Error(`Multisig transaction cannot be finalized: did not have enough information in multisig data to initialize spending condition`);
  }
  if (StxTx.isSingleSig(tx.auth.spendingCondition)) {
    throw new Error(`Multisig transaction cannot be finalized: supplied information initialized a singlesig transaction`);
  }
  tx.auth.spendingCondition.fields = fields;
}

/// Builds an unsigned transfer out of a multisig data serialization
export async function makeStxTokenTransferFrom(multisigData: MultisigData) {
  const fee = new BigNum(multisigData.tx.fee, 10);
  const amount = new BigNum(multisigData.tx.amount, 10);
  const nonce = new BigNum(multisigData.tx.nonce, 10);
  const numSignatures = multisigData.tx.numSignatures;
  const publicKeys = multisigData.spendingFields.slice().map(field => field.publicKey);
  const memo = multisigData.tx.memo;
  const recipient = multisigData.tx.recipient;
  const network = "mainnet";
  const anchorMode = StxTx.AnchorMode.Any;

  const unsignedTx = await StxTx.makeUnsignedSTXTokenTransfer({ anchorMode, fee, amount, numSignatures, publicKeys, recipient, nonce, network, memo });

  // Set public keys in auth fields
  // TODO: Is this necessary to set auth fields or already done by `makeUnsignedSTXTokenTransfer()`
  const authFields = makeSpendingConditionFields(multisigData);
  setMultisigTransactionSpendingConditionFields(unsignedTx, authFields);

  return unsignedTx
}

export interface AuthFieldInfo {
  authFields: number,
  pubkeys: number,
  signatures: number,
  signaturesRequired: number,
}

export function getAuthFieldInfo(tx: StacksTransaction): AuthFieldInfo {
  let authFields = 0;
  let pubkeys = 0;
  let signatures = 0;

  const spendingCondition = tx.auth.spendingCondition as StxTx.MultiSigSpendingCondition;
  spendingCondition.fields.forEach(f => {
    authFields += 1;
    const type = f.contents.type;
    switch (type) {
      case StxTx.StacksMessageType.PublicKey:
        pubkeys += 1;
        break;
      case StxTx.StacksMessageType.MessageSignature:
        signatures += 1;
        break;
      default:
        console.error(`Unknown auth field type: ${type}`)
    }
  });

  return {
    authFields,
    pubkeys,
    signatures,
    signaturesRequired: spendingCondition.signaturesRequired,
  };
}

export async function ledgerSignMultisigTx(app: StxApp, path: string, tx: StacksTransaction): Promise<StacksTransaction> {
  const pubkey = (await app.getAddressAndPubKey(path, StxTx.AddressVersion.TestnetSingleSig))
        .publicKey.toString('hex');

  // Check transaction is correct type
  const spendingCondition = tx.auth.spendingCondition as StxTx.MultiSigSpendingCondition;
  if (StxTx.isSingleSig(spendingCondition)) {
    throw new Error(`Tx has single signature spending condition`);
  }

  const authFields = spendingCondition.fields;
  if (!authFields) {
    throw new Error(`Tx has no auth fields, not a valid multisig transaction`);
  }

  // Match pubkey in auth fields
  const numSignatures = 0;
  const pubkeys = authFields.map(f => {
    if (f.contents.type === StxTx.StacksMessageType.PublicKey) {
      return f.contents.data.toString('hex');
    } else {
      return null;
    }
  });
  const index = pubkeys.indexOf(pubkey);

  if (index < 0) {
    throw new Error(`Pubkey ${pubkey} not found in spending auth fields: ${pubkeys}`);
  }

  const signingBuffer = tx.serialize();
  const resp = await app.sign(path, signingBuffer);

  if (resp.returnCode !== LedgerError.NoErrors) {
    console.log(resp)
    throw new Error('Ledger responded with errors');
  }

  const signature = StxTx.createMessageSignature(resp.signatureVRS.toString('hex'));
  authFields[index] = createTransactionAuthField(StxTx.PubKeyEncoding.Compressed, signature);

  return tx;
}

async function ledgerSignTx(app: StxApp, path: string, partialFields: TransactionAuthField[], unsignedTx: Buffer, prevSigHash?: string) {
  const pubkey = (await app.getAddressAndPubKey(path, StxTx.AddressVersion.TestnetSingleSig))
        .publicKey.toString('hex');

  const outFields = partialFields.slice();
  const pubkeys = partialFields
        .map((x) => {
          console.log(x);
          if (x.contents.type === StxTx.StacksMessageType.PublicKey) {
            return x.contents.data.toString('hex')
          } else {
            return null
          }
        });

  if (pubkeys.indexOf(pubkey) < 0) {
    throw new Error(`Pubkey ${pubkey} not found in partial tx fields: ${partialFields}`);
  }

  const index = pubkeys.indexOf(pubkey);

  let resp;
  if (prevSigHash) {
    const txBuffer = unsignedTx.slice();
    const postSigHashBuffer = Buffer.from(prevSigHash, 'hex');
    const pkEnc = Buffer.alloc(1, StxTx.PubKeyEncoding.Compressed);
    const prev_signer_field = partialFields[index - 1];
    if (prev_signer_field.contents.type !== StxTx.StacksMessageType.MessageSignature) {
      throw new Error(`Previous sighash was supplied, but previous signer was not included in the transaction's auth fields`);
    }
    const prev_signer = Buffer.from(prev_signer_field.contents.data, 'hex');
    const msg_array = [txBuffer, postSigHashBuffer, pkEnc, prev_signer];
    resp = await app.sign(path, Buffer.concat(msg_array));
  } else {
    resp = await app.sign(path, unsignedTx.slice());
  }

  if (resp.returnCode !== LedgerError.NoErrors) {
    console.log(resp)
    throw new Error('Ledger responded with errors');
  }

  const next_sighash = resp.postSignHash.toString("hex");

  console.log(next_sighash);

  outFields[index] = StxTx.createTransactionAuthField(
    StxTx.PubKeyEncoding.Compressed,
    StxTx.createMessageSignature(
      resp.signatureVRS.toString('hex')
    ));
  return { outFields, next_sighash };
}

export async function generateMultiSignedTx(): Promise<StacksTransaction> {
  const privkeys = [
    'dd7229314db5d50122cd8d4ff8975f57317f54c946cd233d8d35f5b616fe961e01',
    '119a851bd1201b93e6477a0a9c7d29515735530df92ab265166ca3da119f803501',
    '22d45b79bda06915c5d1a98da577089763b6c660304d3919e50797352dc6722f01',
  ]

  const privKeys = privkeys.map(StxTx.createStacksPrivateKey);

  const pubkeys = [
    '03827ffa27ad5af481203d4cf5654cd20312398fa92084ff76e4b4dffddafe1059',
    '03a9d11f6d4102ed323740f95668d6f206c5b5cbc5ce5c7028ceba1736fbbd6861',
    '0205132dbd1270f66adaf43723940a98be6331abe95bfa53838815bf214a5a2150'
  ];

  console.log(pubkeys);
  console.log(makeMultiSigAddr(pubkeys, 2));

  const transaction = await StxTx.makeUnsignedSTXTokenTransfer({
    fee: new BigNum(300),
    numSignatures: 2,
    publicKeys: pubkeys,
    amount: new BigNum(1000),
    recipient: "SP000000000000000000002Q6VF78",
    anchorMode: StxTx.AnchorMode.Any,
  });

  const signer = new StxTx.TransactionSigner(transaction);
  signer.checkOversign = false;
  signer.appendOrigin(StxTx.pubKeyfromPrivKey(privkeys[0]));
  signer.signOrigin(StxTx.createStacksPrivateKey(privkeys[1]));
  signer.signOrigin(StxTx.createStacksPrivateKey(privkeys[2]));

  return transaction
}

export async function generateMultiUnsignedTx(app: StxApp) {
  const pubkeys = [
    '03827ffa27ad5af481203d4cf5654cd20312398fa92084ff76e4b4dffddafe1059',
    '03a9d11f6d4102ed323740f95668d6f206c5b5cbc5ce5c7028ceba1736fbbd6861',
    '0205132dbd1270f66adaf43723940a98be6331abe95bfa53838815bf214a5a2150'
  ];

  console.log(pubkeys);
  console.log(makeMultiSigAddr(pubkeys, 2));

  const unsignedTx = await StxTx.makeUnsignedSTXTokenTransfer({
    fee: new BigNum(300),
    numSignatures: 2,
    publicKeys: pubkeys,
    amount: new BigNum(1000),
    recipient: "SP000000000000000000002Q6VF78",
    anchorMode: StxTx.AnchorMode.Any,
  });

  const partialFields =
    pubkeys.map((x) => {
      return StxTx.createTransactionAuthField(StxTx.PubKeyEncoding.Compressed, StxTx.createStacksPublicKey(x))
    });

  return { unsignedTx, pubkeys: partialFields }
}

function checkAddressPubKeyMatch(pubkeys: string[], required: number, address: string) {
  // first try in sorted order
  let authorizedPKs = pubkeys.slice().sort().map((k) => Buffer.from(k, 'hex'));
  let redeem = btc.payments.p2ms({ m: required, pubkeys: authorizedPKs });
  let btcAddr = btc.payments.p2sh({ redeem }).address;
  if (!btcAddr) {
    throw Error(`Failed to construct BTC address from pubkeys`);
  }
  const c32Addr1 = C32.b58ToC32(btcAddr);
  if (c32Addr1 == address) {
    return authorizedPKs.map((k) => k.toString('hex'))
  }

  // try in order given
  authorizedPKs = pubkeys.slice().map((k) => Buffer.from(k, 'hex'));
  redeem = btc.payments.p2ms({ m: required, pubkeys: authorizedPKs });
  btcAddr = btc.payments.p2sh({ redeem }).address;
  if (!btcAddr) {
    throw Error(`Failed to construct BTC address from pubkeys`);
  }
  const c32Addr2 = C32.b58ToC32(btcAddr);
  if (c32Addr2 == address) {
    return authorizedPKs.map((k) => k.toString('hex'))
  }

  throw `Public keys did not match expected address. Expected ${address}, but pubkeys correspond to ${c32Addr1} or ${c32Addr2}`
}
