
//import SpecTransport from "@ledgerhq/hw-transport-node-speculos";
//import TransportNodeHid from "@ledgerhq/hw-transport-node-hid";

import StxApp from "@zondax/ledger-blockstack";
import { LedgerError } from "@zondax/ledger-blockstack";

import * as btc from "bitcoinjs-lib";
import * as C32 from "c32check";
import { AddressVersion, TransactionAuthField, UnsignedMultiSigTokenTransferOptions } from "@stacks/transactions";
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
    memo?: string,
  },
  spendingFields: {
    publicKey: string,
    signatureVRS?: string,
  }[],
  sigHashes: string[],
}

export async function getPubKey(app: StxApp, path: string): Promise<string> {
    let amt = (await app.getAddressAndPubKey(path, StxTx.AddressVersion.TestnetSingleSig));
    console.log(amt);
    return amt.publicKey.toString('hex')
}  

export async function getPubKeySingleSigStandardIndex(app: StxApp, index: number): Promise<string> {
  const path = `${XPUB_PATH}/0/${index}`;
  return getPubKey(app, path);
}

export async function getPubKeyMultisigStandardIndex(app: StxApp, index: number): Promise<string> {
    const path = `${BTC_MULTISIG_SCRIPT_PATH}/0/${index}`;
    return getPubKey(app, path);
  }
  
/// Builds spending condition fields out of a multisig data serialization
function makeSpendingConditionFields(multisigData: MultisigData): TransactionAuthField[] {
  let fields = multisigData.spendingFields
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

export function encodeMultisigData(multisigData: MultisigData) {
  return Buffer.from(JSON.stringify(multisigData)).toString('base64');
}

export function decodeMultisigData(serialized: string): MultisigData {
  return JSON.parse(Buffer.from(serialized, 'base64').toString());
}

function setMultisigTransactionSpendingConditionFields(tx: StxTx.StacksTransaction, fields: TransactionAuthField[]) {
  if (!tx.auth.spendingCondition) {
    throw new Error(`Multisig transaction cannot be finalized: did not have enough information in multisig data to initialize spending condition`);
  }
  if (StxTx.isSingleSig(tx.auth.spendingCondition)) {
    throw new Error(`Multisig transaction cannot be finalized: supplied information initialized a singlesig transaction`);
  }
  tx.auth.spendingCondition.fields = fields;
}

export async function finalizeMultisigTransaction(multisigData: MultisigData): Promise<string> {
  if (multisigData.tx.numSignatures != multisigData.sigHashes.length) {
    throw new Error(`Multisig transaction cannot be finalized, expected ${multisigData.tx.numSignatures} signatures, but only found  ${multisigData.sigHashes.length}`);
  }

  let unsignedTx = await makeStxTokenTransferFrom(multisigData);
  setMultisigTransactionSpendingConditionFields(unsignedTx, makeSpendingConditionFields(multisigData));

  return unsignedTx.serialize().toString('hex');
}

export function updateMultisigData(multisigData: MultisigData, sigHash: string, signatureVRS: string, index: number) {
  multisigData.sigHashes.push(sigHash);
  multisigData.spendingFields[index].signatureVRS = signatureVRS;
}

/// Builds an unsigned transfer out of a multisig data serialization
async function makeStxTokenTransferFrom(multisigData: MultisigData) {
  let fee = new BigNum(multisigData.tx.fee, 10);
  let amount = new BigNum(multisigData.tx.amount, 10);
  let numSignatures = multisigData.tx.numSignatures;
  let publicKeys = multisigData.spendingFields.slice().map(field => field.publicKey);
  let memo = multisigData.tx.memo;
  let recipient = multisigData.tx.recipient;
  let anchorMode = StxTx.AnchorMode.Any;

  return (await makeUnsignedTransfer({ anchorMode, fee, amount, numSignatures, publicKeys, recipient, memo })).unsignedTx;
}

// Produce the signing buffer for a ledger device from the multisig data serialization
async function getLedgerSigningBuffer(multisigData: MultisigData): Promise<Buffer> {
  let unsignedTxBuff = (await makeStxTokenTransferFrom(multisigData)).serialize();

  if (multisigData.sigHashes.length == 0) {
    return unsignedTxBuff;
  } else if (multisigData.sigHashes.length == 1) {
    const postSigHashBuffer = Buffer.from(multisigData.sigHashes[0], 'hex');
    const pkEnc = Buffer.alloc(1, StxTx.PubKeyEncoding.Compressed);
    const prevSignatureFound = multisigData
        .spendingFields
        .find((field) => field.signatureVRS);
    if (!prevSignatureFound || !prevSignatureFound.signatureVRS) {
      throw new Error(`Error in supplied multisig data. Sighash included, but no corresponding VRS encoded in the spending fields.`);
    }
    const prevSignature = Buffer.from(prevSignatureFound.signatureVRS, 'hex');
    return Buffer.concat([unsignedTxBuff, postSigHashBuffer, pkEnc, prevSignature]);
  } else {
    throw new Error(`Ledger Stacks app does not support validating more than 2 signatures in multisig transactions`);
  }
}

export async function ledgerSignMultisigTx(app: StxApp, path: string, multisigData: MultisigData) {
  const pubkey = (await app.getAddressAndPubKey(path, StxTx.AddressVersion.TestnetSingleSig))
        .publicKey.toString('hex');
  const pubkeys = multisigData.spendingFields
        .map((x) => {
          if (! x.signatureVRS) {
            return x.publicKey
          } else {
            return null
          }
        });
  const index = pubkeys.indexOf(pubkey);

  if (index < 0) {
    throw new Error(`Pubkey ${pubkey} not found in partial tx pubkeys: ${pubkeys}`);
  }

  const signingBuffer = await getLedgerSigningBuffer(multisigData);
  const resp = await app.sign(path, signingBuffer);

  if (resp.returnCode !== LedgerError.NoErrors) {
    console.log(resp)
    throw new Error('Ledger responded with errors');
  }

  const sigHash = resp.postSignHash.toString("hex");
  const signatureVRS = resp.signatureVRS.toString("hex");

  return { sigHash, signatureVRS, index }
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
    let txBuffer = unsignedTx.slice();
    let postSigHashBuffer = Buffer.from(prevSigHash, 'hex');
    let pkEnc = Buffer.alloc(1, StxTx.PubKeyEncoding.Compressed);
    let prev_signer_field = partialFields[index - 1];
    if (prev_signer_field.contents.type !== StxTx.StacksMessageType.MessageSignature) {
      throw new Error(`Previous sighash was supplied, but previous signer was not included in the transaction's auth fields`);
    }
    let prev_signer = Buffer.from(prev_signer_field.contents.data, 'hex');
    let msg_array = [txBuffer, postSigHashBuffer, pkEnc, prev_signer];
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

async function generateMultiSignedTx() {
  let privkeys = [
    'dd7229314db5d50122cd8d4ff8975f57317f54c946cd233d8d35f5b616fe961e01',
    '119a851bd1201b93e6477a0a9c7d29515735530df92ab265166ca3da119f803501',
    '22d45b79bda06915c5d1a98da577089763b6c660304d3919e50797352dc6722f01',
  ]

  const privKeys = privkeys.map(StxTx.createStacksPrivateKey);

  let pubkeys = [
    '03827ffa27ad5af481203d4cf5654cd20312398fa92084ff76e4b4dffddafe1059',
    '03a9d11f6d4102ed323740f95668d6f206c5b5cbc5ce5c7028ceba1736fbbd6861',
    '0205132dbd1270f66adaf43723940a98be6331abe95bfa53838815bf214a5a2150'
  ];

  console.log(pubkeys);
  console.log(makeMultiSigAddr(pubkeys, 2));

  let transaction = await StxTx.makeUnsignedSTXTokenTransfer({
    fee: new BigNum(300),
    numSignatures: 2,
    publicKeys: pubkeys,
    amount: new BigNum(1000),
    recipient: "SP000000000000000000002Q6VF78",
    anchorMode: StxTx.AnchorMode.Any,
  });

  let signer = new StxTx.TransactionSigner(transaction);
  signer.checkOversign = false;
  signer.appendOrigin(StxTx.pubKeyfromPrivKey(privkeys[0]));
  signer.signOrigin(StxTx.createStacksPrivateKey(privkeys[1]));
  signer.signOrigin(StxTx.createStacksPrivateKey(privkeys[2]));

  return transaction
}


async function generateMultiUnsignedTx(app: StxApp) {
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

  let partialFields =
    pubkeys.map((x) => {
      return StxTx.createTransactionAuthField(StxTx.PubKeyEncoding.Compressed, StxTx.createStacksPublicKey(x))
    });

  return { unsignedTx, pubkeys: partialFields }
}

export function makeMultiSigAddr(pubkeys: string[], required: number) {
  let authorizedPKs = pubkeys.slice().map((k) => Buffer.from(k, 'hex'));
  let redeem = btc.payments.p2ms({ m: required, pubkeys: authorizedPKs });
  let btcAddr = btc.payments.p2sh({ redeem }).address;
  if (!btcAddr) {
    throw Error(`Failed to construct BTC address from pubkeys`);
  }
  let c32Addr = C32.b58ToC32(btcAddr);
  return c32Addr
}

async function makeUnsignedTransfer(options: UnsignedMultiSigTokenTransferOptions) {
  const unsignedTx = await StxTx.makeUnsignedSTXTokenTransfer( options );
  const publicKeys = options.publicKeys.slice();
  return { unsignedTx, publicKeys }
}

function checkAddressPubKeyMatch(pubkeys: string[], required: number, address: string) {
  // first try in sorted order
  let authorizedPKs = pubkeys.slice().sort().map((k) => Buffer.from(k, 'hex'));
  let redeem = btc.payments.p2ms({ m: required, pubkeys: authorizedPKs });
  let btcAddr = btc.payments.p2sh({ redeem }).address;
  if (!btcAddr) {
    throw Error(`Failed to construct BTC address from pubkeys`);
  }
  let c32Addr1 = C32.b58ToC32(btcAddr);
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
  let c32Addr2 = C32.b58ToC32(btcAddr);
  if (c32Addr2 == address) {
    return authorizedPKs.map((k) => k.toString('hex'))
  }

  throw `Public keys did not match expected address. Expected ${address}, but pubkeys correspond to ${c32Addr1} or ${c32Addr2}`
}
